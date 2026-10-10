"""Prepare the fixed-size blank and preview using the production footer renderer."""
import importlib.util
import json
from pathlib import Path
from datetime import datetime
import hashlib
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'backend/app/data/classic-floral-event-001'
spec=importlib.util.spec_from_file_location('footer',ROOT/'backend-express/python-worker/classic_event_footer.py')
footer=importlib.util.module_from_spec(spec);spec.loader.exec_module(footer)
with Image.open(ASSETS/'artwork-source-v2.png') as source:
    frame=source.convert('RGBA').resize(footer.MASTER_SIZE,Image.Resampling.LANCZOS)
# Reviewable transparent-component geometry from the generated overlay, no guessed slots.
alpha=frame.getchannel('A'); slots=[]
for ratio in (.2,.4,.6):
    mask=alpha.point(lambda value:255 if value==0 else 0)
    ImageDraw.floodfill(mask,(600,int(3600*ratio)),128)
    box=mask.point(lambda value:255 if value==128 else 0).getbbox()
    if not box:raise ValueError('Transparent photo opening is missing')
    x,y,right,bottom=box
    area=alpha.crop(box).histogram()[0]/((right-x)*(bottom-y))
    if area<.85:raise ValueError('Photo slot must have a clear transparent opening')
    slots.append(dict(x=x,y=y,width=right-x,height=bottom-y,fit='cover'))
# Brand is real bundled typography, baked into both versions before personalization.
brand_font=ImageFont.truetype(str(ASSETS/'fonts/CormorantGaramond.ttf'),70)
brand_font.set_variation_by_name('SemiBold')
ImageDraw.Draw(frame).text((600,slots[0]['y']//2),'NXBooth',font=brand_font,fill='#fff6dc',anchor='mm',stroke_width=1)
frame.save(ASSETS/'blank.png',dpi=(600,600))
preview=footer.render_footer(frame,ASSETS,'Sarah & Arif',datetime.fromisoformat('2026-10-10T07:00:00+00:00'),'https://nxbooth.gennexbyte.com/',preview=True)
preview.save(ASSETS/'preview.png',dpi=(600,600))
metadata={'id':'classic-floral-event-001','name':'Blue Floral Event','print_profile':'classic-strip-2x6-v1','canvas_width':1200,'canvas_height':3600,'shot_count':3,'slots':slots,'blank_asset':'blank.png','preview_asset':'preview.png','event_name_font':'fonts/GreatVibes-Regular.ttf','date_font':'fonts/CormorantGaramond.ttf','timezone':'Asia/Jakarta','preview_sample':{'event_name':'Sarah & Arif','date':'10 Oktober 2026','qr_destination':'https://nxbooth.gennexbyte.com/','qr_is_example':True},'footer_bounds':{'x':160,'y':2710,'width':880,'height':800}}
metadata['artwork_source']='artwork-source-v2.png'
metadata['branding']={'text':'NXBooth','font':'fonts/CormorantGaramond.ttf','variant':'SemiBold','size':70,'center':[600,slots[0]['y']//2]}
(ASSETS/'layout.json').write_text(json.dumps(metadata,indent=2)+'\n')
files=['blank.png','preview.png','layout.json','fonts/GreatVibes-Regular.ttf','fonts/CormorantGaramond.ttf']
(ASSETS/'checksums.json').write_text(json.dumps({name:hashlib.sha256((ASSETS/name).read_bytes()).hexdigest() for name in files},indent=2)+'\n')
print(json.dumps({'status':'PASS','master':[1200,3600],'shots':3,'slots':slots,'blank':str(ASSETS/'blank.png'),'preview':str(ASSETS/'preview.png')}))
