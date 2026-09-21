"""Validated, atomic filesystem storage for admin image assets."""
from __future__ import annotations

import io
import uuid
from pathlib import Path

from PIL import Image
from app.core.config import get_settings
from app.services.image_validation import validate_image_bytes


def save_admin_image(data: bytes, *, content_type: str | None, target: Path) -> tuple[int, int]:
    validated = validate_image_bytes(data, content_type=content_type)
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        settings = get_settings()
        temp_dir = settings.tmp_dir / "admin-assets"
        temp_dir.mkdir(parents=True, exist_ok=True)
        temp = temp_dir / f"{uuid.uuid4().hex}.tmp"
        temp_target = temp.with_suffix(".png")
        image.save(temp_target, format="PNG")
        target.parent.mkdir(parents=True, exist_ok=True)
        temp_target.replace(target)
    return validated.width, validated.height
