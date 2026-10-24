"""Exercise every revised theme with the production Classic compositor + footer.

Only synthetic solid-color fixtures are used; no customer photo directories.
"""
import importlib.util
import io
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from PIL import Image, ImageChops
import zxingcpp
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'backend'))
# The compositor only uses this model for annotations. Avoid importing the
# legacy database/settings in an image-only test, or opening any DB connection.
with patch.dict(sys.modules, {'app.models': SimpleNamespace(ClassicLayout=SimpleNamespace)}):
    from app.services.classic import compose_classic
from classic_event_footer import render_footer, print_strip

ASSETS = ROOT/'backend/app/data/classic-personalized-v3'
FONTS = ROOT/'backend/app/data/classic-floral-event-001'
URL = 'https://nxbooth.gennexbyte.com/r/'+'a'*43
DATE = datetime.fromisoformat('2026-10-09T17:30:00+00:00')

class CollectionTests(unittest.TestCase):
    def test_all_themes_geometry_preview_composition_and_print_qr(self):
        rows=json.loads((ASSETS/'collection.json').read_text())
        self.assertEqual(rows['status'],'PASS');self.assertEqual(len(rows['frames']),35)
        photos=[]
        for color,size in [('red',(900,300)),('green',(300,900)),('blue',(300,300))]:
            data=io.BytesIO();Image.new('RGB',size,color).save(data,'PNG');photos.append(data.getvalue())
        for meta in rows['frames']:
            with self.subTest(theme=meta['id']):
                directory=ASSETS/meta['id'];frame=Image.open(directory/'blank.png').convert('RGBA')
                preview=Image.open(directory/'preview.png').convert('RGBA')
                self.assertEqual(frame.size,(1200,3600));self.assertEqual(meta['shot_count'],3)
                self.assertEqual(meta['slots'],[dict(x=60,y=y,width=1080,height=826,fit='cover') for y in (106,960,1814)])
                alpha=frame.getchannel('A');self.assertEqual(alpha.histogram()[0],3*1080*826)
                self.assertEqual(alpha.histogram()[255],1200*3600-3*1080*826)
                self.assertEqual(frame.crop((0,0,1200,2700)).tobytes(),preview.crop((0,0,1200,2700)).tobytes())
                regenerated=render_footer(frame,FONTS,meta['preview_sample']['event_name'],datetime.fromisoformat('2026-10-10T07:00:00+00:00'),'https://nxbooth.gennexbyte.com/',preview=True)
                self.assertEqual(regenerated.tobytes(),preview.tobytes())
                layout=SimpleNamespace(canvas_width=1200,canvas_height=3600,shot_count=3,layout_config_json=json.dumps({'slots':meta['slots']}),frame_asset_path=str(directory/'blank.png'))
                composed=Image.open(io.BytesIO(compose_classic(layout,photos))).convert('RGBA')
                composed=render_footer(composed,FONTS,'Perayaan Pernikahan Sarah dan Arif Bersama Keluarga Besar',DATE,URL).convert('RGB')
                self.assertEqual(composed.size,(1200,3600))
                for slot,color in zip(meta['slots'],[(255,0,0),(0,128,0),(0,0,255)]):
                    self.assertEqual(composed.getpixel((slot['x']+540,slot['y']+413)),color)
                self.assertEqual(zxingcpp.read_barcode(composed).text,URL)
                data=io.BytesIO();composed.save(data,'PNG',dpi=(600,600))
                printed=Image.open(io.BytesIO(print_strip(data.getvalue())))
                self.assertEqual(printed.size,(600,1800));self.assertAlmostEqual(printed.info['dpi'][0],300,delta=.1)
                self.assertEqual(zxingcpp.read_barcode(printed).text,URL)

if __name__=='__main__':unittest.main()
