"""Basic Local engine and result lifecycle tests."""

from __future__ import annotations

import io

import cv2
import numpy as np
import pytest
from PIL import Image

from app.generation.basic.engine import BasicGenerationEngine
from app.generation.basic.errors import (
    BasicFaceNotFoundError,
    BasicMultipleFacesError,
    BasicTemplateMetadataMissingError,
)
from app.generation.basic.landmarks import FaceBox, estimate_landmarks
from app.templates_registry import TemplateDefinition
from conftest import make_jpeg


def _template(tmp_path):
    path = tmp_path / "template.png"
    Image.new("RGB", (256, 256), (24, 40, 70)).save(path, "PNG")
    definition = TemplateDefinition(
        id="test-template", name="Test", description="", prompt="", width=256, height=256,
        asset_filename="template.png", face_region=(70, 30, 116, 160),
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
    result = BasicGenerationEngine().generate(source, definition.id, output, {"template": definition, "template_path": template_path})
    assert result.status == "EXPERIMENTAL"
    assert result.engine_name == "basic-local"
    assert output.exists() and output.stat().st_size > 0
    assert Image.open(output).format == "PNG"
    assert output.read_bytes() != template_path.read_bytes()


def test_no_face_error_from_engine(tmp_path, monkeypatch):
    definition, template_path = _template(tmp_path)
    _engine_with_detection(monkeypatch)
    import app.generation.basic.engine as module
    monkeypatch.setattr(module, "detect_exactly_one_face", lambda image: (_ for _ in ()).throw(BasicFaceNotFoundError("BASIC_FACE_NOT_FOUND")))
    source = tmp_path / "user.jpg"
    source.write_bytes(make_jpeg())
    with pytest.raises(BasicFaceNotFoundError):
        BasicGenerationEngine().generate(source, definition.id, tmp_path / "out.png", {"template": definition, "template_path": template_path})


def test_multiple_faces_error_from_engine(tmp_path, monkeypatch):
    definition, template_path = _template(tmp_path)
    _engine_with_detection(monkeypatch)
    import app.generation.basic.engine as module
    monkeypatch.setattr(module, "detect_exactly_one_face", lambda image: (_ for _ in ()).throw(BasicMultipleFacesError("BASIC_MULTIPLE_FACES")))
    source = tmp_path / "user.jpg"
    source.write_bytes(make_jpeg())
    with pytest.raises(BasicMultipleFacesError):
        BasicGenerationEngine().generate(source, definition.id, tmp_path / "out.png", {"template": definition, "template_path": template_path})


def test_template_metadata_missing(tmp_path):
    source = tmp_path / "user.jpg"
    source.write_bytes(make_jpeg())
    with pytest.raises(BasicTemplateMetadataMissingError) as excinfo:
        BasicGenerationEngine().generate(source, "missing", tmp_path / "out.png", {"template": None})
    assert excinfo.value.code == "BASIC_TEMPLATE_METADATA_MISSING"
