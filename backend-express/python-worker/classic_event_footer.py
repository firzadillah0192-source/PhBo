"""Font-only Classic event footer and deterministic three-photo composition.

Artwork is supplied as an overlay. No provider call, generated lettering, canvas
extension, contain resize, or system font fallback is used by this module.
"""
from __future__ import annotations
import io
import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode

MASTER_SIZE = (1200, 3600)
PRINT_SIZE = (600, 1800)
WIB = ZoneInfo('Asia/Jakarta')
MONTHS = ('Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember')


def normalize_event_name(value: str) -> str:
    if not isinstance(value, str) or any(unicodedata.category(c).startswith('C') for c in value):
        raise ValueError('Nama event tidak boleh mengandung karakter kontrol.')
    name = unicodedata.normalize('NFC', value.strip())
    if not 1 <= len(name) <= 80:
        raise ValueError('Nama event harus berisi 1–80 karakter.')
    return name


def capture_date(captured_at: datetime) -> str:
    if not isinstance(captured_at, datetime) or captured_at.tzinfo is None:
        raise ValueError('Waktu pengambilan foto harus memiliki zona waktu.')
    local = captured_at.astimezone(WIB)
    return f'{local.day:02d} {MONTHS[local.month - 1]} {local.year}'


def _title(draw: ImageDraw.ImageDraw, name: str, font_path: Path):
    # One or two lines with exactly the same bundled font for preview and output.
    candidates = [name]
    words = name.split()
    if len(words) > 1:
        split = min(range(1, len(words)), key=lambda i: abs(len(' '.join(words[:i])) - len(' '.join(words[i:]))))
        candidates.append(' '.join(words[:split]) + '\n' + ' '.join(words[split:]))
    for text in candidates:
        for size in range(140 if '\n' not in text else 100, 35, -2):
            font = ImageFont.truetype(str(font_path), size)
            box = draw.multiline_textbbox((0, 0), text, font=font, spacing=6, align='center')
            if box[2] - box[0] <= 880 and box[3] - box[1] <= 220:
                return text, font, box
    raise ValueError('Nama event terlalu panjang untuk frame ini. Gunakan nama yang lebih singkat.')


def render_footer(frame: Image.Image, asset_dir: Path, event_name: str,
                  captured_at: datetime, download_url: str, *, preview: bool = False) -> Image.Image:
    if frame.size != MASTER_SIZE:
        raise ValueError('Ukuran frame harus tepat 1200 × 3600 px.')
    url = urlparse(download_url)
    if url.scheme != 'https' or url.netloc != 'nxbooth.gennexbyte.com' or url.query or url.fragment:
        raise ValueError('QR harus memakai tautan foto NXBooth yang aman.')
    if not preview and not re.fullmatch(r'/r/[A-Za-z0-9_-]{32,256}', url.path):
        raise ValueError('QR hasil harus memakai tautan download foto yang sebenarnya.')
    if len(download_url) > 200:
        raise ValueError('Tautan QR terlalu panjang untuk dicetak pada strip.')
    name = normalize_event_name(event_name)
    output = frame.convert('RGBA').copy()
    draw = ImageDraw.Draw(output)
    text, font, box = _title(draw, name, asset_dir / 'fonts/GreatVibes-Regular.ttf')
    height = box[3] - box[1]
    draw.multiline_text((600 - (box[2] - box[0]) / 2 - box[0], 2830 - height / 2 - box[1]), text,
                        font=font, fill='#f9df9e', align='center', spacing=6)
    serif = ImageFont.truetype(str(asset_dir / 'fonts/CormorantGaramond.ttf'), 60)
    if hasattr(serif, 'set_variation_by_name'):
        serif.set_variation_by_name('Regular')
    draw.text((600, 3020), capture_date(captured_at), font=serif, fill='#fff6dc', anchor='mm')
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4, box_size=1)
    qr.add_data(download_url); qr.make(fit=True)
    code = qr.make_image(fill_color='black', back_color='white').convert('RGBA')
    # Whole pixel modules, including a four-module white quiet zone.
    scale = 330 // code.width
    if scale < 3:
        raise ValueError('QR terlalu padat untuk ukuran cetak ini.')
    code = code.resize((code.width * scale, code.height * scale), Image.Resampling.NEAREST)
    output.alpha_composite(code, ((1200 - code.width) // 2, 3080 + (330 - code.height) // 2))
    caption = ImageFont.truetype(str(asset_dir / 'fonts/CormorantGaramond.ttf'), 42)
    draw = ImageDraw.Draw(output)
    draw.text((600, 3470), 'Contoh QR' if preview else 'Scan untuk download', font=caption, fill='#fff6dc', anchor='mm')
    return output


def compose_event_strip(asset_dir: Path, photos: list[bytes], event_name: str,
                        captured_at: datetime, download_url: str) -> bytes:
    metadata = json.loads((asset_dir / 'layout.json').read_text())
    if metadata['shot_count'] != 3 or len(photos) != 3:
        raise ValueError('Template ini membutuhkan tepat 3 foto.')
    with Image.open(asset_dir / 'blank.png') as source:
        if source.size != MASTER_SIZE:
            raise ValueError('Ukuran frame tidak cocok dengan profil cetak.')
        frame = source.convert('RGBA')
    # Opaque artwork-coloured foundation, never gray letterboxing around a strip.
    canvas = Image.new('RGBA', MASTER_SIZE, '#073957')
    for data, slot in zip(photos, metadata['slots'], strict=True):
        with Image.open(io.BytesIO(data)) as source:
            photo = ImageOps.exif_transpose(source).convert('RGB')
            fitted = ImageOps.fit(photo, (slot['width'], slot['height']), Image.Resampling.LANCZOS)
        canvas.paste(fitted, (slot['x'], slot['y']))
    canvas.alpha_composite(frame)
    canvas = render_footer(canvas, asset_dir, event_name, captured_at, download_url)
    output = io.BytesIO()
    canvas.convert('RGB').save(output, 'PNG', dpi=(600, 600))
    return output.getvalue()


def print_strip(master: bytes) -> bytes:
    with Image.open(io.BytesIO(master)) as image:
        if image.size != MASTER_SIZE:
            raise ValueError('Master harus tepat 1200 × 3600 px; padding tidak diizinkan.')
        output = image.convert('RGB').resize(PRINT_SIZE, Image.Resampling.LANCZOS)
    buffer = io.BytesIO(); output.save(buffer, 'PNG', dpi=(300, 300))
    return buffer.getvalue()
