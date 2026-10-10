"""Print sizing without drawing over the generated frame or footer."""
import io
from PIL import Image, ImageFilter, ImageOps


def prepare_advanced_result(data):
    with Image.open(io.BytesIO(data)) as source:
        if source.width * source.height > 25_000_000:
            raise ValueError('Image exceeds pixel limit')
        source.load()
        oriented = ImageOps.exif_transpose(source).convert('RGB')
    size = (2160, 3240)
    canvas = ImageOps.fit(oriented, size, method=Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(60))
    foreground = ImageOps.contain(oriented, size, method=Image.Resampling.LANCZOS)
    canvas.paste(foreground, ((size[0] - foreground.width) // 2, (size[1] - foreground.height) // 2))
    output = io.BytesIO()
    canvas.save(output, format='PNG')
    return output.getvalue()
