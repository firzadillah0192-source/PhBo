"""Uniformly prepare the three original Classic frames for the frozen master.

Preserves original PNGs and branding. Original 724x2172 images are sufficient
for 2x6 at 362 DPI; upscaling the working master does not add source detail.
"""
import ast
import hashlib
import json
import math
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.services.classic_format import MASTER_SIZE, PRINT_SIZE, MASTER_DPI, PRINT_DPI, PROFILE_ID

tree = ast.parse((ROOT / 'backend/app/services/classic.py').read_text())
seeds = next(ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'CLASSIC_SEEDS' for target in node.targets))
output = ROOT / 'templates/_classic/original-masters'
output.mkdir(parents=True, exist_ok=True)
(output / 'previews').mkdir(exist_ok=True)
(output / 'print').mkdir(exist_ok=True)
definitions = []
for order, (slug, name, filename, raw_slots) in enumerate(seeds):
    source = ROOT / 'templates/_classic' / filename
    with Image.open(source) as opened:
        opened.load()
        if opened.size != (724, 2172) or opened.width * 3 != opened.height or 'A' not in opened.getbands():
            raise ValueError('Original Classic asset differs from its reviewed source')
        scale = MASTER_SIZE[0] / opened.width
        frame = opened.resize(MASTER_SIZE, Image.Resampling.LANCZOS)
    slots = []
    for x, y, width, height in raw_slots:
        left, top = math.ceil(x * scale), math.ceil(y * scale)
        right, bottom = math.floor((x + width) * scale), math.floor((y + height) * scale)
        slots.append(dict(x=left, y=top, width=right - left, height=bottom - top, fit='cover'))
    target = output / filename
    frame.save(target, 'PNG', optimize=True, dpi=(MASTER_DPI, MASTER_DPI))
    preview = frame.copy(); preview.thumbnail((160, 480), Image.Resampling.LANCZOS)
    preview.save(output / 'previews' / filename, 'PNG', optimize=True)
    frame.resize(PRINT_SIZE, Image.Resampling.LANCZOS).save(output / 'print' / filename, 'PNG', optimize=True, dpi=(PRINT_DPI, PRINT_DPI))
    definitions.append(dict(id=slug, name=name, filename='original-masters/' + filename, collection_version=2, print_profile=PROFILE_ID, canvas_width=MASTER_SIZE[0], canvas_height=MASTER_SIZE[1], shot_count=len(slots), slots=slots, sort_order=order, sha256=hashlib.sha256(target.read_bytes()).hexdigest(), source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(), source_width=724, source_height=2172, branding_source='original-artwork'))
(ROOT / 'backend/app/data/classic_original_strip_frames.json').write_text(json.dumps({'version': 2, 'frames': definitions}, indent=2))
print(json.dumps({'masters': len(definitions), 'master': MASTER_SIZE, 'print': PRINT_SIZE, 'print_dpi': PRINT_DPI}))
