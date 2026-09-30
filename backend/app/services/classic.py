"""Reviewed Classic frame geometry and deterministic, provider-free composition."""

from __future__ import annotations

import io
import json
from pathlib import Path

from PIL import Image, ImageOps

from app.models import ClassicLayout


# Bounding boxes of the enclosed fully transparent components in the supplied PNGs.
# They are reviewed here as data and are persisted by seed_catalog in classic_layouts.
CLASSIC_SEEDS = (
    ("classic-frame-001", "Classic Frame 1", "classic-frame1.png", ((93, 87, 540, 429), (94, 567, 539, 430), (94, 1050, 539, 428), (94, 1531, 539, 397))),
    ("classic-frame-002", "Classic Frame 2", "classic-frame2.png", ((114, 132, 501, 384), (112, 596, 503, 384), (112, 1060, 505, 377), (114, 1513, 501, 383))),
    ("classic-frame-003", "Classic Frame 3", "classic-frame3.png", ((94, 151, 548, 466), (94, 695, 548, 466), (94, 1240, 548, 471))),
)


class ClassicLayoutError(ValueError):
    pass


def slots_for(layout: ClassicLayout) -> list[dict]:
    try:
        slots = json.loads(layout.layout_config_json)["slots"]
    except (ValueError, KeyError, TypeError) as exc:
        raise ClassicLayoutError("Invalid slot metadata") from exc
    if not isinstance(slots, list) or len(slots) != layout.shot_count or not slots:
        raise ClassicLayoutError("Shot count does not match slot count")
    for slot in slots:
        try:
            x, y, width, height = (slot[key] for key in ("x", "y", "width", "height"))
        except (TypeError, KeyError) as exc:
            raise ClassicLayoutError("Slot coordinates are incomplete") from exc
        if not all(isinstance(value, int) for value in (x, y, width, height)):
            raise ClassicLayoutError("Slot coordinates must be integers")
        if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > layout.canvas_width or y + height > layout.canvas_height:
            raise ClassicLayoutError("Slot lies outside the canvas")
        if slot.get("fit", "cover") != "cover":
            raise ClassicLayoutError("Classic slots must use cover fit")
    return slots


def validated_frame(layout: ClassicLayout) -> Image.Image:
    if not layout.frame_asset_path:
        raise ClassicLayoutError("Frame image is missing")
    try:
        with Image.open(Path(layout.frame_asset_path)) as source:
            if source.format != "PNG" or "A" not in source.getbands():
                raise ClassicLayoutError("Frame must be an alpha PNG")
            source.load()
            frame = source.copy()
    except (OSError, ValueError) as exc:
        raise ClassicLayoutError("Frame image is unreadable") from exc
    if frame.size != (layout.canvas_width, layout.canvas_height):
        raise ClassicLayoutError("Frame dimensions do not match the layout")
    for slot in slots_for(layout):
        x, y, width, height = (slot[key] for key in ("x", "y", "width", "height"))
        alpha = frame.getchannel("A").crop((x, y, x + width, y + height))
        if alpha.getpixel((width // 2, height // 2)) != 0:
            raise ClassicLayoutError("Photo slot center is not transparent")
        transparent = alpha.histogram()[0]
        if transparent < width * height * 0.85:
            raise ClassicLayoutError("Photo slot lacks a clear transparent opening")
    return frame


def compose_classic(layout: ClassicLayout, capture_bytes: list[bytes]) -> bytes:
    slots = slots_for(layout)
    if len(capture_bytes) != layout.shot_count:
        raise ClassicLayoutError("Incorrect number of captured photographs")
    frame = validated_frame(layout)
    canvas = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    for data, slot in zip(capture_bytes, slots, strict=True):
        try:
            with Image.open(io.BytesIO(data)) as opened:
                opened.load()
                photograph = ImageOps.exif_transpose(opened).convert("RGB")
        except (OSError, ValueError) as exc:
            raise ClassicLayoutError("A captured photograph is unreadable") from exc
        width, height = slot["width"], slot["height"]
        fitted = ImageOps.fit(photograph, (width, height), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        canvas.paste(fitted, (slot["x"], slot["y"]))
    canvas.alpha_composite(frame)
    output = io.BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue()
