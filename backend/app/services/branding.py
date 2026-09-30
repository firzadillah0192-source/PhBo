"""Deterministic print preparation and application-owned text branding."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps


MASTER_SIZE = (2160, 3240)


def _font(size: int):
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"):
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def prepare_advanced_result(
    image_bytes: bytes,
    *,
    official_logo_path: Path | None = None,
    event_name: str | None = None,
    event_date: str | None = None,
) -> bytes:
    with Image.open(io.BytesIO(image_bytes)) as source:
        source.load()
        oriented = ImageOps.exif_transpose(source).convert("RGB")
    canvas = ImageOps.fit(oriented, MASTER_SIZE, method=Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(60))
    foreground = ImageOps.contain(oriented, MASTER_SIZE, method=Image.Resampling.LANCZOS)
    canvas.paste(foreground, ((MASTER_SIZE[0] - foreground.width) // 2, (MASTER_SIZE[1] - foreground.height) // 2))
    draw = ImageDraw.Draw(canvas, "RGBA")
    left, top, right, bottom = 110, 2950, 2050, 3160
    draw.rounded_rectangle((left, top, right, bottom), radius=28, fill=(5, 10, 18, 205))
    # Use an approved logo if one is installed. The fallback is plain text,
    # deliberately distinct from a fabricated graphic logo.
    if official_logo_path and official_logo_path.is_file():
        with Image.open(official_logo_path) as logo_source:
            logo = logo_source.convert("RGBA")
            logo.thumbnail((700, 100), Image.Resampling.LANCZOS)
            canvas.paste(logo, (170, 2980), logo)
    else:
        draw.text((170, 2990), "NXBooth", font=_font(64), fill=(255, 255, 255, 255))
    draw.text((170, 3070), "Powered by GenNexByte", font=_font(32), fill=(215, 220, 228, 255))
    if event_name:
        draw.text((1050, 2992), event_name[:48], font=_font(37), fill=(255, 255, 255, 255))
    if event_date:
        draw.text((1050, 3070), event_date[:32], font=_font(30), fill=(215, 220, 228, 255))
    output = io.BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue()
