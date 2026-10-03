"""Frozen Classic strip format shared by artwork preparation and output."""
import io
import json
from pathlib import Path

from PIL import Image, ImageOps

PROFILE = json.loads((Path(__file__).resolve().parents[1] / 'data' / 'classic_print_profile.json').read_text())
PROFILE_ID = PROFILE['id']
MASTER_SIZE = (PROFILE['master']['width'], PROFILE['master']['height'])
PRINT_SIZE = (PROFILE['print']['width'], PROFILE['print']['height'])
MASTER_DPI = PROFILE['master']['dpi']
PRINT_DPI = PROFILE['print']['dpi']
assert MASTER_SIZE == (1200, 3600) and PRINT_SIZE == (600, 1800)
assert PRINT_DPI == 300 and MASTER_DPI == 600


def classic_print_bytes(data: bytes) -> bytes:
    with Image.open(io.BytesIO(data)) as source:
        source.load()
        image = ImageOps.exif_transpose(source).convert('RGBA')
    if image.width * 3 != image.height:
        raise ValueError('Classic print requires a 1:3 strip')
    image = image.resize(PRINT_SIZE, Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, 'PNG', dpi=(PRINT_DPI, PRINT_DPI))
    return output.getvalue()
