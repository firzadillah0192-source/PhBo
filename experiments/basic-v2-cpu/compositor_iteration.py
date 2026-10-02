#!/usr/bin/env python3
"""Compositor-only identity-preservation experiments for BASIC V2.

This runner reuses the frozen local inputs, A raw-swap image, and existing
InsightFace checkpoints. It never runs face swap inference and never writes to
production paths. Run `initial` to make C1-C3, inspect them, then run `c4` to
make the balanced candidate and review sheets.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import statistics
import sys
import time
from typing import Any

os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
os.environ.setdefault("MKL_NUM_THREADS", "2")

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFont, ImageOps
from insightface.app import FaceAnalysis
from insightface.utils.face_align import norm_crop

REPO_ROOT = Path(__file__).resolve().parents[2]
EXPERIMENT_ROOT = Path(__file__).resolve().parent
INPUTS = EXPERIMENT_ROOT / "inputs"
MODELS = EXPERIMENT_ROOT / "models"
OUTPUTS = EXPERIMENT_ROOT / "outputs"
BUFFALO_ROOT = MODELS / "insightface"
SWAPPER_PATH = MODELS / "inswapper_128.onnx"
TEMPLATE_ID = "sci-fi-space-commander-001"
METRICS_PATH = OUTPUTS / "compositor-variant-metrics.json"

sys.path.insert(0, str(REPO_ROOT / "backend"))
from app.generation.basic.blending import composite, frequency_separated_identity, soft_face_mask  # noqa: E402


BASELINE_NAMES = (
    "A_raw_faceswap.png",
    "B_roi_faceswap.png",
    "C_faceswap_plus_compositor.png",
    "V1_reference.png",
    "benchmark.json",
    "model_manifest.json",
    "visual_review.json",
)
NEW_NAMES = (
    "C1_wider_identity_mask.png",
    "C2_reduced_harmonization.png",
    "C3_frequency_identity.png",
    "C1_mask_debug.png",
    "C2_mask_debug.png",
    "C3_mask_debug.png",
)
FINAL_NAMES = (
    "C4_balanced_candidate.png",
    "C4_mask_debug.png",
    "basic-v2-human-review.png",
    "basic-v2-face-crops-review.png",
    "compositor-visual-review.json",
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_image(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"cannot read local POC image: {path}")
    return image


def require_new_paths(names: tuple[str, ...]) -> None:
    existing = [str(OUTPUTS / name) for name in names if (OUTPUTS / name).exists()]
    if existing:
        raise FileExistsError(
            "refusing to overwrite existing iteration artifacts; use a fresh experiment copy: "
            + ", ".join(existing)
        )


def baseline_hashes() -> dict[str, str]:
    paths = [INPUTS / "user_photo.jpg", INPUTS / "template.png"]
    paths.extend(OUTPUTS / name for name in BASELINE_NAMES)
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise FileNotFoundError("frozen input/baseline artifact missing: " + ", ".join(missing))
    return {str(path.relative_to(EXPERIMENT_ROOT)): sha256_file(path) for path in paths}


def assert_baselines_unchanged(before: dict[str, str]) -> None:
    after = baseline_hashes()
    if after != before:
        changed = [name for name in before if before.get(name) != after.get(name)]
        raise RuntimeError("a frozen baseline artifact changed: " + ", ".join(changed))


def build_masks(
    image_shape: tuple[int, ...],
    region: tuple[int, int, int, int],
    polygon_values: tuple[tuple[float, float], ...],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    height, width = image_shape[:2]
    polygon = np.asarray(polygon_values, dtype=np.float32)
    inner = soft_face_mask(
        (width, height), region, tuple(tuple(point) for point in polygon), inward_only=True
    )
    base = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(base, [np.rint(polygon).astype(np.int32)], 255)
    expanded = cv2.dilate(
        base, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)), iterations=1
    )
    cheek_mask = face_mask_from_binary(expanded, region)
    return inner, cheek_mask, base


def face_mask_from_binary(binary: np.ndarray, region: tuple[int, int, int, int]) -> np.ndarray:
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise RuntimeError("template face polygon produced an empty compositor mask")
    polygon = max(contours, key=cv2.contourArea).reshape(-1, 2).astype(np.float32)
    return soft_face_mask(
        (binary.shape[1], binary.shape[0]),
        region,
        tuple(tuple(point) for point in polygon),
        inward_only=True,
    )


def build_wider_lower_mask(
    image_shape: tuple[int, ...],
    region: tuple[int, int, int, int],
    polygon_values: tuple[tuple[float, float], ...],
    base_mask: np.ndarray,
    base_binary: np.ndarray,
    anchors: dict[str, list[float]],
) -> np.ndarray:
    """Expand the existing cheek/jaw support gradually below the eye line."""
    height, width = image_shape[:2]
    polygon = np.asarray(polygon_values, dtype=np.float32)
    wide_binary = cv2.dilate(
        base_binary,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (23, 23)),
        iterations=1,
    )
    wider_polygon_mask = face_mask_from_binary(wide_binary, region)

    eye_y = (float(anchors["left_eye"][1]) + float(anchors["right_eye"][1])) / 2.0
    mouth_y = float(anchors["mouth"][1])
    rows = np.arange(height, dtype=np.float32)[:, None]
    start_y = eye_y + 15.0
    end_y = mouth_y + 8.0
    progress = np.clip((rows - start_y) / max(end_y - start_y, 1.0), 0.0, 1.0)
    gate = np.broadcast_to(progress * progress * (3.0 - 2.0 * progress), (height, width)).copy()

    # Do not let the dilation reach the ear region; expansion remains within
    # the cheek/jaw face corridor specified by the approved template metadata.
    x_min = int(round(region[0] + region[2] * 0.065))
    x_max = int(round(region[0] + region[2] * 0.935))
    x_gate = np.zeros((1, width), dtype=np.float32)
    x_gate[:, x_min:x_max] = 1.0
    gate *= x_gate
    mask = base_mask + np.maximum(wider_polygon_mask - base_mask, 0.0) * gate
    return np.clip(mask, 0.0, 0.94).astype(np.float32)


def frequency_identity_candidate(
    template: np.ndarray,
    identity: np.ndarray,
) -> np.ndarray:
    """Keep template low-frequency light while retaining identity detail bands."""
    template_lab = cv2.cvtColor(template, cv2.COLOR_BGR2LAB).astype(np.float32)
    identity_lab = cv2.cvtColor(identity, cv2.COLOR_BGR2LAB).astype(np.float32)
    low_sigma, mid_sigma = 18.0, 4.0
    template_low = cv2.GaussianBlur(template_lab, (0, 0), low_sigma, low_sigma)
    template_mid_base = cv2.GaussianBlur(template_lab, (0, 0), mid_sigma, mid_sigma)
    template_mid = template_mid_base - template_low
    identity_low = cv2.GaussianBlur(identity_lab, (0, 0), low_sigma, low_sigma)
    identity_mid_base = cv2.GaussianBlur(identity_lab, (0, 0), mid_sigma, mid_sigma)
    identity_mid = identity_mid_base - identity_low
    identity_high = identity_lab - identity_mid_base

    result = template_low.copy()
    result[..., 0] = (
        template_low[..., 0]
        + identity_mid[..., 0] * 0.94
        + identity_high[..., 0] * 0.96
        + template_mid[..., 0] * 0.06
    )
    result[..., 1:] = (
        template_low[..., 1:] * 0.38
        + identity_low[..., 1:] * 0.62
        + identity_mid[..., 1:] * 0.90
        + identity_high[..., 1:] * 0.88
        + template_mid[..., 1:] * 0.12
    )
    return cv2.cvtColor(np.clip(result, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def wider_reduced_harmonization_candidate(
    template: np.ndarray,
    identity: np.ndarray,
    mask: np.ndarray,
) -> np.ndarray:
    """Moderate hybrid for C4: template light, stronger source detail/chroma."""
    return frequency_separated_identity(
        template,
        identity,
        mask,
        mid_luminance_authority=0.89,
        high_luminance_authority=0.94,
        template_mid_luminance_authority=0.11,
        template_high_luminance_authority=0.06,
        mid_chroma_authority=0.82,
        high_chroma_authority=0.75,
        template_mid_chroma_authority=0.18,
        template_high_chroma_authority=0.25,
        user_intrinsic_chroma_authority=0.74,
        user_intrinsic_luminance_authority=0.30,
    )[0]


def compose_with_identity(
    template: np.ndarray,
    identity: np.ndarray,
    mask: np.ndarray,
    mode: str,
) -> tuple[np.ndarray, float]:
    started = time.perf_counter()
    if mode == "current":
        adjusted, _ = frequency_separated_identity(template, identity, mask)
    elif mode == "reduced":
        adjusted, _ = frequency_separated_identity(
            template,
            identity,
            mask,
            mid_luminance_authority=0.92,
            high_luminance_authority=0.97,
            template_mid_luminance_authority=0.08,
            template_high_luminance_authority=0.03,
            mid_chroma_authority=0.86,
            high_chroma_authority=0.80,
            template_mid_chroma_authority=0.14,
            template_high_chroma_authority=0.20,
            user_intrinsic_chroma_authority=0.76,
            user_intrinsic_luminance_authority=0.31,
        )
    elif mode == "frequency":
        adjusted = frequency_identity_candidate(template, identity)
    elif mode == "hybrid":
        adjusted = wider_reduced_harmonization_candidate(template, identity, mask)
    else:
        raise ValueError(f"unknown compositor mode: {mode}")
    result = composite(template, adjusted, mask)
    return result, round((time.perf_counter() - started) * 1000.0, 2)


def mask_debug_image(template: np.ndarray, mask: np.ndarray, label: str, destination: Path) -> None:
    color = np.zeros_like(template)
    color[:] = (35, 150, 255)  # orange-blue in BGR
    alpha = np.clip(mask, 0.0, 1.0)[..., None] * 0.72
    overlay = np.clip(template.astype(np.float32) * (1.0 - alpha) + color * alpha, 0, 255).astype(np.uint8)
    pil = Image.fromarray(cv2.cvtColor(overlay, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil)
    draw.rectangle((0, 0, pil.width, 74), fill=(8, 14, 24))
    draw.text((18, 13), label, fill=(245, 247, 250), font=ImageFont.load_default())
    draw.text((18, 35), "orange = identity region; opacity = feather; clear = preserved template", fill=(212, 220, 230), font=ImageFont.load_default())
    pil.save(destination, format="PNG", optimize=True)


def mask_metrics(mask: np.ndarray) -> dict[str, Any]:
    active = mask > 0.0
    return {
        "weighted_mask_area_ratio": round(float(mask.sum() / mask.size), 7),
        "active_mask_area_ratio": round(float(active.sum() / mask.size), 7),
        "active_mask_pixels": int(active.sum()),
        "mask_max_alpha": round(float(mask.max()), 5),
    }


def geometry_metrics(template: np.ndarray, candidate: np.ndarray, mask: np.ndarray) -> dict[str, Any]:
    delta = np.abs(candidate.astype(np.int16) - template.astype(np.int16))
    changed = np.any(delta != 0, axis=2)
    outside = mask <= 0.0
    outside_changed = changed & outside
    outside_count = int(outside.sum())
    outside_deltas = delta[outside]
    return {
        "changed_pixels_outside_intended_mask": int(outside_changed.sum()),
        "outside_mask_pixel_count": outside_count,
        "outside_mask_changed_percent": round(float(outside_changed.sum() / max(outside_count, 1) * 100), 8),
        "maximum_outside_mask_channel_delta": int(outside_deltas.max()) if outside_deltas.size else 0,
        "template_exactly_preserved_outside_intended_mask": not bool(outside_changed.any()),
    }


def cosine_similarity(left: np.ndarray, right: np.ndarray) -> float:
    left = np.asarray(left, dtype=np.float32).reshape(-1)
    right = np.asarray(right, dtype=np.float32).reshape(-1)
    left /= max(float(np.linalg.norm(left)), 1e-12)
    right /= max(float(np.linalg.norm(right)), 1e-12)
    return round(float(np.dot(left, right)), 5)


def create_face_app() -> tuple[FaceAnalysis, dict[str, list[str]], float]:
    started = time.perf_counter()
    app = FaceAnalysis(
        name="buffalo_l",
        root=str(BUFFALO_ROOT),
        allowed_modules=["detection", "recognition"],
        providers=["CPUExecutionProvider"],
    )
    app.prepare(ctx_id=-1, det_size=(640, 640))
    sessions = {name: model.session.get_providers() for name, model in app.models.items()}
    if any(value != ["CPUExecutionProvider"] for value in sessions.values()):
        raise RuntimeError(f"non-CPU provider detected: {sessions}")
    return app, sessions, round((time.perf_counter() - started) * 1000.0, 2)


def exactly_one_face(app: FaceAnalysis, image: np.ndarray, label: str):
    faces = app.get(image)
    if len(faces) != 1:
        raise RuntimeError(f"{label}: expected one face, found {len(faces)}")
    return faces[0]


def candidate_report(
    app: FaceAnalysis,
    source_embedding: np.ndarray,
    template_embedding: np.ndarray,
    user: np.ndarray,
    template: np.ndarray,
    image: np.ndarray,
    mask: np.ndarray,
    compositor_ms: float | None,
    total_runtime_ms: float | None,
    preprocessing_ms: float | None,
) -> dict[str, Any]:
    started = time.perf_counter()
    face = exactly_one_face(app, image, "candidate face")
    metrics = {
        **mask_metrics(mask),
        **geometry_metrics(template, image, mask),
        "arcface_cosine_to_user": cosine_similarity(source_embedding, face.normed_embedding),
        "arcface_cosine_to_template": cosine_similarity(template_embedding, face.normed_embedding),
        "preprocessing_ms": preprocessing_ms,
        "compositor_ms": compositor_ms,
        "total_runtime_ms": total_runtime_ms,
        "arcface_evaluation_ms_excluded_from_runtime": round((time.perf_counter() - started) * 1000.0, 2),
    }
    return metrics


def detect_embeddings(app: FaceAnalysis, user: np.ndarray, template: np.ndarray):
    user_face = exactly_one_face(app, user, "user photo")
    template_face = exactly_one_face(app, template, "approved template")
    return user_face, template_face


def build_full_contact_sheet(paths: dict[str, Path], destination: Path) -> None:
    labels = [
        "USER PHOTO", "TEMPLATE", "V1",
        "RAW A", "CURRENT C", "C1 WIDER MASK",
        "C2 REDUCED HARMONIZATION", "C3 FREQUENCY IDENTITY", "C4 BALANCED",
    ]
    tile_width, tile_height, label_height = 360, 504, 58
    sheet = Image.new("RGB", (tile_width * 3, (tile_height + label_height) * 3), (10, 13, 20))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, label in enumerate(labels):
        image = Image.open(paths[label]).convert("RGB")
        fitted = ImageOps.contain(image, (tile_width, tile_height), Image.Resampling.LANCZOS)
        x = (index % 3) * tile_width
        y = (index // 3) * (tile_height + label_height)
        sheet.paste(fitted, (x + (tile_width - fitted.width) // 2, y + (tile_height - fitted.height) // 2))
        draw.text((x + 12, y + tile_height + 8), label, fill=(245, 247, 250), font=font)
    sheet.save(destination, format="PNG", optimize=True)


def build_face_crop_sheet(
    app: FaceAnalysis,
    paths: dict[str, Path],
    destination: Path,
) -> None:
    labels = [
        "USER", "TEMPLATE", "V1", "RAW A", "CURRENT C",
        "C1", "C2", "C3", "C4",
    ]
    tile_width, image_size, label_height = 340, 256, 36
    sheet = Image.new("RGB", (tile_width * 3, (image_size + label_height) * 3), (10, 13, 20))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, label in enumerate(labels):
        image = read_image(paths[label])
        face = exactly_one_face(app, image, f"face crop {label}")
        crop = norm_crop(image, face.kps, image_size=image_size, mode="arcface")
        crop_rgb = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        x = (index % 3) * tile_width
        y = (index // 3) * (image_size + label_height)
        sheet.paste(crop_rgb, (x + (tile_width - image_size) // 2, y))
        draw.text((x + 12, y + image_size + 10), label, fill=(245, 247, 250), font=font)
    sheet.save(destination, format="PNG", optimize=True)


def load_frozen() -> tuple[dict[str, str], dict[str, np.ndarray], dict[str, Any]]:
    before = baseline_hashes()
    benchmark = json.loads((OUTPUTS / "benchmark.json").read_text(encoding="utf-8"))
    template_meta = json.loads(
        (REPO_ROOT / "templates" / TEMPLATE_ID / "template.json").read_text(encoding="utf-8")
    )
    images = {
        "user": read_image(INPUTS / "user_photo.jpg"),
        "template": read_image(INPUTS / "template.png"),
        "V1": read_image(OUTPUTS / "V1_reference.png"),
        "A": read_image(OUTPUTS / "A_raw_faceswap.png"),
        "B": read_image(OUTPUTS / "B_roi_faceswap.png"),
        "C": read_image(OUTPUTS / "C_faceswap_plus_compositor.png"),
    }
    expected = benchmark["inputs"]
    if sha256_file(INPUTS / "user_photo.jpg") != expected["user_photo"]["sha256"]:
        raise RuntimeError("frozen user photo does not match the original POC benchmark")
    if sha256_file(INPUTS / "template.png") != expected["template"]["sha256"]:
        raise RuntimeError("frozen template does not match the original POC benchmark")
    if sha256_file(OUTPUTS / "A_raw_faceswap.png") == "":
        raise RuntimeError("raw A checksum could not be read")
    return before, images, {"benchmark": benchmark, "template": template_meta}


def generate_initial() -> int:
    OUTPUTS.mkdir(parents=True, exist_ok=True)
    require_new_paths(NEW_NAMES + ("compositor-variant-metrics.json",))
    before, images, metadata = load_frozen()
    template_meta = metadata["template"]
    template = images["template"]
    user = images["user"]
    raw_a = images["A"]
    region = tuple(int(v) for v in template_meta["face_region"])
    polygon = tuple(tuple(float(x) for x in point) for point in template_meta["mask_polygon"])

    mask_started = time.perf_counter()
    inner_mask, current_mask, base_binary = build_masks(template.shape, region, polygon)
    base_mask_ms = round((time.perf_counter() - mask_started) * 1000.0, 2)

    c1_pre_started = time.perf_counter()
    c1_mask = build_wider_lower_mask(
        template.shape,
        region,
        polygon,
        current_mask,
        base_binary,
        template_meta["face_anchors"],
    )
    c1_pre_ms = round((time.perf_counter() - c1_pre_started) * 1000.0, 2)
    c1, c1_comp_ms = compose_with_identity(template, raw_a, c1_mask, "current")
    c1_path = OUTPUTS / "C1_wider_identity_mask.png"
    cv2.imwrite(str(c1_path), c1)
    mask_debug_image(template, c1_mask, "C1 — WIDER LOWER CHEEK / JAW MASK", OUTPUTS / "C1_mask_debug.png")

    c2_pre_started = time.perf_counter()
    _, c2_mask, _ = build_masks(template.shape, region, polygon)
    c2_pre_ms = round((time.perf_counter() - c2_pre_started) * 1000.0, 2)
    c2, c2_comp_ms = compose_with_identity(template, raw_a, c2_mask, "reduced")
    c2_path = OUTPUTS / "C2_reduced_harmonization.png"
    cv2.imwrite(str(c2_path), c2)
    mask_debug_image(template, c2_mask, "C2 — CURRENT MASK / REDUCED HARMONIZATION", OUTPUTS / "C2_mask_debug.png")

    c3_pre_started = time.perf_counter()
    _, c3_mask, _ = build_masks(template.shape, region, polygon)
    c3_pre_ms = round((time.perf_counter() - c3_pre_started) * 1000.0, 2)
    c3, c3_comp_ms = compose_with_identity(template, raw_a, c3_mask, "frequency")
    c3_path = OUTPUTS / "C3_frequency_identity.png"
    cv2.imwrite(str(c3_path), c3)
    mask_debug_image(template, c3_mask, "C3 — TEMPLATE LOW / USER MID-HIGH FREQUENCIES", OUTPUTS / "C3_mask_debug.png")

    app, sessions, model_init_ms = create_face_app()
    source_face, template_face = detect_embeddings(app, user, template)
    current_metric = candidate_report(
        app, source_face.normed_embedding, template_face.normed_embedding,
        user, template, images["C"], current_mask,
        metadata["benchmark"]["stages"]["compositor_ms"]["face_cheek_jaw"],
        metadata["benchmark"]["stages"]["warm_runs"]["C_median_ms"],
        base_mask_ms,
    )
    current_metric["preprocessing_ms_note"] = "Same approved C mask construction replayed and timed here; the original C run did not record mask setup separately."
    candidates = {
        "C": current_metric,
    }
    configs = (
        ("C1", c1, c1_mask, c1_pre_ms, c1_comp_ms),
        ("C2", c2, c2_mask, c2_pre_ms, c2_comp_ms),
        ("C3", c3, c3_mask, c3_pre_ms, c3_comp_ms),
    )
    for label, image, mask, pre_ms, comp_ms in configs:
        candidates[label] = candidate_report(
            app, source_face.normed_embedding, template_face.normed_embedding,
            user, template, image, mask, comp_ms, round(pre_ms + comp_ms, 2), pre_ms,
        )

    report = {
        "status": "INITIAL_VARIANTS_READY_FOR_REVIEW",
        "scope": "compositor-only variants; no face-swap inference executed",
        "frozen_baseline_sha256": before,
        "source_for_new_variants": "exact existing A_raw_faceswap.png; same user/template/model output",
        "current_C_note": "Existing C is retained unchanged and reported as the baseline; C1-C3 are recomposed from frozen raw A for a controlled compositor-only comparison.",
        "cpu_runtime": {
            "onnxruntime": ort.__version__,
            "providers": sessions,
            "face_analysis_init_ms": model_init_ms,
            "rss_peak_mb_after": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1),
        },
        "original_C_compositor_warm_ms": metadata["benchmark"]["stages"]["compositor_ms"]["face_cheek_jaw"],
        "candidates": candidates,
        "variant_design": {
            "C1": "Original frequency compositor and feathering; widen only cheek/lower-cheek/jaw/chin support progressively below the eye line.",
            "C2": "Same current mask; increase source-user mid/high luminance and chroma detail while keeping template low-frequency lighting.",
            "C3": "Explicit LAB low/mid/high decomposition; template low-frequency illumination and broad color cast, swapped-user facial mid/high detail.",
        },
        "no_restoration_or_sharpening": True,
        "human_recognizability": "requires human familiar with the user",
    }
    assert_baselines_unchanged(before)
    write_json(METRICS_PATH, report)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


def finalize_c4() -> int:
    if not METRICS_PATH.is_file():
        raise FileNotFoundError("run initial first to create C1-C3 and metrics")
    require_new_paths(FINAL_NAMES)
    before = baseline_hashes()
    report = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
    if report.get("status") != "INITIAL_VARIANTS_READY_FOR_REVIEW":
        raise RuntimeError("initial compositor variants are not in the expected review state")

    user = read_image(INPUTS / "user_photo.jpg")
    template = read_image(INPUTS / "template.png")
    raw_a = read_image(OUTPUTS / "A_raw_faceswap.png")
    template_meta = json.loads(
        (REPO_ROOT / "templates" / TEMPLATE_ID / "template.json").read_text(encoding="utf-8")
    )
    region = tuple(int(v) for v in template_meta["face_region"])
    polygon = tuple(tuple(float(x) for x in point) for point in template_meta["mask_polygon"])

    pre_started = time.perf_counter()
    _, current_mask, base_binary = build_masks(template.shape, region, polygon)
    c4_mask = build_wider_lower_mask(
        template.shape,
        region,
        polygon,
        current_mask,
        base_binary,
        template_meta["face_anchors"],
    )
    c4_pre_ms = round((time.perf_counter() - pre_started) * 1000.0, 2)
    # Human-reviewed hybrid recipe: C1's lower-face-only expansion plus a
    # moderated version of C2's identity detail authority. This does not
    # maximize ArcFace and keeps template low-frequency light authoritative.
    c4, c4_comp_ms = compose_with_identity(template, raw_a, c4_mask, "hybrid")
    c4_path = OUTPUTS / "C4_balanced_candidate.png"
    cv2.imwrite(str(c4_path), c4)
    mask_debug_image(template, c4_mask, "C4 — BALANCED HYBRID MASK", OUTPUTS / "C4_mask_debug.png")

    app, sessions, model_init_ms = create_face_app()
    source_face, template_face = detect_embeddings(app, user, template)
    c4_metrics = candidate_report(
        app, source_face.normed_embedding, template_face.normed_embedding,
        user, template, c4, c4_mask, c4_comp_ms,
        round(c4_pre_ms + c4_comp_ms, 2), c4_pre_ms,
    )
    report["candidates"]["C4"] = c4_metrics
    report["c4_strategy"] = {
        "mask": "C1 widened lower cheek/jaw mask; no forehead, hair, ears, neck, costume, or background expansion intended.",
        "frequency": "Template low-frequency illumination remains authoritative; source identity mid/high bands receive moderate C2-like strength.",
        "selection_basis": "Balanced design selected after visual review of C1-C3, not by maximizing ArcFace.",
        "face_restoration_or_sharpening": False,
    }
    report["status"] = "READY_FOR_HUMAN_REVIEW"
    report["cpu_runtime"]["c4_face_analysis_init_ms"] = model_init_ms
    report["cpu_runtime"]["providers"] = sessions

    full_paths = {
        "USER PHOTO": INPUTS / "user_photo.jpg",
        "TEMPLATE": INPUTS / "template.png",
        "V1": OUTPUTS / "V1_reference.png",
        "RAW A": OUTPUTS / "A_raw_faceswap.png",
        "CURRENT C": OUTPUTS / "C_faceswap_plus_compositor.png",
        "C1 WIDER MASK": OUTPUTS / "C1_wider_identity_mask.png",
        "C2 REDUCED HARMONIZATION": OUTPUTS / "C2_reduced_harmonization.png",
        "C3 FREQUENCY IDENTITY": OUTPUTS / "C3_frequency_identity.png",
        "C4 BALANCED": c4_path,
    }
    full_sheet = OUTPUTS / "basic-v2-human-review.png"
    crops_sheet = OUTPUTS / "basic-v2-face-crops-review.png"
    build_full_contact_sheet(full_paths, full_sheet)
    face_crop_paths = {
        "USER": INPUTS / "user_photo.jpg",
        "TEMPLATE": INPUTS / "template.png",
        "V1": OUTPUTS / "V1_reference.png",
        "RAW A": OUTPUTS / "A_raw_faceswap.png",
        "CURRENT C": OUTPUTS / "C_faceswap_plus_compositor.png",
        "C1": OUTPUTS / "C1_wider_identity_mask.png",
        "C2": OUTPUTS / "C2_reduced_harmonization.png",
        "C3": OUTPUTS / "C3_frequency_identity.png",
        "C4": c4_path,
    }
    build_face_crop_sheet(app, face_crop_paths, crops_sheet)
    report["contact_sheets"] = {
        "full_image": str(full_sheet.relative_to(EXPERIMENT_ROOT)),
        "aligned_face_crops": str(crops_sheet.relative_to(EXPERIMENT_ROOT)),
        "face_crop_alignment": "InsightFace ArcFace 5-point norm_crop at 256x256; same framing/scale for each panel.",
    }
    report["rss_peak_mb_after"] = max(
        float(report["cpu_runtime"]["rss_peak_mb_after"]),
        round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0, 1),
    )
    assert_baselines_unchanged(before)
    write_json(METRICS_PATH, report)

    review = {
        "status": "READY FOR HUMAN REVIEW",
        "review_gate": "A person who knows the user must decide whether the final face is clearly recognizable.",
        "automated_arcface_is_not_a_human_recognizability_decision": True,
        "reviewed_candidates": ["C", "C1", "C2", "C3", "C4"],
        "criteria": {},
        "recommendation": "Review C4 first, with current C, C1, C2, and C3 alongside it. C4 intentionally balances the lower-face mask expansion with moderated identity detail.",
        "technical_concern": "The public InsightFace checkpoints remain non-commercial research/evaluation only. No production use or clearance is implied.",
    }
    write_json(OUTPUTS / "compositor-visual-review.json", review)
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("initial", "c4"))
    args = parser.parse_args()
    if args.phase == "initial":
        return generate_initial()
    return finalize_c4()


if __name__ == "__main__":
    raise SystemExit(main())
