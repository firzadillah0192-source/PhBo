"""Unit tests for photo validation (workflow step 2).

Real validation behaviour: a valid image passes, non-images / truncated /
oversized / wrong-type files fail with an explicit reason.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image, ImageCms

from app.core.config import get_settings
from app.services.image_validation import (
    ImageValidationError,
    normalize_for_provider,
    normalize_uploaded_image,
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
    with pytest.raises(ImageValidationError, match="could not be decoded") as excinfo:
        validate_image_bytes(b"this is definitely not an image", content_type="image/jpeg")
    assert excinfo.value.code == "IMAGE_DECODE_FAILED"


def test_decodable_but_unsupported_format_has_specific_code():
    buffer = io.BytesIO()
    Image.new("RGB", (640, 480)).save(buffer, format="GIF")
    with pytest.raises(ImageValidationError) as excinfo:
        validate_image_bytes(buffer.getvalue(), content_type="image/gif")
    assert excinfo.value.code == "UNSUPPORTED_IMAGE_FORMAT"


def test_valid_image_is_accepted_with_unusual_or_empty_mime():
    data = make_jpeg()
    assert validate_image_bytes(data, content_type="application/pdf").format == "JPEG"
    assert validate_image_bytes(data, content_type="").format == "JPEG"


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


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_customer_image_normalizes_to_canonical_jpeg(fmt):
    buffer = io.BytesIO()
    Image.new("RGB", (640, 480), (90, 120, 170)).save(buffer, format=fmt)
    result = normalize_uploaded_image(buffer.getvalue(), content_type="application/octet-stream")
    assert result.source_format == fmt
    assert (result.width, result.height) == (640, 480)
    assert result.data[:3] == b"\xff\xd8\xff"
    with Image.open(io.BytesIO(result.data)) as normalized:
        normalized.load()
        assert normalized.format == "JPEG"
        assert normalized.mode == "RGB"


def test_upload_normalization_physically_applies_exif_orientation():
    image = Image.new("RGB", (640, 480), (30, 60, 90))
    exif = image.getexif()
    exif[274] = 6  # rotate 90 degrees clockwise for display
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)

    result = normalize_uploaded_image(buffer.getvalue())
    assert (result.width, result.height) == (480, 640)
    with Image.open(io.BytesIO(result.data)) as normalized:
        normalized.load()
        assert normalized.size == (480, 640)
        assert normalized.getexif().get(274) in (None, 1)


def test_upload_normalization_converts_embedded_icc_profile_to_srgb():
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    image = Image.new("RGB", (640, 480), (100, 120, 140))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", icc_profile=profile)

    result = normalize_uploaded_image(buffer.getvalue())
    with Image.open(io.BytesIO(result.data)) as normalized:
        normalized.load()
        assert "icc_profile" not in normalized.info
        assert normalized.mode == "RGB"


def test_synthetic_heif_decode_applies_exif_orientation():
    pytest.importorskip("pillow_heif")
    fixture = Path(__file__).parent / "fixtures" / "synthetic-oriented.heic"
    result = normalize_uploaded_image(fixture.read_bytes(), content_type="image/heic")
    assert result.source_format == "HEIF"
    assert (result.width, result.height) == (480, 640)
    assert result.data[:3] == b"\xff\xd8\xff"
