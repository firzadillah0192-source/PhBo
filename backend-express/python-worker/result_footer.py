"""Deterministic event footer (event name, date, download QR) for Basic and Advanced results.

The AI image is never asked to draw lettering or a QR code. This module draws
them afterwards, in place, with bundled fonts. Output dimensions always equal
the input dimensions; nothing is extended, stretched or cropped.

Basic: v2 template art carries an empty event plate and an empty square QR slot.
The original v1 plates/medallions have different positions and are not compatible
with this geometry; use the separately reviewed v2 assets when enabling it.
Advanced: the provider image is contain-fitted on a blurred 2:3 master, which
leaves a free blurred band at the bottom; the footer sits in that band.
"""
from __future__ import annotations
import io
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageStat
import qrcode

from classic_event_footer import capture_date, normalize_event_name

TEXT = '#f3dfa6'
BASIC_TEXT = '#fff4d6'
# Fractions of a 1024x1536 Basic template: name/date plate interior and QR panel.
BASIC_PLATE = (0.26, 0.929, 0.75, 0.959)
BASIC_QR_CENTER = (0.889, 0.881)
BASIC_QR_SIZE = 0.145


def _validate_url(download_url: str) -> None:
    url = urlparse(download_url)
    if url.scheme != 'https' or url.netloc != 'nxbooth.gennexbyte.com' or url.query or url.fragment \
            or not re.fullmatch(r'/r/[A-Za-z0-9_-]{32,256}', url.path) or len(download_url) > 200:
        raise ValueError('QR harus memakai tautan foto NXBooth yang sebenarnya.')


def _qr(download_url: str, box: int) -> Image.Image:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4, box_size=1)
    qr.add_data(download_url); qr.make(fit=True)
    code = qr.make_image(fill_color='black', back_color='white').convert('RGB')
    scale = box // code.width  # whole-pixel modules only
    if scale < 3:
        raise ValueError('QR terlalu padat untuk ukuran cetak ini.')
    return code.resize((code.width * scale, code.height * scale), Image.Resampling.NEAREST)


def _font(path: Path, size: int, variation: str | None = None) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(path), size)
    if variation and hasattr(font, 'set_variation_by_name'):
        font.set_variation_by_name(variation)
    return font


def _fit_line(draw: ImageDraw.ImageDraw, text: str, path: Path, width: int, height: int, start: int, floor: int,
              variation: str | None = None):
    for size in range(start, floor - 1, -2):
        font = _font(path, size, variation)
        box = draw.textbbox((0, 0), text, font=font)
        if box[2] - box[0] <= width and box[3] - box[1] <= height:
            return font, box
    raise ValueError('Nama event terlalu panjang untuk footer ini. Gunakan nama yang lebih singkat.')


def _centered(draw, text, font, box, cx, cy, fill):
    draw.text((cx - (box[0] + box[2]) / 2, cy - (box[1] + box[3]) / 2), text, font=font, fill=fill)


def _median_color(image: Image.Image, rect: tuple[int, int, int, int]) -> tuple[int, int, int]:
    return tuple(int(value) for value in ImageStat.Stat(image.crop(rect).convert('RGB')).median)


def _basic_name(draw, name: str, path: Path, width: int, height: int, start: int):
    # Prefer whole words; split an overlong word only when necessary. A bold,
    # upright face and up to three lines use the small plate more efficiently
    # than shrinking a script font into a short name/date stack.
    for size in range(start, 7, -1):
        font = _font(path, size, 'Bold')
        lines, line = [], ''
        for word in name.split(' '):
            candidate = f'{line} {word}' if line else word
            if draw.textlength(candidate, font=font) <= width:
                line = candidate
                continue
            if line:
                lines.append(line)
                line = ''
            for char in word:
                if line and draw.textlength(line + char, font=font) > width:
                    lines.append(line)
                    line = ''
                line += char
        if line:
            lines.append(line)
        if len(lines) > 3:
            continue
        text = '\n'.join(lines)
        box = draw.multiline_textbbox((0, 0), text, font=font, spacing=1, align='center', stroke_width=1)
        if box[2] - box[0] <= width and box[3] - box[1] <= height:
            return text, font, box
    raise ValueError('Nama event terlalu panjang untuk footer ini. Gunakan nama yang lebih singkat.')


def _accent(image: Image.Image, plate: tuple[int, int, int, int]) -> str:
    """Theme color for the plate text: the brightest saturated trim of the frame around the plate."""
    x0, y0, x1, y1 = plate
    pad = 16
    ring = image.crop((max(0, x0 - pad), max(0, y0 - pad), min(image.width, x1 + pad), min(image.height, y1 + pad))).convert('RGB')
    inner = (pad, pad, pad + x1 - x0, pad + y1 - y0)
    hsv = ring.convert('HSV')
    picks = [rgb for rgb, (_, s, v), xy in ((ring.getpixel((x, y)), hsv.getpixel((x, y)), (x, y))
             for y in range(ring.height) for x in range(ring.width))
             if v > 170 and s > 90 and not (inner[0] <= xy[0] < inner[2] and inner[1] <= xy[1] < inner[3])]
    if len(picks) < 40:
        return BASIC_TEXT
    r, g, b = (sum(c[i] for c in picks) // len(picks) for i in range(3))
    # Lighten toward white so the text stays readable on the dark plate while keeping the hue.
    return '#%02x%02x%02x' % tuple(min(255, round(c + (255 - c) * 0.35)) for c in (r, g, b))


def _qr_panel(image: Image.Image, code: Image.Image) -> Image.Image:
    width, height = image.size
    size = round(BASIC_QR_SIZE * width)
    cx, cyq = round(BASIC_QR_CENTER[0] * width), round(BASIC_QR_CENTER[1] * height)
    ring = ImageDraw.Draw(image)
    ring.rounded_rectangle((cx - size // 2 - 5, cyq - size // 2 - 5, cx + size // 2 + 5, cyq + size // 2 + 5),
                           radius=10, fill='#c9a85c')
    ring.rectangle((cx - size // 2, cyq - size // 2, cx + size // 2, cyq + size // 2), fill='white')
    image.paste(code, (cx - code.width // 2, cyq - code.height // 2))
    return image


def _basic(image: Image.Image, fonts: Path, name: str | None, date: str, code: Image.Image, qr_only: bool = False) -> Image.Image:
    width, height = image.size
    if qr_only:  # the image model lettered the name/date plate; only the QR is drawn here
        return _qr_panel(image, code)
    x0, y0, x1, y1 = (round(f * s) for f, s in zip(BASIC_PLATE, (width, height, width, height)))
    # Clear only the safe interior of the blank v2 plate, preserving its border.
    fill = _median_color(image, (x0, y0, x1, y1))
    patch = Image.new('RGB', (x1 - x0, y1 - y0), fill)
    mask = Image.new('L', patch.size, 0)
    ImageDraw.Draw(mask).rectangle((4, 4, patch.width - 5, patch.height - 5), fill=255)
    image.paste(patch, (x0, y0), mask.filter(ImageFilter.GaussianBlur(3)))
    accent = _accent(image, (x0, y0, x1, y1))
    draw = ImageDraw.Draw(image)
    cormorant = fonts / 'fonts/CormorantGaramond.ttf'
    cy, line_h = (y0 + y1) / 2, y1 - y0 - 6
    if name:
        gap = round(width * 0.018)
        date_w = round((x1 - x0) * 0.40)
        name_right = x1 - date_w - gap
        text, font, box = _basic_name(draw, name, cormorant,
                                     name_right - x0 - 12, line_h - 2, round(width * 0.043))
        draw.multiline_text(((x0 + 6 + name_right - box[0] - box[2]) / 2,
                             cy - (box[1] + box[3]) / 2),
                            text, font=font, fill=accent, spacing=1, align='center',
                            stroke_width=1, stroke_fill=accent)
        font, box = _fit_line(draw, date, cormorant, date_w - 12, line_h - 2,
                              round(width * 0.035), 10, 'Bold')
        draw.text((x1 - date_w / 2 - (box[0] + box[2]) / 2,
                   cy - (box[1] + box[3]) / 2),
                  date, font=font, fill=accent, stroke_width=1, stroke_fill=accent)
    else:
        font, box = _fit_line(draw, date, cormorant, x1 - x0 - 24, line_h - 2, round(width * 0.048), 14, 'Bold')
        draw.text(((x0 + x1 - box[0] - box[2]) / 2, cy - (box[1] + box[3]) / 2),
                  date, font=font, fill=accent, stroke_width=1, stroke_fill=accent)
    return _qr_panel(image, code)


def _advanced(image: Image.Image, fonts: Path, name: str | None, date: str, download_url: str, qr_only: bool = False) -> Image.Image:
    width, height = image.size
    margin = round(width * 0.055)
    plate_h = round(height * 0.105)
    top = height - round(height * 0.052) - plate_h
    if qr_only:  # the image model lettered the event line in its frame footer; only the QR is drawn here
        pad = round(plate_h * 0.1)
        code = _qr(download_url, plate_h - 2 * pad)
        qx, qy = width - margin - pad - code.width, top + (plate_h - code.height) // 2
        ring = ImageDraw.Draw(image)
        ring.rounded_rectangle((qx - pad, qy - pad, qx + code.width + pad, qy + code.height + pad), radius=pad, fill='#c9a85c')
        ring.rounded_rectangle((qx - pad + 5, qy - pad + 5, qx + code.width + pad - 5, qy + code.height + pad - 5), radius=pad - 4, fill='white')
        image.paste(code, (qx, qy))
        return image
    layer = Image.new('RGBA', image.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle((margin, top, width - margin, top + plate_h), radius=round(plate_h * 0.12), fill=(8, 12, 24, 190))
    image = Image.alpha_composite(image.convert('RGBA'), layer).convert('RGB')
    pad = round(plate_h * 0.1)
    code = _qr(download_url, plate_h - 2 * pad)
    qx, qy = width - margin - pad - code.width, top + (plate_h - code.height) // 2
    image.paste(code, (qx, qy))
    draw = ImageDraw.Draw(image)
    text_w, cx = qx - margin - 3 * pad, margin + pad * 2
    cormorant = fonts / 'fonts/CormorantGaramond.ttf'
    if name:
        font, box = _fit_line(draw, name, fonts / 'fonts/GreatVibes-Regular.ttf', text_w, round(plate_h * 0.5), round(plate_h * 0.46), 28)
        draw.text((cx - box[0], top + plate_h * 0.14 - box[1]), name, font=font, fill=TEXT)
        font, box = _fit_line(draw, date, cormorant, text_w, round(plate_h * 0.24), round(plate_h * 0.21), 18, 'SemiBold')
        draw.text((cx - box[0], top + plate_h * 0.72 - box[1]), date, font=font, fill='#fff6dc')
    else:
        font, box = _fit_line(draw, date, cormorant, text_w, round(plate_h * 0.3), round(plate_h * 0.26), 18, 'SemiBold')
        draw.text((cx - box[0], top + plate_h / 2 - (box[1] + box[3]) / 2), date, font=font, fill='#fff6dc')
    return image


def render_result_footer(data: bytes, kind: str, event_name: str | None, captured_at: datetime, download_url: str,
                         asset_dir: Path = Path('/engine/event-template'), qr_only: bool = False) -> bytes:
    if kind not in ('basic', 'advanced'):
        raise ValueError('Jenis footer tidak dikenal.')
    _validate_url(download_url)
    name = normalize_event_name(event_name) if event_name else None
    date = capture_date(captured_at)
    with Image.open(io.BytesIO(data)) as source:
        if source.width * source.height > 25_000_000:
            raise ValueError('Image exceeds pixel limit')
        source.load()
        image = source.convert('RGB')
    size = image.size
    if kind == 'basic':
        image = _basic(image, asset_dir, name, date, _qr(download_url, round(BASIC_QR_SIZE * image.width)), qr_only)
    else:
        image = _advanced(image, asset_dir, name, date, download_url, qr_only)
    if image.size != size:
        raise ValueError('Footer must not change the image size.')
    output = io.BytesIO()
    image.save(output, 'PNG')
    return output.getvalue()
