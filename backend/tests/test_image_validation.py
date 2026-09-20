"""Unit tests for photo validation (workflow step 2).

Real validation behaviour: a valid image passes, non-images / truncated /
oversized / wrong-type files fail with an explicit reason.
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from app.core.config import get_settings
from app.services.image_validation import (
    ImageValidationError,
    normalize_for_provider,
    validate_image_bytes,
)
from conftest import make_jpeg, make_png


def test_valid_jpeg_passes():
    data = make_jpeg(640, 480)
    result = validate_image_bytes(data, content_type="image/jpeg")
    assert result.width == 640
    assert result.height == 480
    assert result.format == "JPEG"
    assert result.size_bytes == len(data)
    assert len(result.sha256) == 64


def test_valid_png_passes():
    data = make_png(512, 512)
    result = validate_image_bytes(data, content_type="image/png")
    assert result.format == "PNG"
    assert (result.width, result.height) == (512, 512)


def test_empty_file_rejected():
    with pytest.raises(ImageValidationError, match="empty"):
        validate_image_bytes(b"", content_type="image/jpeg")


def test_non_image_rejected():
    with pytest.raises(ImageValidationError, match="could not be decoded"):
        validate_image_bytes(b"this is definitely not an image", content_type="image/jpeg")


def test_wrong_content_type_rejected():
    data = make_jpeg()
    with pytest.raises(ImageValidationError, match="Unsupported content type"):
        validate_image_bytes(data, content_type="application/pdf")


def test_oversized_file_rejected():
    settings = get_settings()
    big = b"\xff\xd8\xff" + b"\x00" * (settings.upload_max_bytes + 1)
    with pytest.raises(ImageValidationError, match="too large"):
        validate_image_bytes(big, content_type="image/jpeg")


def test_too_small_dimensions_rejected():
    settings = get_settings()
    small_side = settings.upload_min_dimension - 1
    data = make_jpeg(small_side, small_side)
    with pytest.raises(ImageValidationError, match="too small"):
        validate_image_bytes(data, content_type="image/jpeg")


def test_too_large_dimensions_rejected():
    # Building an 8001px image is heavy; instead patch the limit down and
    # assert the guard fires. The guard logic is what we are testing.
    settings = get_settings()
    original = settings.upload_max_dimension
    try:
        settings.upload_max_dimension = 300
        data = make_jpeg(640, 480)
        with pytest.raises(ImageValidationError, match="too large"):
            validate_image_bytes(data, content_type="image/jpeg")
    finally:
        settings.upload_max_dimension = original


def test_truncated_jpeg_rejected():
    data = make_jpeg(640, 480)
    truncated = data[: len(data) // 2]
    with pytest.raises(ImageValidationError):
        validate_image_bytes(truncated, content_type="image/jpeg")


def test_rgba_png_normalized_to_rgb_jpeg():
    img = Image.new("RGBA", (1600, 900), (10, 200, 10, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    out_bytes, content_type = normalize_for_provider(buf.getvalue(), max_side=1024)
    assert content_type == "image/jpeg"
    assert out_bytes[:3] == b"\xff\xd8\xff"

    with Image.open(io.BytesIO(out_bytes)) as out:
        out.load()
        assert out.mode == "RGB"
        # longest side capped
        assert max(out.size) <= 1024


def test_normalize_does_not_upscale_small_images():
    out_bytes, _ = normalize_for_provider(make_jpeg(300, 200), max_side=1024)
    with Image.open(io.BytesIO(out_bytes)) as out:
        out.load()
        assert out.size == (300, 200)


def test_normalize_reduces_oversized_image():
    out_bytes, _ = normalize_for_provider(make_jpeg(2000, 1000), max_side=1536)
    with Image.open(io.BytesIO(out_bytes)) as out:
        out.load()
        assert max(out.size) == 1536
        assert out.size[0] > out.size[1]  # aspect ratio preserved
