"""Build offline Basic footer v2 candidates; never publish assets or write the DB.

Use the owner-approved per-template removal masks, not a shared rectangle.
Preparation needs Pillow, numpy and opencv-python-headless. Validation also
needs pytest and zxing-cpp. No generative model or network request is used.
Run with the existing event-template virtualenv; see --help.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import math
import shutil
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/srv/photobooth/templates')
OUTPUT = ROOT / 'backend/app/data/basic-footer-v2'
REVIEW = Path('/srv/photobooth/tmp/basic-footer-v2-review')
GENERIC = 'sci-fi-space-commander-001'
GENERIC_CONTENT = (1010, 1414)  # exact 5:7 source ratio; 122px free footer
GENERIC_OFFSET = (7, 0)
GENERIC_PLATE = (266, 1427, 768, 1473)
GENERIC_QR = (831, 1274, 990, 1433)
# Bounds of the original writing (including its rules), inside the plate bevel.
# QR bounds cover the original medallion plus the future renderer's 158px box.
# These are removal masks only: no QR, panel border, logo or lettering is drawn.
RECIPES = {
 'arctic-expedition-001': ((289,1398,735,1468),(803,1250,1000,1438)),
 'arctic-expedition-hijab-001': ((286,1409,745,1467),(797,1250,1002,1438)),
 'arctic-expedition-man-001': ((280,1421,773,1484),(797,1255,1008,1449)),
 'aviation-captain-001': ((277,1430,772,1493),(807,1274,1009,1461)),
 'aviation-captain-hijab-001': ((253,1413,782,1479),(805,1270,1011,1447)),
 'aviation-captain-man-001': ((251,1400,783,1468),(799,1254,1007,1438)),
 'cyberpunk-neon-001': ((288,1398,734,1464),(802,1248,1004,1438)),
 'cyberpunk-neon-hijab-001': ((289,1399,734,1464),(803,1255,1008,1438)),
 'cyberpunk-neon-man-001': ((285,1401,735,1465),(803,1253,1007,1438)),
 'royal-nusantara-001': ((281,1420,744,1474),(823,1266,998,1440)),
 'royal-nusantara-hijab-001': ((244,1429,774,1488),(819,1266,998,1442)),
 'royal-nusantara-man-001': ((260,1419,769,1479),(819,1266,999,1440)),
 'sci-fi-space-commander-female-001': ((289,1392,735,1465),(801,1250,1005,1438)),
 'sci-fi-space-commander-framed-001': ((288,1394,735,1465),(801,1250,1005,1438)),
 'sci-fi-space-commander-hijab-001': ((289,1392,735,1465),(801,1250,1005,1438)),
}
PROTECTED = {'royal-nusantara-hijab-001': ((480,1483,540,1488),)}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def feathered_mask(size, box, feather):
    """Feather inward only; the declared bounds are a hard edit limit."""
    x0,y0,x1,y1 = box
    mask = Image.new('L', size)
    local = Image.new('L', (x1-x0,y1-y0))
    ImageDraw.Draw(local).rectangle((feather,feather,local.width-feather-1,local.height-feather-1),fill=255)
    local = local.filter(ImageFilter.GaussianBlur(feather/2))
    mask.paste(local,(x0,y0))
    return mask


def surface_color(original, box):
    # Select the darker half of the existing plate, excluding lettering/lines.
    pixels = sorted(original.crop(box).get_flattened_data(), key=lambda p: sum(p[:3]))
    return tuple(round(sum(p[c] for p in pixels[len(pixels)//5:len(pixels)//2]) / (len(pixels)//2-len(pixels)//5)) for c in range(3))


def continued_surface(original, box):
    """Harmonic continuation of the frame surface, using its boundary colors.

    Solve the discrete Laplace equation on a fixed coarse grid, then restore
    the full-resolution edge. Unlike inpainting, this cannot invent spokes,
    lettering or a QR panel. No new border or decorative shape is introduced.
    """
    import cv2
    import numpy as np
    cv2.setNumThreads(1)
    x0,y0,x1,y1=box;w,h=x1-x0,y1-y0
    # Keep original boundary samples fixed. Only the declared region can change.
    source=np.asarray(original.crop((x0-2,y0-2,x1+2,y1+2)),dtype=np.float32)
    small=cv2.resize(source,(max(8,(w+4)//4),max(8,(h+4)//4)),interpolation=cv2.INTER_AREA)
    field=small.copy();field[1:-1,1:-1]=np.concatenate((small[0],small[-1],small[:,0],small[:,-1])).mean(axis=0)
    kernel=np.array([[0,.25,0],[.25,0,.25],[0,.25,0]],dtype=np.float32)
    for _ in range(2400):
        avg=cv2.filter2D(field,-1,kernel)
        field[1:-1,1:-1]=avg[1:-1,1:-1]
    field=cv2.resize(field,(w+4,h+4),interpolation=cv2.INTER_CUBIC)
    # This template's edge is restored before the final full-resolution solve.
    field[:2]=source[:2];field[-2:]=source[-2:];field[:,:2]=source[:,:2];field[:,-2:]=source[:,-2:]
    for _ in range(160):
        avg=cv2.filter2D(field,-1,kernel)
        field[2:-2,2:-2]=avg[2:-2,2:-2]
    return Image.fromarray(np.clip(np.rint(field[2:-2,2:-2]),0,255).astype(np.uint8))


def repair(original, plate, qr, protected=()):
    original = original.convert('RGB')
    color = surface_color(original, plate)
    fixed = original.copy()
    plate_mask=feathered_mask(original.size,plate,2)
    for x0,y0,x1,y1 in protected:
        ImageDraw.Draw(plate_mask).rectangle((x0,y0,x1-1,y1-1),fill=0)
    surface=Image.new('RGB',original.size,color)
    fixed.paste(surface,(0,0),plate_mask)
    qr=(831,1274,990,1433)
    qr_mask=Image.new('L',original.size)
    ImageDraw.Draw(qr_mask).rounded_rectangle((831,1274,989,1432),radius=10,fill=255)
    fixed.paste(Image.new('RGB',original.size,surface_color(original,qr)),(0,0),qr_mask)
    return fixed, ImageChops.lighter(plate_mask,qr_mask)


def generic_base(original):
    """Fit all original pixels above the event line without stretching/cropping.

    1060:1484 == 1010:1414 == 5:7. Only seven pixels of padding are
    needed per side. A plain continuation of the original dark background color occupies
    the additional bottom band; no border, logo or lettering is introduced.
    """
    original=original.convert('RGB')
    if original.size!=(1060,1484):raise ValueError('Unexpected generic source dimensions')
    color=surface_color(original,(780,0,1020,80))
    base=Image.new('RGB',(1024,1536),color)
    base.paste(original.resize(GENERIC_CONTENT,Image.Resampling.LANCZOS),GENERIC_OFFSET)
    return base


def generic_metadata(meta):
    meta=json.loads(json.dumps(meta))
    scale=GENERIC_CONTENT[0]/1060
    def point(p):return [round(p[0]*scale+GENERIC_OFFSET[0]),round(p[1]*scale+GENERIC_OFFSET[1])]
    if 'face_region' in meta:
        x,y,w,h=meta['face_region']
        x0=math.floor(x*scale+GENERIC_OFFSET[0]);y0=math.floor(y*scale+GENERIC_OFFSET[1])
        x1=math.ceil((x+w)*scale+GENERIC_OFFSET[0]);y1=math.ceil((y+h)*scale+GENERIC_OFFSET[1])
        meta['face_region']=[x0,y0,x1-x0,y1-y0]
    if 'face_anchors' in meta:meta['face_anchors']={k:point(v) for k,v in meta['face_anchors'].items()}
    if 'mask_polygon' in meta:meta['mask_polygon']=[point(p) for p in meta['mask_polygon']]
    meta['width']=1024;meta['height']=1536
    return meta


def prepare_generic():
    src=SOURCE/GENERIC;dst=OUTPUT/GENERIC;dst.mkdir(exist_ok=True)
    before=sha(src/'template.png')
    with Image.open(src/'template.png') as original:
        base=generic_base(original)
        fixed,mask=repair(base,GENERIC_PLATE,GENERIC_QR)
    fixed.save(dst/'template.png')
    fixed.resize((256,384),Image.Resampling.LANCZOS).save(dst/'preview.png')
    mask.save(dst/'edit-mask.png')
    meta=generic_metadata(json.loads((src/'template.json').read_text()))
    write_json(dst/'template.json',meta)
    assert before==sha(src/'template.png')
    row={'id':GENERIC,'version':2,'status':'CANDIDATE_PENDING_VISUAL_REVIEW','source_sha256':before,
         'source_dimensions':[1060,1484],'output_dimensions':[1024,1536],
         'normalization':{'content_size':list(GENERIC_CONTENT),'offset':list(GENERIC_OFFSET),
                          'aspect_preserved':True,'crop':False,'footer_band_height':122},
         'plate_removal_box':GENERIC_PLATE,'qr_removal_box':GENERIC_QR,'qr_style':'B: original outer mounting detail preserved',
         'outside_mask_identical':False,'outside_mask_reference':'aspect-preserving normalized source',
         'metadata_byte_identical':False,'metadata_changes':['width','height','face_region','face_anchors','mask_polygon']}
    write_json(dst/'checksums.json',{p.name:sha(p) for p in sorted(dst.iterdir()) if p.name!='checksums.json'})
    print(GENERIC,flush=True)
    return row


def prepare():
    if OUTPUT.resolve() == SOURCE.resolve() or SOURCE.resolve() in OUTPUT.resolve().parents:
        raise ValueError('Output must not be the production template directory')
    OUTPUT.mkdir(parents=True,exist_ok=True)
    rows=[]
    for ident,(plate,qr) in RECIPES.items():
        src=SOURCE/ident;dst=OUTPUT/ident;dst.mkdir(exist_ok=True)
        before=sha(src/'template.png')
        with Image.open(src/'template.png') as im:
            if im.size!=(1024,1536): raise ValueError(f'{ident}: unexpected size {im.size}')
            fixed,mask=repair(im,plate,qr,PROTECTED.get(ident,()))
            delta=ImageChops.difference(fixed,im.convert('RGB'))
            outside=ImageChops.multiply(delta,Image.merge('RGB',(ImageChops.invert(mask.point(lambda v:255 if v else 0)),)*3))
            assert outside.getbbox() is None, ident
        fixed.save(dst/'template.png')
        fixed.resize((256,384),Image.Resampling.LANCZOS).save(dst/'preview.png')
        mask.save(dst/'edit-mask.png')
        shutil.copyfile(src/'template.json',dst/'template.json')
        assert before==sha(src/'template.png')
        print(ident, flush=True)
        row={'id':ident,'version':2,'status':'CANDIDATE_PENDING_VISUAL_REVIEW','source_sha256':before,
             'plate_removal_box':plate,'qr_removal_box':(831,1274,990,1433),'qr_style':'B: original outer mounting detail preserved','outside_mask_identical':True,
             'protected_rectangles':PROTECTED.get(ident,()),
             'metadata_byte_identical':sha(src/'template.json')==sha(dst/'template.json')}
        write_json(dst/'checksums.json',{p.name:sha(p) for p in sorted(dst.iterdir()) if p.name!='checksums.json'})
        rows.append(row)
    rows.append(prepare_generic())
    write_json(OUTPUT/'collection.json',{'version':2,'status':'CANDIDATE','published':False,'templates':rows,'deferred':[]})
    return rows


def contact_sheet(rows, rendered=False):
    cols=3;w=1024;h=390
    sheet=Image.new('RGB',(cols*w,((len(rows)+cols-1)//cols)*h),'#ddd')
    d=ImageDraw.Draw(sheet)
    for i,row in enumerate(rows):
        ident=row['id'];p=(REVIEW/'renders'/ident/'short.png') if rendered else OUTPUT/ident/'template.png'
        with Image.open(p) as im:crop=im.crop((0,1180,1024,1536))
        x=i%cols*w;y=i//cols*h;sheet.paste(crop,(x,y+30));d.text((x+8,y+7),ident,fill='black')
    sheet.save(REVIEW/('rendered-footers.png' if rendered else 'v2-contact-sheet.png'))
    # Full composition sheet includes all 16 new candidates.
    full=Image.new('RGB',(4*256,4*420),'#ddd');d=ImageDraw.Draw(full)
    for i,ident in enumerate(sorted(r['id'] for r in rows)):
        p=OUTPUT/ident/'template.png'
        with Image.open(p) as im:
            im=im.copy();im.thumbnail((256,384))
            x=i%4*256;y=i//4*420;full.paste(im,(x,y+30))
        d.text((x+2,y+3),ident,fill='black')
    full.save(REVIEW/'all-16-contact-sheet.jpg',quality=95)


def validate(rows):
    import zxingcpp
    sys.path.insert(0,str(ROOT/'backend-express/python-worker'))
    import result_footer as footer
    fonts=ROOT/'backend/app/data/classic-floral-event-001'
    url='https://nxbooth.gennexbyte.com/r/'+'a'*43
    now=datetime.now(ZoneInfo('Asia/Jakarta'))
    cases=[('short','Ulang Tahun Budi'),('long',('Perayaan Bersama Keluarga dan Sahabat '*3)[:80]),('none',None),('unbroken','W'*80)]
    results=[]
    # Observe actual glyph bounds, including each line of a multiline event name.
    real_text=ImageDraw.ImageDraw.text
    bounds=[]
    def checked_text(draw,xy,text,*args,**kwargs):
        font=kwargs.get('font', args[1] if len(args)>1 else None)
        b=draw.textbbox(xy,text,font=font,stroke_width=kwargs.get('stroke_width',0))
        bounds.append(b)
        return real_text(draw,xy,text,*args,**kwargs)
    ImageDraw.ImageDraw.text=checked_text
    try:
        for row in rows:
            ident=row['id'];src=SOURCE/ident;dst=OUTPUT/ident
            print('Validating '+ident,flush=True)
            assert sha(src/'template.png')==row['source_sha256']
            a=Image.open(src/'template.png').convert('RGB');b=Image.open(dst/'template.png').convert('RGB')
            if ident==GENERIC:a=generic_base(a)
            mask=Image.open(dst/'edit-mask.png').point(lambda v:255 if v else 0)
            outside=ImageChops.multiply(ImageChops.difference(a,b),Image.merge('RGB',(ImageChops.invert(mask),)*3))
            assert outside.getbbox() is None
            if ident==GENERIC:
                assert json.loads((dst/'template.json').read_text())==generic_metadata(json.loads((src/'template.json').read_text()))
                assert GENERIC_CONTENT[0]*1484==GENERIC_CONTENT[1]*1060
            else:assert (src/'template.json').read_bytes()==(dst/'template.json').read_bytes()
            for key,name in cases:
                bounds.clear()
                data=footer.render_result_footer((dst/'template.png').read_bytes(),'basic',name,now,url,fonts)
                im=Image.open(io.BytesIO(data))
                assert im.size==(1024,1536)
                assert [r.text for r in zxingcpp.read_barcodes(im.crop((826,1269,995,1438)))]==[url],(ident,key,'QR')
                assert bounds and all(266<=x0<=x1<=768 and 1427<=y0<=y1<=1473 for x0,y0,x1,y1 in bounds),(ident,key,bounds)
                folder=REVIEW/'renders'/ident;folder.mkdir(parents=True,exist_ok=True);(folder/(key+'.png')).write_bytes(data)
                results.append({'id':ident,'case':key,'size_ok':True,'qr_decode_ok':True,'qr_decode_region':[826,1269,995,1438],'glyph_bounds_ok':True})
    finally:ImageDraw.ImageDraw.text=real_text
    report={'status':'PASS_TECHNICAL_ONLY','date_local':now.date().isoformat(),'date_text':footer.capture_date(now),'render_cases':results,
        'outside_approved_masks':'15 identical to v1; generic identical to normalized source',
        'source_templates':'ALL_16_UNCHANGED','metadata':'15 byte-identical; generic coordinates and dimensions transformed',
        'visual_acceptance':'NOT_PASSED; see visual-review.json',
        'full_job':'NOT_RUN: no deploy, asset activation, DB writes or paid provider call authorized',
        'qr_url':'synthetic, unregistered test token; decoding is not a working production claim'}
    write_json(REVIEW/'validation.json',report)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--validate',action='store_true',help='Also render all cases and decode QR')
    args=parser.parse_args();REVIEW.mkdir(parents=True,exist_ok=True)
    rows=prepare();contact_sheet(rows)
    if args.validate:
        report=validate(rows);contact_sheet(rows,True)
        print(f"PASS: {len(rows)} candidates; {len(report['render_cases'])} renders, QR decodes and glyph bounds")
    else:print(f'{len(rows)} offline candidates prepared; visual review and --validate required')


if __name__=='__main__':main()
