import importlib.util
import io
import json
import unittest
from datetime import datetime
from pathlib import Path
from PIL import Image
import zxingcpp

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'backend/app/data/classic-floral-event-001'
spec = importlib.util.spec_from_file_location('footer', Path(__file__).with_name('classic_event_footer.py'))
footer = importlib.util.module_from_spec(spec); spec.loader.exec_module(footer)
URL = 'https://nxbooth.gennexbyte.com/r/' + 'a' * 43
DATE = datetime.fromisoformat('2026-10-09T17:30:00+00:00')

def photo(color, size):
    data = io.BytesIO(); Image.new('RGB', size, color).save(data, 'PNG'); return data.getvalue()

class EventFooterTests(unittest.TestCase):
    def setUp(self):
        self.frame = Image.open(ASSETS / 'blank.png').convert('RGBA')
    def test_blank_and_preview_match_exact_master_and_three_slots(self):
        preview = Image.open(ASSETS / 'preview.png')
        self.assertEqual(self.frame.size, (1200, 3600)); self.assertEqual(preview.size, (1200, 3600))
        metadata = json.loads((ASSETS / 'layout.json').read_text())
        self.assertEqual(metadata['shot_count'], 3); self.assertEqual(len(metadata['slots']), 3)
        for slot in metadata['slots']:
            x,y,w,h = (slot[k] for k in ('x','y','width','height'))
            self.assertEqual(self.frame.getchannel('A').getpixel((x+w//2,y+h//2)), 0)
            self.assertLessEqual(x+w,1200); self.assertLessEqual(y+h,3600)
        self.assertEqual(self.frame.crop((0,0,1200,2700)).tobytes(), preview.crop((0,0,1200,2700)).tobytes())
    def test_preview_uses_same_real_font_and_renderer(self):
        rendered = footer.render_footer(self.frame,ASSETS,'Sarah & Arif',datetime.fromisoformat('2026-10-10T07:00:00+00:00'),'https://nxbooth.gennexbyte.com/',preview=True)
        with Image.open(ASSETS / 'preview.png') as preview:
            self.assertEqual(rendered.tobytes(),preview.tobytes())
    def test_compact_photo_dominant_geometry_and_brand_header(self):
        metadata=json.loads((ASSETS/'layout.json').read_text())
        slots=metadata['slots']
        self.assertEqual(metadata['branding']['text'],'NXBooth')
        self.assertLessEqual(slots[0]['y'],130)
        self.assertGreaterEqual(sum(s['width']*s['height'] for s in slots),1200*3600*.60)
        for slot in slots:
            self.assertLessEqual(slot['x'],75)
            self.assertLessEqual(1200-slot['x']-slot['width'],75)
        for first,second in zip(slots,slots[1:]):
            self.assertGreaterEqual(second['y']-first['y']-first['height'],0)
            self.assertLessEqual(second['y']-first['y']-first['height'],40)
        self.assertLessEqual(slots[-1]['y']+slots[-1]['height'],2700)
        # Long fitted titles also remain below every photo window.
        rendered=footer.render_footer(self.frame,ASSETS,'Perayaan Pernikahan Sarah dan Arif Bersama Keluarga Besar',DATE,URL)
        last_bottom=slots[-1]['y']+slots[-1]['height']
        self.assertEqual(rendered.crop((0,0,1200,last_bottom)).tobytes(),self.frame.crop((0,0,1200,last_bottom)).tobytes())
    def test_date_follows_capture_in_wib_not_render_clock(self):
        self.assertEqual(footer.capture_date(DATE), '10 Oktober 2026')
        with self.assertRaises(ValueError): footer.capture_date(datetime(2026,10,10))
    def test_result_and_print_have_exact_dimensions_no_gray_padding(self):
        data = footer.compose_event_strip(ASSETS,[photo('red',(900,300)),photo('green',(300,900)),photo('blue',(300,300))],'Sarah & Arif',DATE,URL)
        with Image.open(io.BytesIO(data)) as master:
            self.assertEqual(master.size,(1200,3600)); self.assertEqual(master.mode,'RGB')
            self.assertAlmostEqual(master.info['dpi'][0],600,delta=.1)
            for slot,color in zip(json.loads((ASSETS/'layout.json').read_text())['slots'],[(255,0,0),(0,128,0),(0,0,255)]):
                self.assertEqual(master.getpixel((slot['x']+slot['width']//2,slot['y']+slot['height']//2)),color)
            result = zxingcpp.read_barcode(master)
            self.assertIsNotNone(result); self.assertEqual(result.text,URL)
        with Image.open(io.BytesIO(footer.print_strip(data))) as printed:
            self.assertEqual(printed.size,(600,1800)); self.assertEqual(printed.mode,'RGB')
            self.assertAlmostEqual(printed.info['dpi'][0],300,delta=.1)
            result=zxingcpp.read_barcode(printed)
            self.assertIsNotNone(result);self.assertEqual(result.text,URL)
    def test_names_are_fitted_without_changing_canvas(self):
        name='Perayaan Pernikahan Sarah dan Arif Bersama Keluarga Besar'
        image=footer.render_footer(self.frame,ASSETS,name,DATE,URL)
        self.assertEqual(image.size,(1200,3600))
        self.assertEqual(image.crop((0,0,1200,2700)).tobytes(),self.frame.crop((0,0,1200,2700)).tobytes())
    def test_invalid_input_is_rejected(self):
        for name in ('','A\nB','A\x00B','x'*81):
            with self.assertRaises(ValueError):footer.render_footer(self.frame,ASSETS,name,DATE,URL)
        for url in ('https://elsewhere.example/r/'+'a'*43,'javascript:alert(1)','https://nxbooth.gennexbyte.com/r/invalid','https://nxbooth.gennexbyte.com/'):
            with self.assertRaises(ValueError):footer.render_footer(self.frame,ASSETS,'Event',DATE,url)
        with self.assertRaises(ValueError):footer.render_footer(Image.new('RGBA',(1200,3601)),ASSETS,'Event',DATE,URL)
        with self.assertRaises(ValueError):footer.compose_event_strip(ASSETS,[photo('red',(20,20))],'Event',DATE,URL)

if __name__=='__main__': unittest.main()
