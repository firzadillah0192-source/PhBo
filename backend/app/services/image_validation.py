"""Photo validation (step 2 of the product workflow).

Real validation only: decode with Pillow, reject non-images, out-of-range
sizes/dimensions and truncated files. Failures return an explicit reason and
are never downgraded to success.
"""

from __future__ import annotations

import hashlib
import warnings
from dataclasses import dataclass
from pathlib import PurePosixPath

from PIL import Image, UnidentifiedImageError

from app.core.config import get_settings


class ImageValidationError(Exception):
    """Raised when an upload cannot be accepted."""

    def __init__(self, message: str, *, detail: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail


@dataclass(frozen=True)
class ValidatedImage:
    width: int
    height: int
    format: str
    sha256: str
    size_bytes: int


_IMAGE_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
_IMAGE_EXTENSIONS = {"JPEG": {".jpg", ".jpeg"}, "PNG": {".png"}, "WEBP": {".webp"}}


def validate_image_bytes(data: bytes, *, content_type: str | None = None, filename: str | None = None) -> ValidatedImage:
    """Validate raw upload bytes.

    Raises ImageValidationError with a precise, user-actionable message.
    """
    settings = get_settings()

    if not data:
        raise ImageValidationError("Uploaded file is empty.")

    if len(data) > settings.upload_max_bytes:
        raise ImageValidationError(
            f"File is too large: {len(data)} bytes exceeds the "
            f"{settings.upload_max_bytes} byte limit."
        )

    if content_type and content_type not in settings.allowed_upload_content_types:
        raise ImageValidationError(
            f"Unsupported content type '{content_type}'. "
            f"Allowed: {', '.join(settings.allowed_upload_content_types)}."
        )

    sha256 = hashlib.sha256(data).hexdigest()

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(_io(data)) as img:
                width, height = img.size
                fmt = (img.format or "UNKNOWN").upper()
                # Reject hostile headers before verify/load allocates pixel buffers.
                if min(width, height) < settings.upload_min_dimension:
                    raise ImageValidationError(f"Image is too small: {width}x{height}. Minimum is {settings.upload_min_dimension}px on both sides.")
                if max(width, height) > settings.upload_max_dimension:
                    raise ImageValidationError(f"Image is too large: {width}x{height}. Maximum is {settings.upload_max_dimension}px on the longest side.")
                if fmt not in _IMAGE_TYPES:
                    raise ImageValidationError("Only JPEG, PNG or WEBP photos are allowed.")
                if content_type and content_type != _IMAGE_TYPES[fmt]:
                    raise ImageValidationError("Uploaded MIME type does not match the image format.")
                if filename is not None:
                    if len(filename) > 255 or any(char in filename for char in ("/", "\\", ":")) or any(ord(char) < 32 for char in filename):
                        raise ImageValidationError("Photo filename is invalid.")
                    if PurePosixPath(filename).suffix.lower() not in _IMAGE_EXTENSIONS[fmt]:
                        raise ImageValidationError("Photo filename extension does not match the image format.")
                img.verify()
            # verify() invalidates the handle, so reopen for full decode.
            with Image.open(_io(data)) as img:
                img.load()
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ImageValidationError("Image dimensions exceed the safe decoding limit.") from exc
    except UnidentifiedImageError as exc:
        raise ImageValidationError(
            "File could not be decoded as an image. Please upload a valid "
            "JPEG, PNG or WEBP photo."
        ) from exc
    except OSError as exc:
        raise ImageValidationError(
            "Image file appears to be truncated or corrupted."
        ) from exc

    return ValidatedImage(
        width=width,
        height=height,
        format=fmt,
        sha256=sha256,
        size_bytes=len(data),
    )


def _io(data: bytes):
    import io

    return io.BytesIO(data)


def normalize_for_provider(data: bytes, *, max_side: int = 1536) -> tuple[bytes, str]:
    """Prepare the user photo for the provider.

    Re-encodes to JPEG and caps the longest side. Keeps payload small and
    avoids provider-side decode failures on unusual/oversized uploads.
    Returns (jpeg_bytes, content_type).
    """
    import io

    with Image.open(io.BytesIO(data)) as img:
        img.load()
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGB")
        elif img.mode != "RGB":
            img = img.convert("RGB")

        w, h = img.size
        longest = max(w, h)
        if longest > max_side:
            scale = max_side / float(longest)
            img = img.resize(
                (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
                Image.LANCZOS,
            )

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92, optimize=True)
        return buf.getvalue(), "image/jpeg"
