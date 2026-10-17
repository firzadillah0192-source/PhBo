"""Actual production composition with synthetic photos, all 36 single openings."""
import importlib.util
import io
import json
import sys
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image, ImageDraw
import zxingcpp

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
with patch.dict(sys.modules, {'app.models': SimpleNamespace(ClassicLayout=SimpleNamespace)}):
    from app.services.classic import compose_classic
from classic_event_footer import render_footer, print_strip

ASSETS = ROOT / 'backend/app/data/classic-single-window-v4'
FONTS = ROOT / 'backend/app/data/classic-floral-event-001'
URL = 'https://nxbooth.gennexbyte.com/r/' + 'a' * 43


class SingleWindowTests(unittest.TestCase):
    def test_every_theme_has_one_clear_aperture_and_three_gapless_photos(self):
        rows = json.loads((ASSETS / 'collection.json').read_text())['frames']
        self.assertEqual(len(rows), 36)
        colors = ['red', 'green', 'blue']
        photos = []
        for color, size in zip(colors, [(900, 300), (300, 900), (300, 300)]):
            buffer = io.BytesIO()
            Image.new('RGB', size, color).save(buffer, 'PNG')
            photos.append(buffer.getvalue())
        for row in rows:
            with self.subTest(template=row['id']):
                frame = Image.open(ASSETS / row['id'] / 'blank.png').convert('RGBA')
                preview = Image.open(ASSETS / row['id'] / 'preview.png').convert('RGBA')
                self.assertEqual(frame.size, (1200, 3600))
                # Verify every pixel of ONE rectangular alpha component, including
                # former dividers, rather than just checking each photo center.
                expected = Image.new('L', frame.size, 255)
                ImageDraw.Draw(expected).rectangle((60, 106, 1139, 2637), fill=0)
                self.assertEqual(frame.getchannel('A').tobytes(), expected.tobytes())
                self.assertEqual(frame.crop((0, 0, 1200, 2700)).tobytes(), preview.crop((0, 0, 1200, 2700)).tobytes())
                slots = row['slots']
                self.assertEqual(slots, [dict(x=60, y=106+844*i, width=1080, height=844, fit='cover') for i in range(3)])
                layout = SimpleNamespace(canvas_width=1200, canvas_height=3600, shot_count=3,
                    layout_config_json=json.dumps({'slots': slots}), frame_asset_path=str(ASSETS / row['id'] / 'blank.png'))
                composed = Image.open(io.BytesIO(compose_classic(layout, photos))).convert('RGBA')
                self.assertEqual(composed.getchannel('A').getextrema(), (255, 255))
                for slot, color in zip(slots, colors):
                    box = (slot['x'], slot['y'], slot['x']+slot['width'], slot['y']+slot['height'])
                    self.assertEqual(composed.crop(box).convert('RGB').tobytes(), Image.new('RGB', (1080, 844), color).tobytes())
                # Decoration/header/footer cannot be covered by any photograph.
                exterior = expected.point(lambda value: 255 if value else 0)
                self.assertEqual(Image.composite(composed, frame, exterior).tobytes(), frame.tobytes())
                rendered = render_footer(composed, FONTS, 'Sarah & Arif',
                    datetime.fromisoformat('2026-10-09T17:30:00+00:00'), URL).convert('RGB')
                self.assertEqual(zxingcpp.read_barcode(rendered).text, URL)
                buffer = io.BytesIO()
                rendered.save(buffer, 'PNG', dpi=(600, 600))
                printed = Image.open(io.BytesIO(print_strip(buffer.getvalue())))
                self.assertEqual(printed.size, (600, 1800))
                self.assertAlmostEqual(printed.info['dpi'][0], 300, delta=.1)
                self.assertEqual(zxingcpp.read_barcode(printed).text, URL)
