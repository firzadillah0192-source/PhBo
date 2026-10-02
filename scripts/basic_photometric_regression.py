#!/usr/bin/env python3
"""Create controlled G/H/I Basic texture-integration regression artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.generation.basic.engine import BasicGenerationEngine  # noqa: E402
from app.templates_registry import TemplateRegistry  # noqa: E402


CASES = (
    ("H", "frequency_identity", "template low-frequency lighting + user mid/high detail"),
    (
        "I",
        "frequency_identity_contrast",
        "H + bounded local feature contrast + slightly reduced texture authority",
    ),
)
F_DEBUG_PNGS = {
    "geometry_base": "17_geometry_base.png",
    "warped_user": "19_f_warped_user.png",
    "harmonized_user": "20_f_harmonized_user.png",
    "reconstructed_multiband": "21_f_reconstructed_multiband.png",
}
REQUIRED_FREQUENCY_DEBUG = (
    "01_template_low_frequency.png",
    "02_user_warped.png",
    "03_user_low_frequency.png",
    "04_user_mid_frequency.png",
    "05_user_high_frequency.png",
    "06_frequency_composite.png",
    "07_mask.png",
    "08_pre_contrast.png",
    "09_post_contrast.png",
    "10_final.png",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--user",
        type=Path,
        default=Path("/srv/photobooth/uploads/90/901231a667ea43108502b86326c7c6c9.jpg"),
    )
    parser.add_argument("--templates-dir", type=Path, default=Path("/srv/photobooth/templates"))
    parser.add_argument(
        "--f-reference-dir",
        type=Path,
        default=REPO_ROOT / "testimage" / "basic-soft-contour-regression" / "F-soft-contour-user-identity",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "testimage" / "basic-photometric-regression",
    )
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def face_roi_mask(image_shape: tuple[int, ...], geometry: dict) -> np.ndarray:
    height, width = image_shape[:2]
    points = geometry["target_morph_landmarks"]
    polygon = np.asarray(
        [points[f"inner_boundary_{index:02d}"] for index in range(19)],
        dtype=np.float32,
    )
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask, [np.rint(polygon).astype(np.int32)], 255)
    distance = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    return distance > 8.0


def image_metrics(image_path: Path, roi: np.ndarray) -> dict:
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None or image.shape[:2] != roi.shape:
        raise RuntimeError(f"cannot measure photometric image {image_path}")
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    active = np.asarray(roi, dtype=bool)
    if int(active.sum()) < 100:
        raise RuntimeError("inner-face measurement ROI is unexpectedly small")
    luminance = lab[..., 0]
    local_base = cv2.GaussianBlur(luminance, (0, 0), 3.0, 3.0)
    highpass = luminance - local_base
    return {
        "roi_pixels": int(active.sum()),
        "mean_luminance_L_0_255": round(float(luminance[active].mean()), 3),
        "luminance_std_L_0_255": round(float(luminance[active].std()), 3),
        "local_rms_contrast_L_sigma3": round(float(np.sqrt(np.mean(np.square(highpass[active])))), 3),
        "color_mean_Lab_8bit": [round(float(value), 3) for value in lab[active].mean(axis=0)],
        "color_std_Lab_8bit": [round(float(value), 3) for value in lab[active].std(axis=0)],
    }


def mask_boundary_metrics(mask_path: Path, geometry: dict) -> dict:
    mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    if mask is None:
        raise RuntimeError(f"cannot read texture mask {mask_path}")
    points = np.asarray(
        [geometry["target_morph_landmarks"][f"inner_boundary_{index:02d}"] for index in range(19)],
        dtype=np.float32,
    )
    inside = np.zeros(mask.shape, dtype=np.uint8)
    cv2.fillPoly(inside, [np.rint(points).astype(np.int32)], 255)
    outside = mask[inside == 0]
    return {
        "nonzero_pixels_outside_target_face_contour": int(np.count_nonzero(outside)),
        "max_alpha_outside_target_face_contour_8bit": int(outside.max(initial=0)),
        "strictly_inward_only": bool(not np.any(outside)),
    }


def assert_same_geometry(reference: dict, candidate: dict, case_name: str) -> None:
    for key in (
        "target_morph_landmarks",
        "target_morph_normalized_landmarks",
        "landmark_group_weights",
        "geometry_mask",
        "geometry_measurements",
        "delaunay_triangle_count",
    ):
        if reference.get(key) != candidate.get(key):
            raise RuntimeError(f"{case_name} changed frozen F geometry field {key}")


def main() -> int:
    args = parse_args()
    template_id = "sci-fi-space-commander-001"
    f_final = args.f_reference_dir / "final.png"
    f_geometry_path = args.f_reference_dir / "debug" / "geometry.json"
    if not args.user.is_file() or not f_final.is_file() or not f_geometry_path.is_file():
        raise SystemExit("user fixture or frozen F reference is missing")
    template = TemplateRegistry(args.templates_dir).get(template_id)
    template_path = args.templates_dir / template_id / str(template.asset_filename)
    if not template_path.is_file():
        raise SystemExit("sci-fi template fixture is missing")
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        raise SystemExit(f"refusing to overwrite existing regression artifacts: {args.output_dir}")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    g_dir = args.output_dir / "G-frozen-F-reference"
    g_dir.mkdir()
    g_final = g_dir / "final.png"
    shutil.copyfile(f_final, g_final)
    if g_final.read_bytes() != f_final.read_bytes():
        raise RuntimeError("G is not byte-identical to the frozen F reference")

    engine = BasicGenerationEngine()
    f_audit_dir = args.output_dir / "_F-stage-audit"
    f_audit_dir.mkdir()
    f_rerender = f_audit_dir / "final.png"
    f_debug = f_audit_dir / "debug"
    engine.generate(
        args.user,
        template_id,
        f_rerender,
        {
            "template": template,
            "template_path": template_path,
            "landmark_backend": "real",
            "identity_profile": "soft_contour_identity",
            "debug_dir": f_debug,
            "capture_photometric_debug": True,
        },
    )
    if f_rerender.read_bytes() != f_final.read_bytes():
        raise RuntimeError("instrumented F rerender differs from the frozen F reference")
    f_geometry = load_json(f_geometry_path)
    rerender_geometry = load_json(f_debug / "geometry.json")
    assert_same_geometry(f_geometry, rerender_geometry, "F audit rerender")
    f_roi = face_roi_mask(cv2.imread(str(f_final)).shape, f_geometry)

    f_stages = {name: f_debug / filename for name, filename in F_DEBUG_PNGS.items()}
    f_stages["final_f"] = f_final
    f_metrics = {name: image_metrics(path, f_roi) for name, path in f_stages.items()}
    f_metrics["reconstructed_multiband"] = dict(f_metrics["final_f"])
    f_metrics_path = f_audit_dir / "photometric_metrics.json"
    f_metrics_path.write_text(json.dumps(f_metrics, indent=2) + "\n", encoding="utf-8")

    cases = {}
    for label, profile, description in CASES:
        case_dir = args.output_dir / f"{label}-frequency-texture"
        case_dir.mkdir()
        final_path = case_dir / "final.png"
        debug_dir = case_dir / "debug"
        engine.generate(
            args.user,
            template_id,
            final_path,
            {
                "template": template,
                "template_path": template_path,
                "landmark_backend": "real",
                "identity_profile": profile,
                "debug_dir": debug_dir,
                "capture_photometric_debug": True,
                "measure_final_geometry": True,
            },
        )
        diagnostics = load_json(debug_dir / "geometry.json")
        assert_same_geometry(f_geometry, diagnostics, label)
        geometry_base = cv2.imread(str(debug_dir / "11_geometry_base.png"), cv2.IMREAD_COLOR)
        reference_geometry_base = cv2.imread(str(f_stages["geometry_base"]), cv2.IMREAD_COLOR)
        if geometry_base is None or not np.array_equal(geometry_base, reference_geometry_base):
            raise RuntimeError(f"{label} geometry base pixels differ from F")
        missing = [name for name in REQUIRED_FREQUENCY_DEBUG if not (debug_dir / name).is_file()]
        if missing:
            raise RuntimeError(f"{label} is missing required frequency debug images: {missing}")
        if (debug_dir / "10_final.png").read_bytes() != final_path.read_bytes():
            raise RuntimeError(f"{label} debug final differs from its output image")

        roi = face_roi_mask(geometry_base.shape, diagnostics)
        mask_metrics = mask_boundary_metrics(debug_dir / "07_mask.png", diagnostics)
        if not mask_metrics["strictly_inward_only"]:
            raise RuntimeError(f"{label} texture mask escaped the target facial contour")
        stages = {
            "template_geometry_base": debug_dir / "11_geometry_base.png",
            "warped_user": debug_dir / "02_user_warped.png",
            "user_low_frequency": debug_dir / "03_user_low_frequency.png",
            "frequency_reconstruction": debug_dir / "06_frequency_composite.png",
            "pre_contrast": debug_dir / "08_pre_contrast.png",
            "post_contrast": debug_dir / "09_post_contrast.png",
            "final": final_path,
        }
        cases[label] = {
            "profile": diagnostics["identity_profile"],
            "description": description,
            "final_image": str(final_path),
            "debug_dir": str(debug_dir),
            "debug_artifacts": {name: str(debug_dir / name) for name in REQUIRED_FREQUENCY_DEBUG},
            "geometry_base_sha256": sha256(debug_dir / "11_geometry_base.png"),
            "frozen_geometry_exact": True,
            "mask_boundary": mask_metrics,
            "photometric_metrics": {name: image_metrics(path, roi) for name, path in stages.items()},
        }

    summary = {
        "manual_visual_review_required": True,
        "production_profile_changed": False,
        "deployed": False,
        "inputs": {"user": str(args.user), "template": str(template_path)},
        "frozen_geometry": {
            "reference": str(f_geometry_path),
            "target_morph_sha256": hashlib.sha256(
                json.dumps(f_geometry["target_morph_landmarks"], sort_keys=True).encode("utf-8")
            ).hexdigest(),
            "geometry_base_sha256": sha256(f_stages["geometry_base"]),
            "H_and_I_exact": True,
        },
        "G": {
            "final_image": str(g_final),
            "reference_image": str(f_final),
            "byte_identical_to_F": g_final.read_bytes() == f_final.read_bytes(),
            "sha256": sha256(g_final),
        },
        "F_stage_audit": {
            "instrumented_rerender_matches_F": True,
            "debug_dir": str(f_debug),
            "pyramid_layers": str(f_debug / "18_f_multiband_pyramid_layers.png"),
            "photometric_metrics": str(f_metrics_path),
            "stage_metrics": f_metrics,
        },
        "cases": cases,
    }
    summary_path = args.output_dir / "regression-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(summary_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
