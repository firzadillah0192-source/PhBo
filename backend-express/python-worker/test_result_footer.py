import importlib.util
import io
import unittest
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageDraw
import zxingcpp

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'backend/app/data/classic-floral-event-001'
sys_path = str(Path(__file__).parent)
import sys; sys.path.insert(0, sys_path)
from result_footer import render_result_footer, _basic_name

URL = 'https://nxbooth.gennexbyte.com/r/' + 'a' * 43
DATE = datetime.fromisoformat('2026-10-09T17:30:00+00:00')


def png(size, color):
    data = io.BytesIO(); Image.new('RGB', size, color).save(data, 'PNG'); return data.getvalue()


class ResultFooterTests(unittest.TestCase):
    def render(self, kind, size, name='Ulang Tahun Budi', url=URL):
        return render_result_footer(png(size, '#10243a'), kind, name, DATE, url, ASSETS)

    def test_size_is_preserved_and_qr_decodes_for_both_kinds(self):
        for kind, size in (('basic', (1024, 1536)), ('advanced', (2160, 3240))):
            for name in ('Ulang Tahun Budi', None, *(['W' * 80, ('Perayaan Bersama ' * 5).strip()[:80]] if kind == 'basic' else [])):
                with self.subTest(kind=kind, name=name):
                    out = self.render(kind, size, name)
                    image = Image.open(io.BytesIO(out))
                    self.assertEqual(image.size, size)
                    self.assertEqual([r.text for r in zxingcpp.read_barcodes(image)], [URL])

    def test_footer_changes_only_the_bottom_of_the_image(self):
        out = Image.open(io.BytesIO(self.render('basic', (1024, 1536))))
        self.assertEqual(out.crop((0, 0, 1024, 1250)).getcolors(10), [(1024 * 1250, (16, 36, 58))])
        out = Image.open(io.BytesIO(self.render('advanced', (2160, 3240))))
        self.assertEqual(out.crop((0, 0, 2160, 2600)).getcolors(10), [(2160 * 2600, (16, 36, 58))])

    def test_basic_text_has_large_bright_glyphs(self):
        # Thin script formerly left only a few hundred pale core pixels here.
        # Require substantial bright lettering within the physical event plate.
        for name in ('Ulang Tahun Budi', None):
            with self.subTest(name=name):
                image = Image.open(io.BytesIO(self.render('basic', (1024, 1536), name)))
                plate = image.crop((266, 1427, 768, 1473))
                bright = sum(1 for r, g, b in plate.get_flattened_data()
                             if r >= 245 and g >= 230 and b >= 200)
                self.assertGreater(bright, 2500)

    def test_wrapped_names_keep_every_letter(self):
        draw = ImageDraw.Draw(Image.new('RGB', (1024, 1536)))
        for name in ('Ulang Tahun Budi', 'W' * 80, ('Perayaan Bersama ' * 5).strip()[:80]):
            with self.subTest(name=name):
                text, _, box = _basic_name(draw, name, ASSETS / 'fonts/CormorantGaramond.ttf', 325, 38, 44)
                self.assertEqual(''.join(text.split()), ''.join(name.split()))
                self.assertLessEqual(len(text.splitlines()), 3)
                self.assertLessEqual(box[2] - box[0], 325)
                self.assertLessEqual(box[3] - box[1], 38)

    def test_invalid_input_is_rejected(self):
        with self.assertRaises(ValueError): self.render('basic', (1024, 1536), name='x' * 81)
        with self.assertRaises(ValueError): self.render('basic', (1024, 1536), name='A\nB')
        with self.assertRaises(ValueError): self.render('basic', (1024, 1536), url='https://example.com/r/' + 'a' * 43)
        with self.assertRaises(ValueError): self.render('basic', (1024, 1536), url=URL + '?x=1')
        with self.assertRaises(ValueError): self.render('poster', (1024, 1536))
        with self.assertRaises(ValueError): render_result_footer(png((10, 10), 'red'), 'basic', None, datetime(2026, 1, 1), URL, ASSETS)


if __name__ == '__main__':
    unittest.main()
