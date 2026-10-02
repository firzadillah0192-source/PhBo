"""Create disposable slot-placement samples from synthetic graphics only."""

from __future__ import annotations

import io
import json
from pathlib import Path
from types import SimpleNamespace

from PIL import Image, ImageDraw, ImageFont

from app.services.classic import CLASSIC_SEEDS, compose_classic


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "test" / "output"
OUTPUT.mkdir(parents=True, exist_ok=True)
COLORS = ((76, 161, 214), (224, 120, 122), (131, 194, 141), (226, 191, 105))


def synthetic_photo(index: int) -> bytes:
    image = Image.new("RGB", (960, 640), COLORS[index % len(COLORS)])
    draw = ImageDraw.Draw(image)
    draw.ellipse((290, 80, 670, 460), fill=(252, 247, 226), outline=(22, 28, 38), width=16)
    draw.line((480, 0, 480, 640), fill=(22, 28, 38), width=9)
    draw.line((0, 320, 960, 320), fill=(22, 28, 38), width=9)
    draw.text((45, 35), f"SYNTHETIC SHOT {index + 1}", fill=(22, 28, 38), font=ImageFont.load_default())
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


for slug, _name, filename, raw_slots in CLASSIC_SEEDS:
    slots = [dict(x=x, y=y, width=width, height=height, fit="cover") for x, y, width, height in raw_slots]
    layout = SimpleNamespace(
        frame_asset_path=str(ROOT / "templates" / "_classic" / filename),
        canvas_width=724,
        canvas_height=2172,
        shot_count=len(slots),
        layout_config_json=json.dumps({"slots": slots}),
    )
    path = OUTPUT / f"{slug}-synthetic-review.png"
    path.write_bytes(compose_classic(layout, [synthetic_photo(index) for index in range(len(slots))]))
    print(path)
