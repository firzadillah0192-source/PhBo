"""Place 1–4 photos inside a frame. No AI engine or database required."""
from __future__ import annotations

import argparse
from array import array
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageOps


@dataclass
class Slot:
    box: tuple[int, int, int, int]
    mask: Image.Image


def load_image(path: str | Path) -> Image.Image:
    with Image.open(path) as image:
        image.load()
        return ImageOps.exif_transpose(image).convert("RGBA")


def detect_slots(frame: Image.Image, source: str = "alpha") -> list[Slot]:
    """Find enclosed holes; ignore exterior background and tiny decorations.

    Alpha is the normal frame format. Black detection is opt-in for opaque
    frames whose photo areas are painted black, rather than transparent.
    """
    if source not in ("alpha", "black"):
        raise ValueError("Slot source must be alpha or black")
    width, height = frame.size
    if source == "alpha":
        candidates = frame.getchannel("A").point(lambda a: 255 if a < 128 else 0)
    else:
        r, g, b, a = frame.split()
        dark = ImageChops.lighter(ImageChops.lighter(r, g), b)
        candidates = ImageChops.multiply(
            dark.point(lambda v: 255 if v <= 32 else 0),
            a.point(lambda v: 255 if v >= 128 else 0),
        )
    remaining = bytearray(candidates.tobytes())
    slots = []
    minimum_area = max(64, int(width * height * 0.01))
    for start in range(len(remaining)):
        if not remaining[start]:
            continue
        remaining[start] = 0
        stack = [start]
        pixels = array("I")
        left, top, right, bottom = width, height, 0, 0
        exterior = False
        while stack:
            index = stack.pop()
            pixels.append(index)
            y, x = divmod(index, width)
            left, top = min(left, x), min(top, y)
            right, bottom = max(right, x), max(bottom, y)
            exterior |= x == 0 or y == 0 or x == width - 1 or y == height - 1
            neighbors = []
            if x > 0:
                neighbors.append(index - 1)
            if x < width - 1:
                neighbors.append(index + 1)
            if y > 0:
                neighbors.append(index - width)
            if y < height - 1:
                neighbors.append(index + width)
            for neighbor in neighbors:
                if remaining[neighbor]:
                    remaining[neighbor] = 0
                    stack.append(neighbor)
        if exterior or len(pixels) < minimum_area:
            continue
        box = (left, top, right + 1, bottom + 1)
        slot_width, slot_height = right - left + 1, bottom - top + 1
        data = bytearray(slot_width * slot_height)
        for index in pixels:
            y, x = divmod(index, width)
            data[(y - top) * slot_width + x - left] = 255
        mask = Image.frombytes("L", (slot_width, slot_height), bytes(data))
        if source == "alpha":
            # Fill rounded corners behind the opaque overlay. Preserve the
            # partially transparent boundary by extending one pixel beneath it.
            from PIL import ImageFilter
            expanded = (max(0, left - 1), max(0, top - 1),
                        min(width, right + 2), min(height, bottom + 2))
            padded = Image.new("L", (expanded[2] - expanded[0], expanded[3] - expanded[1]))
            padded.paste(mask, (left - expanded[0], top - expanded[1]))
            mask = padded.filter(ImageFilter.MaxFilter(3))
            box = expanded
        slots.append(Slot(box, mask))
    slots.sort(key=lambda slot: (slot.box[1], slot.box[0]))
    if not 1 <= len(slots) <= 4:
        raise ValueError(
            f"Detected {len(slots)} slots; expected 1–4 enclosed photo areas. "
            "Use a transparent PNG frame or --slot-source black for opaque black slots."
        )
    return slots


def compose_classic(frame_path: str | Path, photo_paths: list[str | Path],
                    output_path: str | Path, *, slot_source: str = "alpha",
                    centering: tuple[float, float] = (0.5, 0.5)) -> list[tuple[int, int, int, int]]:
    """Photos fill slots in reading order; fewer photos repeat cyclically."""
    if not 1 <= len(photo_paths) <= 4:
        raise ValueError("Choose between 1 and 4 photos")
    if len(centering) != 2 or any(not 0 <= value <= 1 for value in centering):
        raise ValueError("Crop centering must be between 0 and 1")
    output = Path(output_path)
    if output.resolve() in {Path(p).resolve() for p in [frame_path, *photo_paths]}:
        raise ValueError("Output must not overwrite the frame or a source photo")
    frame = load_image(frame_path)
    slots = detect_slots(frame, slot_source)
    if len(photo_paths) > len(slots):
        raise ValueError(f"Frame has {len(slots)} slots but {len(photo_paths)} photos were selected")
    photos = [load_image(path) for path in photo_paths]
    result = Image.new("RGBA", frame.size)
    overlay = frame.copy()
    for index, slot in enumerate(slots):
        x, y, right, bottom = slot.box
        fitted = ImageOps.fit(photos[index % len(photos)], (right - x, bottom - y),
                              method=Image.Resampling.LANCZOS, centering=centering)
        fitted.putalpha(ImageChops.multiply(fitted.getchannel("A"), slot.mask))
        result.alpha_composite(fitted, dest=(x, y))
        if slot_source == "black":
            alpha = overlay.getchannel("A")
            alpha.paste(0, (x, y), slot.mask)
            overlay.putalpha(alpha)
    result.alpha_composite(overlay)
    output.parent.mkdir(parents=True, exist_ok=True)
    result.save(output, format="PNG")
    return [slot.box for slot in slots]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frame", required=True, type=Path)
    parser.add_argument("--photos", required=True, nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--slot-source", choices=("alpha", "black"), default="alpha")
    parser.add_argument("--centering", nargs=2, type=float, default=(0.5, 0.5),
                        metavar=("X", "Y"), help="Crop position 0–1; default: center")
    args = parser.parse_args()
    try:
        boxes = compose_classic(args.frame, args.photos, args.output,
                                slot_source=args.slot_source, centering=tuple(args.centering))
    except (ValueError, OSError, Image.DecompressionBombError) as error:
        parser.exit(2, f"Classic error: {error}\n")
    print(f"Saved {args.output} ({len(boxes)} slots): {boxes}")


if __name__ == "__main__":
    main()
