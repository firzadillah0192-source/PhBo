"""Validated, atomic filesystem storage for admin image assets."""
from __future__ import annotations

import io
import uuid
from pathlib import Path

from PIL import Image
from app.core.config import get_settings
from app.services.image_validation import validate_image_bytes

_ADMIN_IMAGE_TYPES = {
    "JPEG": {"image/jpeg", "image/jpg"},
    "PNG": {"image/png"},
    "WEBP": {"image/webp"},
}



def save_admin_image(data: bytes, *, content_type: str | None, target: Path) -> tuple[int, int]:
    if content_type and content_type.lower() not in {
        value for values in _ADMIN_IMAGE_TYPES.values() for value in values
    }:
        raise ValueError("Only JPG, JPEG, PNG, and WebP images are allowed.")

    # Validate size, decodability, and configured dimensions before touching
    # the destination. The actual image format is checked below as well so a
    # spoofed multipart MIME type cannot pass.
    validated = validate_image_bytes(data, content_type=None)
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        image_format = (image.format or "").upper()
        if image_format not in _ADMIN_IMAGE_TYPES:
            raise ValueError("Only JPG, JPEG, PNG, and WebP images are allowed.")
        if content_type and content_type.lower() not in _ADMIN_IMAGE_TYPES[image_format]:
            raise ValueError("Uploaded MIME type does not match the image format.")
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        settings = get_settings()
        temp_dir = settings.tmp_dir / "admin-assets"
        temp_dir.mkdir(parents=True, exist_ok=True)
        temp = temp_dir / f"{uuid.uuid4().hex}.tmp"
        temp_target = temp.with_suffix(".png")
        try:
            image.save(temp_target, format="PNG")
            target.parent.mkdir(parents=True, exist_ok=True)
            # replace() is atomic on the same filesystem and leaves the old
            # asset untouched if validation or encoding fails.
            temp_target.replace(target)
        finally:
            temp_target.unlink(missing_ok=True)
    return validated.width, validated.height
