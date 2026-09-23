"""Basic Local engine and result lifecycle tests."""

from __future__ import annotations

import io

import cv2
import numpy as np
import pytest
from PIL import Image

from app.generation.basic.engine import BasicGenerationEngine
from app.generation.basic.dense import DenseLandmarks, canonicalize, morph_toward_template
from app.generation.basic.errors import (
    BasicFaceNotFoundError,
    BasicMultipleFacesError,
    BasicTemplateMetadataMissingError,
)
from app.generation.basic.landmarks import FaceBox, estimate_landmarks
from app.generation.basic.profiles import SOFT_CONTOUR_LIMITS, SOFT_CONTOUR_MORPHOLOGY, get_identity_profile
from app.generation.basic.real_landmarks import BOUNDARY_SAMPLE_CLASSIFICATION, _make_dense
from app.templates_registry import TemplateDefinition
from conftest import make_jpeg


def _template(tmp_path):
    path = tmp_path / "template.png"
    Image.new("RGB", (256, 256), (24, 40, 70)).save(path, "PNG")
    definition = TemplateDefinition(
        id="test-template", name="Test", description="", prompt="", width=256, height=256,
        asset_filename="template.png", face_region=(70, 30, 116, 160),
        face_anchors={
            "left_eye": (106, 91), "right_eye": (150, 91), "nose": (128, 120),
            "mouth": (128, 148), "chin": (128, 175),
        },
        mask_polygon=((94, 82), (162, 82), (170, 126), (152, 163), (128, 176),
                      (104, 163), (86, 126)),
    )
    return definition, path

def _engine_with_detection(monkeypatch, box=FaceBox(40, 20, 120, 160)):
    import app.generation.basic.engine as module
    monkeypatch.setattr(module, "detect_exactly_one_face", lambda image: box)
    monkeypatch.setattr(module, "estimate_landmarks", estimate_landmarks)


def test_single_face_is_aligned_and_real_png_is_created(tmp_path, monkeypatch):
    definition, template_path = _template(tmp_path)
    _engine_with_detection(monkeypatch)
    source = tmp_path / "user.jpg"
    source.write_bytes(make_jpeg(240, 240, color=(170, 130, 105)))
    output = tmp_path / "session" / "result.png"
    result = BasicGenerationEngine().generate(source, definition.id, output, {"template": definition, "template_path": template_path, "landmark_backend": "scaffold"})
    assert result.status == "EXPERIMENTAL"
    assert result.engine_name == "basic-local"
    assert output.exists() and output.stat().st_size > 0
    assert Image.open(output).format == "PNG"
    assert output.read_bytes() != template_path.read_bytes()
    debug_dir = output.parent / "basic-debug"
    assert {path.name for path in debug_dir.iterdir()} == {
        "01_source_dense_landmarks.jpg", "02_template_dense_landmarks.jpg",
        "03_normalized_landmark_comparison.jpg", "04_target_morph_landmarks.jpg",
        "05_delaunay_mesh.jpg", "06_template_morphed.jpg",
        "07_identity_texture_regions.jpg", "08_final_composite.jpg",
        "09_jaw_cheek_overlay.jpg", "10_texture_mask.png", "geometry.json",
    }
    diagnostics = __import__("json").loads((debug_dir / "geometry.json").read_text())
    assert diagnostics["architecture"] == "template_morphology_plus_controlled_identity_texture"
    assert diagnostics["coordinate_system"].startswith("pixel_xy")
    assert diagnostics["registration"]["scale"] == pytest.approx(44 / 45.6, rel=1e-4)
    assert diagnostics["source"]["dense_landmark_count"] >= 50
    assert diagnostics["template"]["dense_landmark_count"] >= 50
    assert diagnostics["morphology_transform_residual"]["max_target_to_template_px"] >= 0
    assert diagnostics["identity_profile"]["name"] == "production"
    assert diagnostics["identity_profile"]["production_default_unchanged"] is True
    assert diagnostics["geometry_measurements"]["face_width_px"]["target"] == pytest.approx(
        diagnostics["geometry_measurements"]["face_width_px"]["template"], abs=0.001
    )


def test_identity_profiles_separate_morphology_texture_and_mesh():
    production = get_identity_profile("production")
    morphology = get_identity_profile("stronger_morphology")
    identity = get_identity_profile("stronger_identity")
    assert {key: production.morphology_strength[key] for key in (
        "eyes", "eyebrows", "nose", "mouth", "cheeks", "jaw", "chin", "inner_boundary"
    )} == {
        "eyes": 0.45, "eyebrows": 0.40, "nose": 0.40, "mouth": 0.45,
        "cheeks": 0.35, "jaw": 0.30, "chin": 0.25, "inner_boundary": 0.0,
    }
    assert all(value == 0.0 for key, value in production.morphology_strength.items() if key.endswith("boundary"))
    assert dict(morphology.identity_texture_strength) == dict(production.identity_texture_strength)
    assert dict(identity.morphology_strength) == dict(morphology.morphology_strength)
    assert dict(identity.identity_texture_strength) != dict(production.identity_texture_strength)
    assert production.mesh_profile == morphology.mesh_profile == "semantic_72"
    assert identity.mesh_profile == "semantic_166"


def test_soft_contour_classes_and_movement_limits():
    assert len(BOUNDARY_SAMPLE_CLASSIFICATION) == 19
    assert sum(item[2] == "HARD_TEMPLATE_BOUNDARY" for item in BOUNDARY_SAMPLE_CLASSIFICATION) == 5
    assert sum(item[2] == "SOFT_FACE_BOUNDARY" for item in BOUNDARY_SAMPLE_CLASSIFICATION) == 14

    points = {
        "left_eye_center": np.asarray((-0.5, 0.0), dtype=np.float32),
        "right_eye_center": np.asarray((0.5, 0.0), dtype=np.float32),
        "nose_tip": np.asarray((0.0, 0.5), dtype=np.float32),
        "mouth_center": np.asarray((0.0, 1.0), dtype=np.float32),
        "chin": np.asarray((0.0, 1.6), dtype=np.float32),
    }
    groups = {
        "left_eye_center": "eyes", "right_eye_center": "eyes", "nose_tip": "nose",
        "mouth_center": "mouth", "chin": "chin",
    }
    for index, (region, group, _) in enumerate(BOUNDARY_SAMPLE_CLASSIFICATION):
        angle = -np.pi / 2 + 2 * np.pi * index / 19
        name = f"inner_boundary_{index:02d}"
        points[name] = np.asarray((0.5 * np.cos(angle), 0.8 + 0.5 * np.sin(angle)), dtype=np.float32)
        groups[name] = group
    template = DenseLandmarks(points, groups)
    source_points = {name: point.copy() for name, point in points.items()}
    for index, (region, group, _) in enumerate(BOUNDARY_SAMPLE_CLASSIFICATION):
        if group != "hard_template_boundary":
            name = f"inner_boundary_{index:02d}"
            direction = -1.0 if points[name][0] < 0 else 1.0
            source_points[name] += np.asarray((direction * 0.2, 0.1), dtype=np.float32)
    source = DenseLandmarks(source_points, groups)
    target_pixels, _, _, _ = morph_toward_template(
        source, template, SOFT_CONTOUR_MORPHOLOGY, SOFT_CONTOUR_LIMITS
    )
    target = DenseLandmarks(target_pixels, groups)
    template_normalized = canonicalize(template)
    target_normalized = canonicalize(target)
    face_width = max(point[0] for point in template_normalized.values()) - min(
        point[0] for point in template_normalized.values()
    )
    for index, (_, group, _) in enumerate(BOUNDARY_SAMPLE_CLASSIFICATION):
        name = f"inner_boundary_{index:02d}"
        movement = float(np.linalg.norm(target_normalized[name] - template_normalized[name]))
        if group == "hard_template_boundary":
            assert movement == pytest.approx(0.0, abs=1e-6)
        else:
            assert movement > 0.0
            assert movement <= SOFT_CONTOUR_LIMITS[group] * face_width + 1e-6


def test_dense_semantic_mesh_has_166_selected_controls():
    points = np.asarray([(float(index), float(index % 17)) for index in range(478)], dtype=np.float32)
    dense = _make_dense(points, "semantic_166")
    assert len(dense.points) == 166
    assert sum(group == "inner_boundary" for group in dense.groups.values()) == 19
    assert {"eyes", "eyebrows", "nose", "mouth", "cheeks", "jaw", "chin", "inner_boundary"} == set(dense.groups.values())


def test_no_face_error_from_engine(tmp_path, monkeypatch):
    definition, template_path = _template(tmp_path)
    _engine_with_detection(monkeypatch)
    import app.generation.basic.engine as module
    monkeypatch.setattr(module, "detect_exactly_one_face", lambda image: (_ for _ in ()).throw(BasicFaceNotFoundError("BASIC_FACE_NOT_FOUND")))
    source = tmp_path / "user.jpg"
    source.write_bytes(make_jpeg())
    with pytest.raises(BasicFaceNotFoundError):
        BasicGenerationEngine().generate(source, definition.id, tmp_path / "out.png", {"template": definition, "template_path": template_path, "landmark_backend": "scaffold"})


def test_multiple_faces_error_from_engine(tmp_path, monkeypatch):
    definition, template_path = _template(tmp_path)
    _engine_with_detection(monkeypatch)
    import app.generation.basic.engine as module
    monkeypatch.setattr(module, "detect_exactly_one_face", lambda image: (_ for _ in ()).throw(BasicMultipleFacesError("BASIC_MULTIPLE_FACES")))
    source = tmp_path / "user.jpg"
    source.write_bytes(make_jpeg())
    with pytest.raises(BasicMultipleFacesError):
        BasicGenerationEngine().generate(source, definition.id, tmp_path / "out.png", {"template": definition, "template_path": template_path, "landmark_backend": "scaffold"})


def test_template_metadata_missing(tmp_path):
    source = tmp_path / "user.jpg"
    source.write_bytes(make_jpeg())
    with pytest.raises(BasicTemplateMetadataMissingError) as excinfo:
        BasicGenerationEngine().generate(source, "missing", tmp_path / "out.png", {"template": None})
    assert excinfo.value.code == "BASIC_TEMPLATE_METADATA_MISSING"


def test_template_without_explicit_anchors_is_rejected(tmp_path):
    definition, template_path = _template(tmp_path)
    definition = TemplateDefinition(
        id=definition.id, name=definition.name, description="", prompt="", width=256, height=256,
        asset_filename="template.png", face_region=definition.face_region,
    )
    source = tmp_path / "user.jpg"
    source.write_bytes(make_jpeg())
    with pytest.raises(BasicTemplateMetadataMissingError):
        BasicGenerationEngine().generate(
            source, definition.id, tmp_path / "out.png",
            {"template": definition, "template_path": template_path, "landmark_backend": "scaffold"},
        )
