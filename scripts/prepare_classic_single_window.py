"""Offline revision: one continuous aperture, three adjacent photo placements.

Uses existing approved artwork and bundled fonts; never reads customer photos.
Historical three-window assets stay intact for rollback and queued jobs.
"""
import hashlib
import importlib.util
import json
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OLD = ROOT / 'backend/app/data/classic-personalized-v3'
OUTPUT = ROOT / 'backend/app/data/classic-single-window-v4'
spec = importlib.util.spec_from_file_location('preparation', ROOT / 'scripts/prepare_classic_personalized_assets.py')
preparation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparation)
WINDOW = dict(x=60, y=106, width=1080, height=2532)
SLOTS = [dict(x=60, y=106 + 844 * index, width=1080, height=844, fit='cover') for index in range(3)]


def prepare(source, metadata):
    destination = OUTPUT / metadata['id']
    destination.mkdir(parents=True, exist_ok=True)
    with Image.open(source / 'blank.png') as original:
        # Preserve approved theme/header/footer outside the new aperture. Flatten
        # previous alpha first, then remove ALL internal frame lines in one cut.
        frame = Image.new('RGBA', (1200, 3600), '#073957')
        frame.alpha_composite(original.convert('RGBA'))
    draw = ImageDraw.Draw(frame)
    x, y, width, height = (WINDOW[key] for key in ('x', 'y', 'width', 'height'))
    draw.rectangle((x-3, y-3, x+width+2, y+height+2), outline='#d7b76d', width=2)
    draw.rectangle((x, y, x+width-1, y+height-1), fill=(0, 0, 0, 0))
    frame.save(destination / 'blank.png', dpi=(600, 600))
    metadata = {**metadata, 'slots': SLOTS, 'photo_window': WINDOW,
                'event_personalization': True, 'frame_geometry': 'single-window-v4',
                'shot_count': 3, 'canvas_width': 1200, 'canvas_height': 3600}
    sample = metadata['preview_sample']['event_name']
    preparation.footer.render_footer(frame, preparation.FONTS, sample,
        datetime.fromisoformat('2026-10-10T07:00:00+00:00'),
        'https://nxbooth.gennexbyte.com/', preview=True).save(destination / 'preview.png', dpi=(600, 600))
    (destination / 'layout.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (destination / 'checksums.json').write_text(json.dumps({name: hashlib.sha256((destination/name).read_bytes()).hexdigest()
        for name in ('blank.png', 'preview.png', 'layout.json')}, indent=2) + '\n')
    return metadata


if __name__ == '__main__':
    rows = json.loads((OLD / 'collection.json').read_text())['frames']
    frames = [prepare(OLD / row['id'], row) for row in rows]
    floral = preparation.FONTS
    frames.append(prepare(floral, json.loads((floral / 'layout.json').read_text())))
    if len(frames) != 36 or len({row['id'] for row in frames}) != 36:
        raise ValueError('Expected exactly 36 unique approved layouts')
    (OUTPUT / 'collection.json').write_text(json.dumps({'version': 4, 'status': 'PASS', 'frames': frames}, indent=2) + '\n')
    print(json.dumps({'status': 'PASS', 'prepared': len(frames), 'window': WINDOW, 'slots': SLOTS}))
