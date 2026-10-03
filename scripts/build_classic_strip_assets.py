"""Prepare reviewed 1:3 strip artwork, preserving AI-authored theme lettering.

Offline only. No provider, customer upload or database access. The operator
authorized Pillow for precise photo transparency and authoritative sizing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.classic_format import MASTER_SIZE, MASTER_DPI, PRINT_SIZE, PRINT_DPI, PROFILE_ID
ARTWORK = ROOT / 'import-assets' / 'classic-event-artwork-v2'
OUTPUT = ROOT / 'templates' / '_classic' / 'events' / 'strip-v2'
REVIEW = ROOT / 'test' / 'output' / 'classic-strip-v2'
CANVAS = MASTER_SIZE


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized_artwork(path: Path) -> Image.Image:
    with Image.open(path) as source:
        source.load()
        if source.format != 'PNG' or abs(source.width / source.height - 1 / 3) > .004:
            raise ValueError('Artwork must already be a narrow 1:3 PNG strip')
        # Uniform resizing preserves proportions. Extend edge pixels for small
        # raster rounding gaps (the first AI output is 724 x 2171), never stretch.
        fitted = ImageOps.contain(source.convert('RGB'), CANVAS, Image.Resampling.LANCZOS)
    gap_x, gap_y = CANVAS[0] - fitted.width, CANVAS[1] - fitted.height
    if gap_x > 32 or gap_y > 32:
        raise ValueError('Artwork aspect ratio requires excessive padding')
    left, top = gap_x // 2, gap_y // 2
    pixels = np.pad(np.asarray(fitted), ((top, gap_y - top), (left, gap_x - left), (0, 0)), mode='edge')
    return Image.fromarray(pixels).convert('RGBA')


def measured_openings(frame: Image.Image, count: int) -> tuple[list[dict], np.ndarray]:
    rgb = np.asarray(frame.convert('RGB'))
    h, w = rgb.shape[:2]
    near_white = ((rgb.min(2) >= 190) & ((rgb.max(2).astype(int) - rgb.min(2).astype(int)) <= 35)).astype('uint8')
    _, labels, stats, _ = cv2.connectedComponentsWithStats(near_white)
    candidates = []
    for label, (x, y, width, height, area) in enumerate(stats[1:], 1):
        if not (.05 * w * h < area < .35 * w * h):
            continue
        if not (x > .05 * w and y > .02 * h and x + width < .96 * w and y + height < .9 * h):
            continue
        region = labels[y:y + height, x:x + width] == label
        rows = region[int(.15 * height):int(.85 * height)]
        left = int(np.quantile(np.argmax(rows, axis=1), .95))
        right = width - int(np.quantile(np.argmax(rows[:, ::-1], axis=1), .95))
        columns = region[:, int(.15 * width):int(.85 * width)]
        top = int(np.quantile(np.argmax(columns, axis=0), .95))
        bottom = height - int(np.quantile(np.argmax(columns[::-1], axis=0), .95))
        box = dict(x=int(x + left + 1), y=int(y + top + 1), width=int(right - left - 2), height=int(bottom - top - 2), fit='cover')
        if min(box['width'], box['height']) <= 0 or region[top:bottom, left:right].mean() < .94:
            continue
        candidates.append((box, label))
    if len(candidates) != count:
        raise ValueError(f'Ambiguous artwork: {len(candidates)} openings found, expected {count}; review explicitly')
    candidates.sort(key=lambda item: item[0]['y'])
    holes = np.zeros((h, w), dtype=bool)
    previous_bottom = 0
    for slot, label in candidates:
        x, y, sw, sh = (slot[key] for key in ('x', 'y', 'width', 'height'))
        if y < previous_bottom or abs(x + sw / 2 - w / 2) > .08 * w:
            raise ValueError('Photo openings must be one non-overlapping vertical column')
        previous_bottom = y + sh
        # Preserve rounded/ornamental corners by cutting only the measured white
        # photo interior. The opaque frame overlays cover-fitted photographs.
        holes[y:y + sh, x:x + sw] = labels[y:y + sh, x:x + sw] == label
    return [slot for slot, _ in candidates], holes


def sheet(plan: list[dict], paths: dict[str, Path], target: Path, *, footers=False) -> None:
    cell_height = 270 if footers else 590
    canvas = Image.new('RGB', (1280, ((len(plan) + 3) // 4) * cell_height), '#eee9e1')
    draw = ImageDraw.Draw(canvas)
    for index, item in enumerate(plan):
        with Image.open(paths[item['id']]) as opened:
            image = opened.convert('RGBA')
        if footers:
            image = image.crop((0, int(image.height * .81), image.width, image.height))
        image.thumbnail((300, cell_height - 60), Image.Resampling.LANCZOS)
        x, y = (index % 4) * 320, (index // 4) * cell_height
        canvas.paste(image, (x + (320 - image.width) // 2, y), image)
        draw.text((x + 8, y + cell_height - 45), item['id'], fill='#202020')
        draw.text((x + 8, y + cell_height - 28), item['name'], fill='#202020')
    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target)


def inspect(plan: list[dict]) -> None:
    rows = []
    for item in plan:
        path = ARTWORK / (item['id'] + '.png')
        frame = normalized_artwork(path)
        row = {**item, 'artwork_sha256': digest(path), 'canvas_width': frame.width, 'canvas_height': frame.height, 'branding_reviewed': False}
        try:
            row['slots'], _ = measured_openings(frame, item['shot_count'])
        except ValueError as error:
            row['error'] = str(error)
        rows.append(row)
    REVIEW.mkdir(parents=True, exist_ok=True)
    (REVIEW / 'measured-slots.json').write_text(json.dumps({'frames': rows}, indent=2))
    paths = {item['id']: ARTWORK / (item['id'] + '.png') for item in plan}
    sheet(plan, paths, REVIEW / 'artwork-contact-sheet.jpg')
    sheet(plan, paths, REVIEW / 'branding-contact-sheet.jpg', footers=True)
    print(json.dumps({'inspected': len(rows), 'ambiguous': [row['id'] for row in rows if 'error' in row]}))


def build(plan: list[dict], config_path: Path) -> None:
    config = json.loads(config_path.read_text())
    if config.get('reviewed') is not True:
        raise ValueError('Explicit geometry and branding review is required')
    reviewed = {row['id']: row for row in config['frames']}
    if set(reviewed) != {item['id'] for item in plan}:
        raise ValueError('Review must contain exactly the 32 collection IDs')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / 'previews').mkdir(exist_ok=True)
    (OUTPUT / 'print').mkdir(exist_ok=True)
    manifest = []
    for order, item in enumerate(plan, 100):
        source = ARTWORK / (item['id'] + '.png')
        row = reviewed[item['id']]
        if row.get('branding_reviewed') is not True or row['artwork_sha256'] != digest(source):
            raise ValueError('Unreviewed branding or changed artwork: ' + item['id'])
        frame = normalized_artwork(source)
        slots, holes = measured_openings(frame, item['shot_count'])
        if slots != row['slots']:
            raise ValueError('Opening measurement changed after review')
        pixels = np.array(frame)
        pixels[holes, 3] = 0
        frame = Image.fromarray(pixels)
        target = OUTPUT / (item['id'] + '.png')
        frame.save(target, 'PNG', optimize=True, dpi=(MASTER_DPI, MASTER_DPI))
        preview = frame.copy()
        preview.thumbnail((160, 480), Image.Resampling.LANCZOS)
        preview.save(OUTPUT / 'previews' / target.name, 'PNG', optimize=True)
        frame.resize(PRINT_SIZE, Image.Resampling.LANCZOS).save(OUTPUT / 'print' / target.name, 'PNG', optimize=True, dpi=(PRINT_DPI, PRINT_DPI))
        manifest.append(dict(id=item['id'], name=item['name'], theme_slug=item['theme'], theme_name=item['theme_name'], filename='strip-v2/' + target.name, collection_version=2, print_profile=PROFILE_ID, canvas_width=CANVAS[0], canvas_height=CANVAS[1], shot_count=item['shot_count'], slots=slots, sort_order=order, sha256=digest(target), bytes=target.stat().st_size, artwork_sha256=digest(source), branding_source='generated-artwork'))
    destination = ROOT / 'backend' / 'app' / 'data' / 'classic_event_frames.json'
    destination.write_text(json.dumps({'version': 2, 'frames': manifest}, indent=2))
    sheet(plan, {item['id']: OUTPUT / (item['id'] + '.png') for item in plan}, REVIEW / 'finished-frame-contact-sheet.jpg')
    print(json.dumps({'built': len(manifest), 'canvas': CANVAS, 'branding': 'generated-artwork'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--partial', action='store_true', help='Inspect only artwork already generated; never build a partial collection')
    parser.add_argument('--review-config', type=Path)
    args = parser.parse_args()
    plan = json.loads((ROOT / 'scripts' / 'classic_event_collection.json').read_text())['frames']
    if args.inspect:
        if args.partial:
            plan = [item for item in plan if (ARTWORK / (item['id'] + '.png')).is_file()]
        inspect(plan)
    elif args.review_config:
        build(plan, args.review_config)
    else:
        parser.error('Run --inspect or provide --review-config')
