"""Pixel preservation and real Classic composition for repaired catalog assets."""
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageChops, ImageOps
import test_classic_single_window as contract

ROOT = Path(__file__).resolve().parents[2]
OLD = ROOT / 'backend/app/data/classic-single-window-v4'
NEW = ROOT / 'backend/app/data/classic-footer-background-v5'


class FooterBackgroundTests(unittest.TestCase):
    def test_repairs_only_footer_remnants_and_preserves_every_other_pixel(self):
        rows = json.loads((NEW / 'collection.json').read_text())['frames']
        self.assertEqual(len(rows), 36)
        changed = 0
        for row in rows:
            with self.subTest(template=row['id']):
                source = Image.open(OLD / row['id'] / 'blank.png').convert('RGBA')
                fixed = Image.open(NEW / row['id'] / 'blank.png').convert('RGBA')
                mask = Image.open(NEW / row['id'] / 'repair-mask.png').convert('L')
                self.assertEqual(source.size, fixed.size)
                self.assertEqual(source.getchannel('A').tobytes(), fixed.getchannel('A').tobytes())
                diff = ImageChops.difference(source.convert('RGB'), fixed.convert('RGB'))
                exterior = ImageOps.invert(mask.point(lambda value: 255 if value else 0)).convert('RGB')
                self.assertIsNone(ImageChops.multiply(diff, exterior).getbbox())
                self.assertEqual(source.crop((0, 0, 1200, 2643)).tobytes(), fixed.crop((0, 0, 1200, 2643)).tobytes())
                self.assertEqual(source.crop((0, 3010, 1200, 3600)).tobytes(), fixed.crop((0, 3010, 1200, 3600)).tobytes())
                details = json.loads((NEW / row['id'] / 'repair.json').read_text())
                if details:
                    changed += 1
                    self.assertIsNotNone(diff.getbbox())
                    self.assertNotEqual(fixed.getpixel((600, details['flat_fill_bottom'] - 2))[:3], (7, 57, 87))
                else:
                    self.assertIsNone(diff.getbbox())
                original_meta = json.loads((OLD / row['id'] / 'layout.json').read_text())
                for key, value in original_meta.items():
                    self.assertEqual(row[key], value)
        self.assertEqual(changed, 31)

    def test_repaired_collection_through_actual_compositor_and_print_qr(self):
        with patch.object(contract, 'ASSETS', NEW):
            contract.SingleWindowTests('test_every_theme_has_one_clear_aperture_and_three_gapless_photos').test_every_theme_has_one_clear_aperture_and_three_gapless_photos()


if __name__ == '__main__':
    unittest.main()
