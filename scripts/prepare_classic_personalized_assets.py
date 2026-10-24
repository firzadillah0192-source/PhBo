"""Prepare reviewed three-photo overlays, real typography and sample previews.

Offline only. AI produces artwork; Python normalizes its dimensions, measures the
transparent openings and adds bundled fonts. It never edits customer photographs.
"""
import hashlib, importlib.util, json
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageStat

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'backend/app/data/classic-personalized-v3'
FONTS=ROOT/'backend/app/data/classic-floral-event-001'
spec=importlib.util.spec_from_file_location('footer',ROOT/'backend-express/python-worker/classic_event_footer.py')
footer=importlib.util.module_from_spec(spec);spec.loader.exec_module(footer)

def prepare(directory):
    design=json.loads((directory/'design.json').read_text())
    with Image.open(directory/'artwork.png') as source:
        if 'A' not in source.getbands() or abs(source.width/source.height-1/3)>.004:
            raise ValueError('Artwork must be a 1:3 alpha strip')
        frame=source.convert('RGBA').resize((1200,3600),Image.Resampling.LANCZOS)
    # Authorized precision pass: artwork is a background, aperture geometry is
    # owned by this compositor. Reclaim old alpha holes before cutting the three
    # equal windows; all areas outside them stay opaque, with no gray padding.
    foundation=Image.new('RGBA',frame.size,'#073957');foundation.alpha_composite(frame);frame=foundation
    slots=[dict(x=60,y=y,width=1080,height=826,fit='cover') for y in (106,960,1814)]
    draw=ImageDraw.Draw(frame)
    for slot in slots:
        x,y,w,h=(slot[k] for k in ('x','y','width','height'))
        draw.rectangle((x-3,y-3,x+w+2,y+h+2),outline='#d7b76d',width=2)
        draw.rectangle((x,y,x+w-1,y+h-1),fill=(0,0,0,0))
    if len({(s['x'],s['y']) for s in slots})!=3:raise ValueError('Exactly three separate openings required')
    if slots[0]['y']>150 or any(s['x']>80 or 1200-s['x']-s['width']>80 for s in slots):raise ValueError('Header/side bezel too wide')
    gaps=[b['y']-a['y']-a['height'] for a,b in zip(slots,slots[1:])]
    if any(g<0 or g>45 for g in gaps):raise ValueError('Photos must be closely packed')
    if slots[-1]['y']+slots[-1]['height']>2700:raise ValueError('Photo overlaps dynamic event footer')
    if sum(s['width']*s['height'] for s in slots)<1200*3600*.59:raise ValueError('Photo area must dominate the strip')
    luminance=sum(ImageStat.Stat(frame.crop((400,15,800,max(16,slots[0]['y']-10))).convert('RGB')).mean)/3
    brand_color='#18283e' if luminance>140 else '#fff6dc'
    brand_font=ImageFont.truetype(str(FONTS/'fonts/CormorantGaramond.ttf'),min(70,slots[0]['y']*2//3));brand_font.set_variation_by_name('SemiBold')
    ImageDraw.Draw(frame).text((600,slots[0]['y']//2),'NXBooth',font=brand_font,fill=brand_color,anchor='mm',stroke_width=1)
    frame.save(directory/'blank.png',dpi=(600,600))
    sample='Ulang Tahun Naya' if design['theme']=='birthday' else 'Khitan Adam' if design['theme']=='khitan' else 'Silaturahmi Keluarga' if design['theme'].startswith('eid-') else 'Sarah & Arif'
    preview=footer.render_footer(frame,FONTS,sample,datetime.fromisoformat('2026-10-10T07:00:00+00:00'),'https://nxbooth.gennexbyte.com/',preview=True)
    preview.save(directory/'preview.png',dpi=(600,600))
    metadata={'id':design['id'],'name':design['name'],'canvas_width':1200,'canvas_height':3600,'shot_count':3,'print_profile':'classic-strip-2x6-v1','slots':slots,'theme_slug':design['theme'],'theme_name':design['theme_name'],'event_personalization':True,'branding':{'text':'NXBooth','font':'CormorantGaramond SemiBold','color':brand_color},'event_name_font':'GreatVibes-Regular.ttf','date_font':'CormorantGaramond.ttf','timezone':'Asia/Jakarta','preview_sample':{'event_name':sample,'date':'10 Oktober 2026','qr_is_example':True},'footer_bounds':{'x':160,'y':2710,'width':880,'height':800}}
    (directory/'layout.json').write_text(json.dumps(metadata,indent=2)+'\n')
    (directory/'checksums.json').write_text(json.dumps({f:hashlib.sha256((directory/f).read_bytes()).hexdigest() for f in ['artwork.png','blank.png','preview.png','layout.json']},indent=2)+'\n')
    return metadata

if __name__=='__main__':
    frames=[];failed=[]
    for directory in sorted(ASSETS.iterdir()):
        if not directory.is_dir() or not (directory/'design.json').exists():continue
        try:frames.append(prepare(directory));print('PASS',directory.name,flush=True)
        except ValueError as error:failed.append({'id':directory.name,'error':str(error)});print('FAIL',directory.name,str(error),flush=True)
    report={'version':3,'status':'PASS' if len(frames)==35 and not failed else 'PARTIAL','frames':frames,'failed':failed}
    (ASSETS/'collection.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'prepared':len(frames),'failed':failed}),flush=True)
