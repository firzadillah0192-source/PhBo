"""Offline artwork inspection and reviewed, deterministic Classic asset assembly.

Never accesses AI providers, customer uploads, or the production database.
Run --inspect first; approve the measured slot report before --review-config.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ARTWORK = ROOT / "import-assets" / "classic-event-artwork"
OUTPUT = ROOT / "templates" / "_classic" / "events"
REVIEW = ROOT / "test" / "output" / "classic-events"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def measured_openings(image: Image.Image, count: int) -> list[dict]:
    rgb = np.asarray(image.convert("RGB"))
    height, width = rgb.shape[:2]
    difference = rgb.max(2).astype(int) - rgb.min(2).astype(int)
    mask = ((difference <= 35) & (rgb.min(2) >= 190)).astype("uint8")
    _, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    candidates = []
    for label, (x, y, w, h, area) in enumerate(stats[1:], 1):
        if not (.05 * width * height < area < .35 * width * height):
            continue
        if not (x > .07 * width and y > .08 * height and x + w < .94 * width and y + h < .93 * height):
            continue
        region = labels[y:y + h, x:x + w] == label
        # Ignore small connected decorative protrusions when measuring edges.
        middle_rows = region[int(.15 * h):int(.85 * h)]
        left = int(np.quantile(np.argmax(middle_rows, axis=1), .95))
        right = w - int(np.quantile(np.argmax(middle_rows[:, ::-1], axis=1), .95))
        middle_cols = region[:, int(.15 * w):int(.85 * w)]
        top = int(np.quantile(np.argmax(middle_cols, axis=0), .95))
        bottom = h - int(np.quantile(np.argmax(middle_cols[::-1], axis=0), .95))
        box = dict(x=int(x + left + 1), y=int(y + top + 1), width=int(right - left - 2), height=int(bottom - top - 2), fit="cover")
        if box["width"] <= 0 or box["height"] <= 0:
            continue
        confidence = float(region[top:bottom, left:right].mean())
        if confidence < .94:
            continue
        candidates.append(box)
    if len(candidates) != count:
        raise ValueError(f"Ambiguous artwork: found {len(candidates)} openings; expected {count}. Review explicitly.")
    if count == 4:
        rows = sorted(candidates, key=lambda box: box["y"] + box["height"] / 2)
        candidates = sorted(rows[:2], key=lambda box: box["x"]) + sorted(rows[2:], key=lambda box: box["x"])
    else:
        candidates.sort(key=lambda box: box["y"])
    return candidates


def contact_sheet(frames: list[dict], paths: dict[str, Path], target: Path) -> None:
    sheet = Image.new("RGB", (1280, ((len(frames) + 3) // 4) * 520), "#eee9e1")
    draw = ImageDraw.Draw(sheet)
    for index, item in enumerate(frames):
        image = Image.open(paths[item["id"]]).convert("RGBA")
        image.thumbnail((296, 450))
        x, y = (index % 4) * 320, (index // 4) * 520
        sheet.paste(image, (x + (320 - image.width) // 2, y), image)
        draw.text((x + 8, y + 458), item["id"], fill="#202020")
        draw.text((x + 8, y + 477), item["name"], fill="#202020")
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target)


def inspect(plan: list[dict]) -> None:
    rows = []
    for item in plan:
        source = ARTWORK / (item["id"] + ".png")
        with Image.open(source) as image:
            image.load()
            row = {**item, "artwork_sha256": sha256(source), "canvas_width": image.width, "canvas_height": image.height}
            try:
                row["slots"] = measured_openings(image, item["shot_count"])
                row["needs_review"] = True
            except ValueError as error:
                row["error"] = str(error)
            rows.append(row)
    REVIEW.mkdir(parents=True, exist_ok=True)
    (REVIEW / "measured-slots.json").write_text(json.dumps({"frames": rows}, indent=2), encoding="utf-8")
    contact_sheet(plan, {item["id"]: ARTWORK / (item["id"] + ".png") for item in plan}, REVIEW / "artwork-contact-sheet.jpg")
    print(json.dumps({"inspected": len(rows), "ambiguous": [row["id"] for row in rows if "error" in row]}))


def build(plan: list[dict], config: Path) -> None:
    reviewed = json.loads(config.read_text(encoding="utf-8"))
    if reviewed.get("reviewed") is not True:
        raise ValueError("An explicit reviewed slot configuration is required")
    geometry = {item["id"]: item for item in reviewed["frames"]}
    if set(geometry) != {item["id"] for item in plan}:
        raise ValueError("Reviewed configuration must cover all 32 frame IDs")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "previews").mkdir(exist_ok=True)
    manifest = []
    for index, item in enumerate(plan):
        source = ARTWORK / (item["id"] + ".png")
        definition = geometry[item["id"]]
        if definition["artwork_sha256"] != sha256(source):
            raise ValueError("Artwork changed after geometry review: " + item["id"])
        frame = Image.open(source).convert("RGB").convert("RGBA")
        slots = definition["slots"]
        if len(slots) != item["shot_count"]:
            raise ValueError("Wrong reviewed shot count")
        draw = ImageDraw.Draw(frame)
        for slot in slots:
            x, y, w, h = (slot[key] for key in ("x", "y", "width", "height"))
            if not all(isinstance(value, int) for value in (x, y, w, h)) or x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > frame.width or y + h > frame.height:
                raise ValueError("Invalid reviewed slot bounds")
            draw.rectangle((x, y, x + w - 1, y + h - 1), fill=(0, 0, 0, 0))
        if max(slot["y"] + slot["height"] for slot in slots) > frame.height - 190:
            raise ValueError("No clean footer branding region")
        sample = frame.convert("RGB").crop((frame.width // 2 - 120, frame.height - 150, frame.width // 2 + 120, frame.height - 70))
        light = np.asarray(sample).mean() > 145
        color = "#182323" if light else "#fff7e8"
        try:
            title = ImageFont.truetype("DejaVuSans.ttf", 60)
            small = ImageFont.truetype("DejaVuSans.ttf", 16)
        except OSError:
            title, small = ImageFont.load_default(size=60), ImageFont.load_default(size=16)
        draw.text((frame.width // 2, frame.height - 150), "NXBooth", font=title, fill=color, anchor="mt")
        draw.text((frame.width // 2, frame.height - 73), "Powered by GenNexByte", font=small, fill=color, anchor="mt")
        target = OUTPUT / (item["id"] + ".png")
        frame.save(target, format="PNG", optimize=True)
        preview = frame.copy()
        preview.thumbnail((320, 480), Image.Resampling.LANCZOS)
        preview.save(OUTPUT / "previews" / target.name, format="PNG", optimize=True)
        manifest.append({"id": item["id"], "name": item["name"], "theme_slug": item["theme"], "theme_name": item["theme_name"], "filename": target.name, "canvas_width": frame.width, "canvas_height": frame.height, "shot_count": item["shot_count"], "slots": slots, "sort_order": index + 100, "sha256": sha256(target), "bytes": target.stat().st_size, "artwork_sha256": sha256(source)})
    destination = ROOT / "backend" / "app" / "data" / "classic_event_frames.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps({"version": 1, "frames": manifest}, indent=2), encoding="utf-8")
    contact_sheet(plan, {item["id"]: OUTPUT / (item["id"] + ".png") for item in plan}, REVIEW / "finished-frame-contact-sheet.jpg")
    print(json.dumps({"created": len(manifest), "themes": len({row["theme_slug"] for row in manifest})}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--review-config", type=Path)
    args = parser.parse_args()
    plan = json.loads((ROOT / "scripts" / "classic_event_collection.json").read_text(encoding="utf-8"))["frames"]
    if args.inspect:
        inspect(plan)
    elif args.review_config:
        build(plan, args.review_config)
    else:
        parser.error("Run --inspect or supply --review-config")
