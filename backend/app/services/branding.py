"""Print preparation preserving the provider-generated frame and branding."""

from __future__ import annotations

import io
from PIL import Image, ImageFilter, ImageOps


MASTER_SIZE = (2160, 3240)


def prepare_advanced_result(image_bytes: bytes) -> bytes:
    with Image.open(io.BytesIO(image_bytes)) as source:
        source.load()
        oriented = ImageOps.exif_transpose(source).convert("RGB")
    canvas = ImageOps.fit(oriented, MASTER_SIZE, method=Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(60))
    foreground = ImageOps.contain(oriented, MASTER_SIZE, method=Image.Resampling.LANCZOS)
    canvas.paste(foreground, ((MASTER_SIZE[0] - foreground.width) // 2, (MASTER_SIZE[1] - foreground.height) // 2))
    output = io.BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue()
