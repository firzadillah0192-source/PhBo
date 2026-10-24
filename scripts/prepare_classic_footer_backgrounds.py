"""Repair flattened legacy aperture remnants using each frame's own footer texture.

Offline and deterministic. Keep historical v4 assets and customer photos intact.
"""
import hashlib
import importlib.util
import json
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'backend/app/data/classic-single-window-v4'
OUTPUT = ROOT / 'backend/app/data/classic-footer-background-v5'
FONTS = ROOT / 'backend/app/data/classic-floral-event-001'
spec = importlib.util.spec_from_file_location('footer', ROOT / 'backend-express/python-worker/classic_event_footer.py')
footer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(footer)
FILL = (7, 57, 87)
START = 2643  # Retain the actual photo aperture's bottom outline pixel for pixel.
END = 3010


def repair(frame):
    frame = frame.convert('RGBA')
    if frame.size != (1200, 3600):
        raise ValueError('Unexpected master geometry')
    rgb = frame.convert('RGB')
    region = rgb.crop((60, START, 1140, END))
    delta = ImageChops.difference(region, Image.new('RGB', region.size, FILL))
    channels = delta.split()
    distance = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
    exact = distance.point(lambda value: 255 if value <= 1 else 0)
    bounds = exact.getbbox()
    if bounds is None:
        return frame.copy(), None, Image.new('L', frame.size, 0)
    bottom = START + bounds[3]
    # Sample only this template's existing undecorated backdrop just below the
    # old fill. Mirror it upwards so the lower join uses the adjacent texture.
    sample_top = bottom + 30
    sample_height = min(100, 3400 - sample_top)
    if sample_height < 16:
        raise ValueError('Not enough original backdrop for a conservative repair')
    donor = rgb.crop((300, sample_top, 900, sample_top + sample_height))
    donor = ImageOps.flip(donor).resize((1200, bottom - START + 40), Image.Resampling.BICUBIC)
    # Remove the old hole's antialias and narrow outline as well as flat pixels.
    local_mask = exact.filter(ImageFilter.MaxFilter(41)).filter(ImageFilter.GaussianBlur(4))
    mask = Image.new('L', frame.size, 0)
    mask.paste(local_mask, (60, START))
    texture = rgb.copy()
    texture.paste(donor, (0, START))
    fixed = Image.composite(texture, rgb, mask).convert('RGBA')
    fixed.putalpha(frame.getchannel('A'))
    return fixed, {'x': 60, 'y': START, 'width': 1080, 'height': END - START,
                   'flat_fill_bottom': bottom, 'donor_y': sample_top,
                   'donor_height': sample_height}, mask


def prepare(output=OUTPUT):
    collection = json.loads((SOURCE / 'collection.json').read_text())
    repaired = []
    for row in collection['frames']:
        source = SOURCE / row['id']
        destination = output / row['id']
        destination.mkdir(parents=True, exist_ok=True)
        with Image.open(source / 'blank.png') as original:
            frame, details, mask = repair(original)
        frame.save(destination / 'blank.png', dpi=(600, 600))
        mask.save(destination / 'repair-mask.png')
        meta = {**row, 'footer_background_revision': 'no-legacy-fill-v5'}
        preview = footer.render_footer(frame, FONTS, row['preview_sample']['event_name'],
            datetime.fromisoformat('2026-10-10T07:00:00+00:00'), 'https://nxbooth.gennexbyte.com/', preview=True)
        preview.save(destination / 'preview.png', dpi=(600, 600))
        (destination / 'layout.json').write_text(json.dumps(meta, indent=2) + '\n')
        (destination / 'repair.json').write_text(json.dumps(details, indent=2) + '\n')
        (destination / 'checksums.json').write_text(json.dumps({name: hashlib.sha256((destination / name).read_bytes()).hexdigest()
            for name in ('blank.png', 'preview.png', 'layout.json', 'repair-mask.png', 'repair.json')}, indent=2) + '\n')
        repaired.append(meta)
        print(json.dumps({'id': row['id'], 'changed': details is not None}), flush=True)
    (output / 'collection.json').write_text(json.dumps({'version': 5, 'status': 'CANDIDATE', 'frames': repaired}, indent=2) + '\n')


if __name__ == '__main__':
    prepare()
