"""Render synthetic, non-customer review composites with the real compositor."""
import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.classic import compose_classic
from app.services.classic_events import event_frame_definitions, original_frame_definitions
from app.services.classic_format import classic_print_bytes

output = ROOT / 'test' / 'output' / 'classic-strip-v2' / 'composites'
output.mkdir(parents=True, exist_ok=True)
(output / 'print').mkdir(exist_ok=True)
captures = []
for index, color in enumerate(('#b55754', '#387a9b', '#54936a', '#c4963e'), 1):
    photo = Image.new('RGB', (1200, 800), color)
    draw = ImageDraw.Draw(photo)
    draw.ellipse((480, 250, 720, 490), outline='white', width=8)
    draw.line((0, 400, 1200, 400), fill='white', width=3)
    draw.line((600, 0, 600, 800), fill='white', width=3)
    draw.text((600, 100), f'SYNTHETIC SHOT {index}', fill='white', font=ImageFont.load_default(size=45), anchor='mt')
    stream = io.BytesIO()
    photo.save(stream, 'PNG')
    captures.append(stream.getvalue())
frames = original_frame_definitions() + event_frame_definitions()
sheet = Image.new('RGB', (1280, 520 * 9), '#eee9e1')
draw = ImageDraw.Draw(sheet)
for index, item in enumerate(frames):
    base = ROOT / 'templates' / '_classic'
    if 'theme_slug' in item:
        base /= 'events'
    row = SimpleNamespace(canvas_width=item['canvas_width'], canvas_height=item['canvas_height'], shot_count=item['shot_count'], layout_config_json=json.dumps({'slots': item['slots']}), frame_asset_path=str(base / item['filename']))
    data = compose_classic(row, captures[:item['shot_count']])
    (output / (item['id'] + '.png')).write_bytes(data)
    (output / 'print' / (item['id'] + '.png')).write_bytes(classic_print_bytes(data))
    with Image.open(io.BytesIO(data)) as image:
        image.thumbnail((296, 450))
        x, y = (index % 4) * 320, (index // 4) * 520
        sheet.paste(image.convert('RGB'), (x + 12, y))
        draw.text((x + 8, y + 458), item['id'], fill='#202020')
        draw.text((x + 8, y + 477), item['name'], fill='#202020')
sheet.save(output.parent / 'composite-contact-sheet.jpg')
print(json.dumps({'synthetic_composites': len(frames), 'provider_calls': 0}))
