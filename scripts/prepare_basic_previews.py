"""Render Basic gallery previews that show the finished footer (sample event name, date and QR).

The v2 template art has an empty plate and an empty QR square; as a gallery preview it looks
unfinished. This draws sample lettering and a QR (to the NXBooth homepage) with the same code that
draws real footers, then scales to the 256x384 preview size. Deterministic, local, no AI.
Usage: python prepare_basic_previews.py <v2-assets-dir> <out-dir>
"""
import io
import json
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend-express/python-worker'))
import result_footer as footer  # noqa: E402

FONTS = Path(__file__).resolve().parents[1] / 'backend/app/data/classic-floral-event-001'
SAMPLE_NAME, SAMPLE_DATE, SAMPLE_URL = 'Nama Event Anda', 'Tanggal Acara', 'https://nxbooth.gennexbyte.com'


def render(template: Path) -> bytes:
    image = Image.open(template).convert('RGB')
    code = footer._qr(SAMPLE_URL, round(footer.BASIC_QR_SIZE * image.width))
    image = footer._basic(image, FONTS, SAMPLE_NAME, SAMPLE_DATE, code)
    output = io.BytesIO()
    image.resize((256, 384), Image.Resampling.LANCZOS).save(output, 'PNG', optimize=True)
    return output.getvalue()


def main(assets: Path, out: Path) -> None:
    ids = [t['id'] for t in json.loads((assets / 'collection.json').read_text())['templates']]
    for template_id in ids:
        target = out / template_id
        target.mkdir(parents=True, exist_ok=True)
        (target / 'preview.png').write_bytes(render(assets / template_id / 'template.png'))
    print(json.dumps({'status': 'PASS', 'previews': len(ids)}))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
