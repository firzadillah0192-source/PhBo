#!/usr/bin/env python3
"""Generate Basic contour and identity D/E/F artifacts from identical inputs."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.generation.basic.engine import BasicGenerationEngine  # noqa: E402
from app.templates_registry import TemplateRegistry  # noqa: E402


CASES = (
    ("D-current-C-reference", "stronger_identity", "frozen current C reference"),
    (
        "E-soft-contour-current-texture",
        "soft_contour",
        "soft facial contour + current C texture",
    ),
    (
        "F-soft-contour-user-identity",
        "soft_contour_identity",
        "soft facial contour + warped user identity texture + template lighting",
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--user",
        type=Path,
        default=Path("/srv/photobooth/uploads/90/901231a667ea43108502b86326c7c6c9.jpg"),
    )
    parser.add_argument(
        "--templates-dir",
        type=Path,
        default=Path("/srv/photobooth/templates"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "testimage" / "basic-soft-contour-regression",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    template_id = "sci-fi-space-commander-001"
    template = TemplateRegistry(args.templates_dir).get(template_id)
    template_path = args.templates_dir / template_id / str(template.asset_filename)
    if not args.user.is_file() or not template_path.is_file():
        raise SystemExit("user or template fixture is missing")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    summary = {
        "manual_review_required": True,
        "production_default_changed": False,
        "inputs": {"user": str(args.user), "template": str(template_path)},
        "cases": {},
    }
    engine = BasicGenerationEngine()
    for directory, profile, description in CASES:
        case_dir = args.output_dir / directory
        final_path = case_dir / "final.png"
        debug_dir = case_dir / "debug"
        if final_path.exists() or debug_dir.exists():
            raise SystemExit(f"refusing to overwrite existing regression case: {case_dir}")
        result = engine.generate(
            args.user,
            template_id,
            final_path,
            {
                "template": template,
                "template_path": template_path,
                "landmark_backend": "real",
                "identity_profile": profile,
                "debug_dir": debug_dir,
                "measure_final_geometry": True,
            },
        )
        geometry_path = debug_dir / "geometry.json"
        diagnostics = json.loads(geometry_path.read_text(encoding="utf-8"))
        summary["cases"][directory] = {
            "description": description,
            "profile": diagnostics["identity_profile"],
            "final_image": result.output_path,
            "target_morph_mesh": str(debug_dir / "07_piecewise_mesh.jpg"),
            "target_morph_landmarks": str(debug_dir / "06_target_morph.jpg"),
            "jaw_cheek_overlay": str(debug_dir / "11_jaw_cheek_overlay.jpg"),
            "texture_mask": str(debug_dir / "12_texture_mask.png"),
            "texture_mask_overlay": str(debug_dir / "09_texture_transfer.jpg"),
            "warped_raw_user_face": str(debug_dir / "13_warped_raw_user_face.jpg"),
            "color_harmonized_user_face": str(debug_dir / "14_color_harmonized_user_face.jpg"),
            "final_blend": str(debug_dir / "15_final_blend.png"),
            "contour_categories": str(debug_dir / "16_contour_categories.jpg"),
            "geometry_metrics": str(geometry_path),
            "measurements": diagnostics["shared_geometry_measurements"],
            "boundary_audit": diagnostics["landmark_backend"].get("boundary_audit", []),
            "semantic_landmark_count": diagnostics["source"]["dense_landmark_count"],
            "delaunay_triangle_count": diagnostics["delaunay_triangle_count"],
        }
    summary_path = args.output_dir / "regression-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(summary_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
