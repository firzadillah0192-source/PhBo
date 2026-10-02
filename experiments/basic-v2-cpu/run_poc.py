#!/usr/bin/env python3
"""Isolated local-only BASIC V2 CPU face-swap comparison."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import resource
import shutil
import statistics
import sys
import time
from typing import Any

# Keep non-ORT numerical libraries from creating large pools on the shared VPS.
os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "2")

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFont, ImageOps
from insightface.app import FaceAnalysis
from insightface.app.common import Face
from insightface.model_zoo import get_model

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPERIMENT_ROOT = Path(__file__).resolve().parent
INPUTS = EXPERIMENT_ROOT / "inputs"
MODELS = EXPERIMENT_ROOT / "models"
OUTPUTS = EXPERIMENT_ROOT / "outputs"
TEMPLATE_ID = "sci-fi-space-commander-001"
SWAPPER_PATH = MODELS / "inswapper_128.onnx"
BUFFALO_ROOT = MODELS / "insightface"
BUFFALO_DIR = BUFFALO_ROOT / "models" / "buffalo_l"

sys.path.insert(0, str(REPO_ROOT / "backend"))
from app.generation.basic.blending import (  # noqa: E402
    composite,
    frequency_separated_identity,
    soft_face_mask,
)
from app.generation.basic.engine import BasicGenerationEngine  # noqa: E402
from app.templates_registry import TemplateRegistry  # noqa: E402


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def file_record(path: Path, *, role: str, source: str, license_status: str) -> dict[str, Any]:
    return {
        "filename": path.name,
        "path": str(path.relative_to(EXPERIMENT_ROOT)),
        "role": role,
        "source": source,
        "license_status": license_status,
        "size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def rss_mb() -> float:
    # Linux reports ru_maxrss in KiB.
    return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1)


def total_ram_kb() -> int | None:
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1])
    except OSError:
        return None
    return None


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def require_image(path: Path) -> np.ndarray:
    if not path.is_file():
        raise RuntimeError(f"required controlled input is missing: {path}")
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"cannot decode controlled input: {path}")
    return image


def detect_exactly_one(face_app: FaceAnalysis, image: np.ndarray, label: str):
    started = time.perf_counter()
    faces = face_app.get(image)
    elapsed_ms = round((time.perf_counter() - started) * 1000.0, 2)
    if len(faces) != 1:
        raise RuntimeError(f"{label}: expected exactly one face; found {len(faces)}")
    return faces[0], elapsed_ms, len(faces)


def padded_bbox_crop(image: np.ndarray, bbox: np.ndarray, pad_ratio: float = 0.28):
    height, width = image.shape[:2]
    x1, y1, x2, y2 = [float(value) for value in bbox]
    box_width = max(1.0, x2 - x1)
    box_height = max(1.0, y2 - y1)
    pad_x = box_width * pad_ratio
    pad_y = box_height * pad_ratio
    left = max(0, int(np.floor(x1 - pad_x)))
    top = max(0, int(np.floor(y1 - pad_y)))
    right = min(width, int(np.ceil(x2 + pad_x)))
    bottom = min(height, int(np.ceil(y2 + pad_y)))
    return image[top:bottom, left:right].copy(), (left, top, right, bottom)


def face_region_crop(image: np.ndarray, region: tuple[int, int, int, int], pad_ratio: float = 0.14):
    height, width = image.shape[:2]
    x, y, region_width, region_height = region
    pad_x = int(round(region_width * pad_ratio))
    pad_y = int(round(region_height * pad_ratio))
    left = max(0, x - pad_x)
    top = max(0, y - pad_y)
    right = min(width, x + region_width + pad_x)
    bottom = min(height, y + region_height + pad_y)
    return image[top:bottom, left:right].copy(), (left, top, right, bottom)


def build_masks(
    image_shape: tuple[int, ...],
    region: tuple[int, int, int, int],
    polygon_values: tuple[tuple[float, float], ...],
) -> tuple[np.ndarray, np.ndarray]:
    height, width = image_shape[:2]
    polygon = np.asarray(polygon_values, dtype=np.float32)
    inner = soft_face_mask(
        (width, height), region, tuple(tuple(point) for point in polygon), inward_only=True
    )

    base = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(base, [np.rint(polygon).astype(np.int32)], 255)
    expanded = cv2.dilate(
        base,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)),
        iterations=1,
    )
    contours, _ = cv2.findContours(expanded, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise RuntimeError("template face polygon produced an empty compositor mask")
    expanded_polygon = max(contours, key=cv2.contourArea).reshape(-1, 2).astype(np.float32)
    cheek_jaw = soft_face_mask(
        (width, height), region,
        tuple(tuple(point) for point in expanded_polygon),
        inward_only=True,
    )
    return inner, cheek_jaw


def compose_candidate(template: np.ndarray, swapped: np.ndarray, mask: np.ndarray):
    started = time.perf_counter()
    adjusted, trace = frequency_separated_identity(template, swapped, mask)
    result = composite(template, adjusted, mask)
    return result, trace, round((time.perf_counter() - started) * 1000.0, 2)


def write_contact_sheet(paths: dict[str, Path], output_path: Path) -> None:
    tile_width, tile_height = 360, 504
    label_height = 42
    labels = ["USER PHOTO", "TEMPLATE", "V1", "RAW V2", "ROI V2", "COMPOSITED V2"]
    ordered = [paths[label] for label in labels]
    sheet = Image.new("RGB", (tile_width * 3, (tile_height + label_height) * 2), (12, 14, 20))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, (label, path) in enumerate(zip(labels, ordered, strict=True)):
        image = Image.open(path).convert("RGB")
        fitted = ImageOps.contain(image, (tile_width, tile_height), Image.Resampling.LANCZOS)
        x = (index % 3) * tile_width
        y = (index // 3) * (tile_height + label_height)
        sheet.paste(fitted, (x + (tile_width - fitted.width) // 2, y + (tile_height - fitted.height) // 2))
        draw.text((x + 12, y + tile_height + 12), label, fill=(240, 242, 247), font=font)
    sheet.save(output_path, format="PNG", optimize=True)


def output_geometry_metrics(template: np.ndarray, candidate: np.ndarray, mask: np.ndarray) -> dict[str, Any]:
    changed = np.any(candidate != template, axis=2)
    outside = mask <= 0.0
    outside_pixels = int(outside.sum())
    outside_changed = int(np.count_nonzero(changed & outside))
    face_pixels = int(np.count_nonzero(mask > 0.0))
    return {
        "changed_pixels_total": int(changed.sum()),
        "composite_mask_pixels": face_pixels,
        "changed_pixels_outside_mask": outside_changed,
        "outside_mask_pixels": outside_pixels,
        "template_exactly_preserved_outside_mask": outside_changed == 0,
    }


def cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    left = np.asarray(left, dtype=np.float32).reshape(-1)
    right = np.asarray(right, dtype=np.float32).reshape(-1)
    left /= max(float(np.linalg.norm(left)), 1e-12)
    right /= max(float(np.linalg.norm(right)), 1e-12)
    return round(float(np.dot(left, right)), 5)


def main() -> int:
    started_total = time.perf_counter()
    OUTPUTS.mkdir(parents=True, exist_ok=True)
    (OUTPUTS / "failure.json").unlink(missing_ok=True)
    report_path = OUTPUTS / "benchmark.json"
    required_paths = [
        INPUTS / "user_photo.jpg",
        INPUTS / "template.png",
        INPUTS / "V1_reference.png",
        SWAPPER_PATH,
        BUFFALO_DIR / "det_10g.onnx",
        BUFFALO_DIR / "w600k_r50.onnx",
    ]
    missing = [str(path) for path in required_paths if not path.is_file()]
    report: dict[str, Any] = {
        "status": "POC_PARTIAL",
        "scope": "BASIC V2 local CPU face-swap POC; no production integration",
        "privacy": {
            "image_processing_local_only": True,
            "external_ai_api": False,
            "image_telemetry": False,
            "prompt_service": False,
            "restoration_model": False,
        },
        "environment": {
            "python": sys.version.split()[0],
            "cpu_count": os.cpu_count(),
            "ram_total_kb": total_ram_kb(),
            "ram_peak_rss_mb_before": rss_mb(),
            "onnxruntime": ort.__version__,
            "onnxruntime_available_providers": ort.get_available_providers(),
            "runtime_packages": {},
        },
        "models": {},
        "stages": {},
        "identity_similarity_arcface_cosine": {},
        "template_preservation": {},
        "visual_evaluation": {
            "human_recognizability": "REQUIRES_HUMAN_REVIEW",
            "restoration_used": False,
        },
    }
    for package in (
        "opencv-contrib-python", "opencv-python-headless", "mediapipe",
        "Pillow", "numpy", "onnxruntime", "insightface",
    ):
        try:
            report["environment"]["runtime_packages"][package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            report["environment"]["runtime_packages"][package] = None
    if missing:
        report["failure"] = {"kind": "missing_input_or_model", "paths": missing}
        write_json(report_path, report)
        raise RuntimeError(f"missing required local inputs/checkpoints: {missing}")

    # The exact source fixture and frozen V1 output are copied from the existing
    # regression inputs. Do not substitute any other user photo or template.
    user_path = INPUTS / "user_photo.jpg"
    template_path = INPUTS / "template.png"
    v1_reference_path = INPUTS / "V1_reference.png"
    input_read_started = time.perf_counter()
    user = require_image(user_path)
    template_image = require_image(template_path)
    v1_reference = require_image(v1_reference_path)
    input_read_ms = round((time.perf_counter() - input_read_started) * 1000.0, 2)
    template = TemplateRegistry(REPO_ROOT / "templates").get(TEMPLATE_ID)
    if template.face_region is None or template.face_anchors is None or template.mask_polygon is None:
        raise RuntimeError("approved template is missing face ROI, anchors, or mask polygon")
    if template_image.shape[:2] != (template.height, template.width):
        raise RuntimeError("template input dimensions differ from the approved template metadata")

    license_text = "InsightFace public model-zoo checkpoints: non-commercial research purposes only; no commercial production clearance."
    official_swapsource = "https://github.com/deepinsight/insightface/releases/download/model-zoo/inswapper_128.onnx"
    official_packsource = "https://github.com/deepinsight/insightface/releases/download/model-zoo/buffalo_l.zip"
    model_records = [
        file_record(SWAPPER_PATH, role="identity transfer", source=official_swapsource, license_status=license_text),
        file_record(BUFFALO_DIR / "det_10g.onnx", role="face detection; loaded", source=official_packsource, license_status=license_text),
        file_record(BUFFALO_DIR / "w600k_r50.onnx", role="ArcFace identity embedding; loaded", source=official_packsource, license_status=license_text),
        file_record(BUFFALO_DIR / "2d106det.onnx", role="landmark model; present in pack, not loaded", source=official_packsource, license_status=license_text),
        file_record(BUFFALO_DIR / "1k3d68.onnx", role="landmark model; present in pack, not loaded", source=official_packsource, license_status=license_text),
        file_record(BUFFALO_DIR / "genderage.onnx", role="attribute model; present in pack, not loaded", source=official_packsource, license_status=license_text),
    ]
    model_manifest = {
        "model_files": model_records,
        "buffalo_l_archive": file_record(
            MODELS / "buffalo_l.zip", role="official supporting model pack archive",
            source=official_packsource, license_status=license_text,
        ),
        "terms": "https://github.com/deepinsight/insightface/blob/master/model_zoo/README.md",
        "code_license_separate": "InsightFace Python code MIT license does not cover model weights.",
    }
    write_json(OUTPUTS / "model_manifest.json", model_manifest)
    report["models"] = model_manifest
    report["inputs"] = {
        "user_photo": {"sha256": sha256_file(user_path), "bytes": user_path.stat().st_size},
        "template": {"sha256": sha256_file(template_path), "bytes": template_path.stat().st_size},
        "V1_reference": {"sha256": sha256_file(v1_reference_path), "bytes": v1_reference_path.stat().st_size},
        "template_id": TEMPLATE_ID,
        "template_face_region": list(template.face_region),
        "template_face_anchors": template.face_anchors,
    }

    # Re-render the frozen V1 profile without changing production source.
    v1_rerender_path = OUTPUTS / "v1_regression_rerender.png"
    v1_debug_dir = OUTPUTS / "v1_regression_debug"
    v1_started = time.perf_counter()
    v1_error = None
    try:
        BasicGenerationEngine().generate(
            user_path,
            TEMPLATE_ID,
            v1_rerender_path,
            {
                "template": template,
                "template_path": template_path,
                "landmark_backend": "real",
                "identity_profile": "soft_contour_identity",
                "debug_dir": v1_debug_dir,
            },
        )
    except Exception as exc:  # preserve POC progress if the frozen baseline check fails
        v1_error = f"{type(exc).__name__}: {exc}"
    v1_identical = bool(
        v1_error is None
        and v1_rerender_path.is_file()
        and v1_rerender_path.read_bytes() == v1_reference_path.read_bytes()
    )
    v1_pixel_metrics: dict[str, Any] | None = None
    if v1_error is None and v1_rerender_path.is_file():
        reference_pixels = require_image(v1_reference_path)
        rerender_pixels = require_image(v1_rerender_path)
        if reference_pixels.shape == rerender_pixels.shape:
            delta = np.abs(reference_pixels.astype(np.int16) - rerender_pixels.astype(np.int16))
            v1_pixel_metrics = {
                "different_pixels": int(np.any(delta != 0, axis=2).sum()),
                "total_pixels": int(delta.shape[0] * delta.shape[1]),
                "max_channel_delta": int(delta.max()),
                "mean_absolute_channel_delta": round(float(delta.mean()), 9),
                "p99_channel_delta": float(np.percentile(delta, 99)),
            }
    report["stages"]["v1_regression"] = {
        "elapsed_ms": round((time.perf_counter() - v1_started) * 1000.0, 2),
        "byte_identical_to_frozen_reference": v1_identical,
        "pixel_difference_metrics": v1_pixel_metrics,
        "error": v1_error,
    }

    cv2.setNumThreads(2)
    model_init_started = time.perf_counter()
    face_app = FaceAnalysis(
        name="buffalo_l",
        root=str(BUFFALO_ROOT),
        allowed_modules=["detection", "recognition"],
        providers=["CPUExecutionProvider"],
    )
    face_app.prepare(ctx_id=-1, det_size=(640, 640))
    face_analysis_init_ms = round((time.perf_counter() - model_init_started) * 1000.0, 2)
    swap_init_started = time.perf_counter()
    swapper = get_model(str(SWAPPER_PATH), providers=["CPUExecutionProvider"])
    swapper_init_ms = round((time.perf_counter() - swap_init_started) * 1000.0, 2)
    session_providers = {
        name: model.session.get_providers()
        for name, model in face_app.models.items()
    }
    session_providers["inswapper"] = swapper.session.get_providers()
    if any(providers != ["CPUExecutionProvider"] for providers in session_providers.values()):
        raise RuntimeError(f"non-CPU ONNX provider was enabled: {session_providers}")
    report["stages"]["model_initialization"] = {
        "face_analysis_ms": face_analysis_init_ms,
        "inswapper_ms": swapper_init_ms,
        "total_ms": face_analysis_init_ms + swapper_init_ms,
        "sessions": session_providers,
    }

    detect_started = time.perf_counter()
    source_face, source_detect_ms, source_count = detect_exactly_one(face_app, user, "user photo")
    target_face, template_detect_ms, target_count = detect_exactly_one(face_app, template_image, "full template")
    template_crop, crop_rect = face_region_crop(template_image, template.face_region)
    left, top, right, bottom = crop_rect
    # The approved template's face ROI is intentionally tight and the detector
    # does not reliably fire on it alone. Reuse the exact full-template
    # detection, translating its bbox and five alignment landmarks into ROI
    # coordinates for INSwapper. No second face or identity is introduced.
    roi_bbox = np.asarray(target_face.bbox, dtype=np.float32).copy()
    roi_bbox[[0, 2]] -= left
    roi_bbox[[1, 3]] -= top
    roi_kps = np.asarray(target_face.kps, dtype=np.float32).copy()
    roi_kps[:, 0] -= left
    roi_kps[:, 1] -= top
    if np.any(roi_kps[:, 0] < 0) or np.any(roi_kps[:, 0] >= right - left) or np.any(roi_kps[:, 1] < 0) or np.any(roi_kps[:, 1] >= bottom - top):
        raise RuntimeError("translated template landmarks fall outside the approved face ROI")
    roi_face = Face(bbox=roi_bbox, kps=roi_kps, det_score=target_face.det_score)
    roi_detect_ms = 0.0
    roi_count = target_count
    detection_total_ms = round((time.perf_counter() - detect_started) * 1000.0, 2)
    report["stages"]["face_detection_and_embedding"] = {
        "user_app_get_ms": source_detect_ms,
        "full_template_app_get_ms": template_detect_ms,
        "template_roi_app_get_ms": roi_detect_ms,
        "combined_detection_embedding_ms": detection_total_ms,
        "embedding_timing_note": "InsightFace FaceAnalysis.get combines detection and ArcFace embedding; per-model timing is not exposed by this POC. ROI alignment landmarks reuse the exact full-template detection translated into crop coordinates.",
        "counts": {"user": source_count, "full_template": target_count, "template_roi_landmarks_reused": roi_count},
    }

    preprocess_started = time.perf_counter()
    user_crop, _ = padded_bbox_crop(user, source_face.bbox)
    cv2.imwrite(str(OUTPUTS / "user_face_crop.png"), user_crop)
    cv2.imwrite(str(OUTPUTS / "template_face_crop.png"), template_crop)
    preprocess_ms = round((time.perf_counter() - preprocess_started) * 1000.0, 2)
    shutil.copyfile(v1_reference_path, OUTPUTS / "V1_reference.png")

    # One cold inference is the preferred restricted-ROI architecture.
    cold_roi_started = time.perf_counter()
    swapped_crop = swapper.get(template_crop.copy(), roi_face, source_face, paste_back=True)
    cold_roi_ms = round((time.perf_counter() - cold_roi_started) * 1000.0, 2)
    if swapped_crop is None or swapped_crop.shape != template_crop.shape:
        raise RuntimeError("ROI face-swap returned an invalid image")
    cv2.imwrite(str(OUTPUTS / "swapped_face_crop.png"), swapped_crop)
    roi_canvas = template_image.copy()
    roi_canvas[top:bottom, left:right] = swapped_crop
    cv2.imwrite(str(OUTPUTS / "B_roi_faceswap.png"), roi_canvas)

    # Direct whole-template swap is the raw comparison. It uses the model's
    # paste-back behavior and no Photobooth compositor.
    raw_started = time.perf_counter()
    raw_image = swapper.get(template_image.copy(), target_face, source_face, paste_back=True)
    raw_first_ms = round((time.perf_counter() - raw_started) * 1000.0, 2)
    if raw_image is None or raw_image.shape != template_image.shape:
        raise RuntimeError("full-template face-swap returned an invalid image")
    cv2.imwrite(str(OUTPUTS / "A_raw_faceswap.png"), raw_image)

    inner_mask, cheek_jaw_mask = build_masks(
        template_image.shape, template.face_region, template.mask_polygon
    )
    inner_candidate, inner_trace, inner_comp_ms = compose_candidate(
        template_image, roi_canvas, inner_mask
    )
    cheek_candidate, cheek_trace, cheek_comp_ms = compose_candidate(
        template_image, roi_canvas, cheek_jaw_mask
    )
    cv2.imwrite(str(OUTPUTS / "C_inner_face.png"), inner_candidate)
    cv2.imwrite(str(OUTPUTS / "C_face_cheek_jaw.png"), cheek_candidate)
    # Keep the more inclusive but still face-only cheek/jaw mask as the named C.
    cv2.imwrite(str(OUTPUTS / "C_faceswap_plus_compositor.png"), cheek_candidate)
    cv2.imwrite(str(OUTPUTS / "mask_inner_face.png"), np.rint(inner_mask * 255).astype(np.uint8))
    cv2.imwrite(str(OUTPUTS / "mask_face_cheek_jaw.png"), np.rint(cheek_jaw_mask * 255).astype(np.uint8))

    warm_a_ms: list[float] = []
    warm_b_ms: list[float] = []
    warm_c_ms: list[float] = []
    warm_compose_ms: list[float] = []
    warm_a_hashes: list[str] = []
    warm_b_hashes: list[str] = []
    warm_c_hashes: list[str] = []
    warm_images: dict[str, np.ndarray] = {}
    for _ in range(3):
        warm_a_started = time.perf_counter()
        warm_a = swapper.get(template_image.copy(), target_face, source_face, paste_back=True)
        warm_a_ms.append(round((time.perf_counter() - warm_a_started) * 1000.0, 2))

        warm_b_started = time.perf_counter()
        warm_crop = swapper.get(template_crop.copy(), roi_face, source_face, paste_back=True)
        warm_roi_canvas = template_image.copy()
        warm_roi_canvas[top:bottom, left:right] = warm_crop
        b_elapsed_ms = round((time.perf_counter() - warm_b_started) * 1000.0, 2)
        warm_b_ms.append(b_elapsed_ms)

        warm_c_started = time.perf_counter()
        warm_c, _, _ = compose_candidate(template_image, warm_roi_canvas, cheek_jaw_mask)
        compose_elapsed_ms = round((time.perf_counter() - warm_c_started) * 1000.0, 2)
        warm_compose_ms.append(compose_elapsed_ms)
        warm_c_ms.append(round(b_elapsed_ms + compose_elapsed_ms, 2))
        warm_a_hashes.append(hashlib.sha256(warm_a.tobytes()).hexdigest())
        warm_b_hashes.append(hashlib.sha256(warm_roi_canvas.tobytes()).hexdigest())
        warm_c_hashes.append(hashlib.sha256(warm_c.tobytes()).hexdigest())
        warm_images = {"a": warm_a, "b": warm_roi_canvas, "c": warm_c}

    # Use the final warm iteration for the named artifacts; the cold outputs
    # are separately kept only as timing samples and are expected to match.
    cv2.imwrite(str(OUTPUTS / "A_raw_faceswap.png"), warm_images["a"])
    cv2.imwrite(str(OUTPUTS / "B_roi_faceswap.png"), warm_images["b"])
    cv2.imwrite(str(OUTPUTS / "C_faceswap_plus_compositor.png"), warm_images["c"])
    cv2.imwrite(str(OUTPUTS / "C_face_cheek_jaw.png"), warm_images["c"])

    # The swapper result preserves target scene pixels outside its own pasteback
    # region. C is constrained to the curated face mask and keeps the original
    # template's low-frequency lighting via the existing frequency compositor.
    c_geometry = output_geometry_metrics(template_image, warm_images["c"], cheek_jaw_mask)
    inner_geometry = output_geometry_metrics(template_image, inner_candidate, inner_mask)

    # Recompute embeddings only after timed inference to avoid including this
    # diagnostic pass in A/B/C latency.
    identity_metrics: dict[str, Any] = {}
    for label, image in (
        ("V1", v1_reference),
        ("A_raw_V2", warm_images["a"]),
        ("B_roi_V2", warm_images["b"]),
        ("C_composited_V2", warm_images["c"]),
    ):
        try:
            faces = face_app.get(image)
            if len(faces) != 1:
                identity_metrics[label] = {"face_count": len(faces), "cosine_to_user": None}
            else:
                identity_metrics[label] = {
                    "face_count": 1,
                    "cosine_to_user": cosine_similarity(source_face.normed_embedding, faces[0].normed_embedding),
                }
        except Exception as exc:
            identity_metrics[label] = {"error": f"{type(exc).__name__}: {exc}", "cosine_to_user": None}

    output_map = {
        "USER PHOTO": user_path,
        "TEMPLATE": template_path,
        "V1": OUTPUTS / "V1_reference.png",
        "RAW V2": OUTPUTS / "A_raw_faceswap.png",
        "ROI V2": OUTPUTS / "B_roi_faceswap.png",
        "COMPOSITED V2": OUTPUTS / "C_faceswap_plus_compositor.png",
    }
    write_contact_sheet(output_map, OUTPUTS / "basic-v1-v2-comparison.png")
    report["stages"].update(
        {
            "input_loading_ms": input_read_ms,
            "preprocessing_ms": preprocess_ms,
            "cold_roi_swap_inference_ms": cold_roi_ms,
            "raw_full_template_first_swap_ms_after_cold": raw_first_ms,
            "compositor_ms": {
                "inner_face": inner_comp_ms,
                "face_cheek_jaw": cheek_comp_ms,
                "median_warm_compose_only": round(statistics.median(warm_compose_ms), 2),
                "median_warm_C_end_to_end": round(statistics.median(warm_c_ms), 2),
            },
            "warm_runs": {
                "count_per_route": 3,
                "A_raw_full_template_swap_ms": warm_a_ms,
                "A_raw_median_ms": round(statistics.median(warm_a_ms), 2),
                "B_roi_swap_plus_paste_ms": warm_b_ms,
                "B_roi_median_ms": round(statistics.median(warm_b_ms), 2),
                "C_roi_swap_plus_compositor_ms": warm_c_ms,
                "C_median_ms": round(statistics.median(warm_c_ms), 2),
                "A_repeatable_exact_pixels": len(set(warm_a_hashes)) == 1,
                "B_repeatable_exact_pixels": len(set(warm_b_hashes)) == 1,
                "C_repeatable_exact_pixels": len(set(warm_c_hashes)) == 1,
            },
            "total_runtime_ms": round((time.perf_counter() - started_total) * 1000.0, 2),
            "rss_peak_mb_after": rss_mb(),
            "latency_class_C": (
                "PROMISING" if statistics.median(warm_c_ms) <= 10_000
                else "ACCEPTABLE FOR FURTHER OPTIMIZATION" if statistics.median(warm_c_ms) <= 30_000
                else "SLOW BUT STILL EVALUATE QUALITY" if statistics.median(warm_c_ms) <= 60_000
                else "LIKELY NOT PRACTICAL FOR KIOSK CPU"
            ),
            "outputs": {key: str(path.relative_to(EXPERIMENT_ROOT)) for key, path in output_map.items()},
            "contact_sheet": str((OUTPUTS / "basic-v1-v2-comparison.png").relative_to(EXPERIMENT_ROOT)),
        }
    )
    report["identity_similarity_arcface_cosine"] = identity_metrics
    report["template_preservation"] = {
        "C_inner_face": inner_geometry,
        "C_face_cheek_jaw": c_geometry,
        "hairline_body_costume_background": "outside compositor mask is exact original template pixels",
        "lighting_strategy": "template low-frequency lighting + swap identity mid/high frequencies",
        "repeatability": report["stages"]["warm_runs"]["C_repeatable_exact_pixels"],
    }
    report["visual_evaluation"] = {
        "identity_preservation": "REQUIRES_VISUAL_AND_HUMAN_REVIEW",
        "template_preservation": "PASS" if c_geometry["template_exactly_preserved_outside_mask"] else "FAIL",
        "face_head_proportion": "REQUIRES_VISUAL_REVIEW",
        "hairline_preservation": "PASS_BY_MASK_CONSTRAINT",
        "jaw_neck_transition": "REQUIRES_VISUAL_REVIEW",
        "skin_tone": "REQUIRES_VISUAL_REVIEW",
        "lighting_consistency": "REQUIRES_VISUAL_REVIEW",
        "visual_artifacts": "REQUIRES_VISUAL_REVIEW",
        "human_recognizability": "REQUIRES_HUMAN_REVIEW",
        "repeatability_potential": "PASS" if report["stages"]["warm_runs"]["C_repeatable_exact_pixels"] else "PARTIAL",
        "restoration_used": False,
    }
    report["v1_vs_v2"] = {
        "identity": {
            "V1_arcface_cosine": identity_metrics.get("V1", {}).get("cosine_to_user"),
            "V2_A": identity_metrics.get("A_raw_V2", {}).get("cosine_to_user"),
            "V2_B": identity_metrics.get("B_roi_V2", {}).get("cosine_to_user"),
            "V2_C": identity_metrics.get("C_composited_V2", {}).get("cosine_to_user"),
            "human_recognizability": "requires a person who knows the user",
        },
        "template_preservation": report["template_preservation"],
        "latency": report["stages"]["warm_runs"],
        "ram_peak_mb": report["stages"]["rss_peak_mb_after"],
        "naturalness_and_artifacts": "Requires visual review of contact sheet and full-size outputs.",
    }
    report["status"] = "POC_PARTIAL"
    write_json(report_path, report)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        failure = {
            "status": "POC_PARTIAL",
            "failure": {"kind": type(exc).__name__, "message": str(exc)},
        }
        try:
            write_json(OUTPUTS / "failure.json", failure)
        except Exception:
            pass
        raise
