"""Decode, validate, and normalize customer image uploads.

Mobile browsers can supply HEIC/HEIF files, empty MIME types, and images whose
EXIF orientation has not been applied to the pixel data. This module trusts
decoded image bytes rather than the multipart MIME header or filename and
produces JPEG/sRGB bytes for the upload and generation pipelines.
"""

from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

from app.core.config import get_settings


SUPPORTED_PIL_FORMATS = {"JPEG", "PNG", "WEBP"}
HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1", b"heim", b"heis", b"hevm", b"hevs"}


class ImageValidationError(Exception):
    """Raised when an upload cannot be decoded, normalized, or accepted."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "VALIDATION_FAILED",
        detail: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.detail = detail


@dataclass(frozen=True)
class DecodedImage:
    image: Image.Image
    detected_format: str
    icc_profile: bytes | None = None
    nclx_profile: dict | None = None


@dataclass(frozen=True)
class ValidatedImage:
    width: int
    height: int
    format: str
    sha256: str
    size_bytes: int


@dataclass(frozen=True)
class CanonicalImage:
    data: bytes
    width: int
    height: int
    source_format: str
    sha256: str
    size_bytes: int


def _looks_like_heif(data: bytes) -> bool:
    if len(data) < 12 or data[4:8] != b"ftyp":
        return False
    brands = [data[8:12]]
    # The compatible brands follow the major brand and minor version.
    brands.extend(data[offset : offset + 4] for offset in range(16, min(len(data), 64), 4))
    return any(brand in HEIF_BRANDS for brand in brands)


def _decode_heif(data: bytes, *, enforce_minimum: bool = True) -> DecodedImage:
    try:
        import pillow_heif
    except ImportError as exc:
        raise ImageValidationError(
            "HEIC/HEIF photos are not supported by this server image.",
            code="UNSUPPORTED_IMAGE_FORMAT",
        ) from exc

    try:
        heif = pillow_heif.open_heif(data, convert_hdr_to_8bit=True)
        # Reject excessive dimensions before asking libheif to allocate pixels.
        _check_dimensions(*heif.size, enforce_minimum=enforce_minimum)
        frame = heif[heif.primary_index]
        image = frame.to_pillow()
        transformations = getattr(frame._c_image, "transformations", ())
        # libheif applies HEIF irot/imir/clap properties while decoding. HEIF
        # EXIF orientation is informational, so apply it only when no geometric
        # HEIF transform already controls displayed orientation.
        orientation = image.info.get("original_orientation")
        has_heif_orientation = any(
            isinstance(item, tuple) and item and item[0] in {"irot", "imir"}
            for item in transformations
        )
        if not has_heif_orientation and orientation in range(2, 9):
            transpose = {
                2: Image.Transpose.FLIP_LEFT_RIGHT,
                3: Image.Transpose.ROTATE_180,
                4: Image.Transpose.FLIP_TOP_BOTTOM,
                5: Image.Transpose.TRANSPOSE,
                6: Image.Transpose.ROTATE_270,
                7: Image.Transpose.TRANSVERSE,
                8: Image.Transpose.ROTATE_90,
            }[orientation]
            image = image.transpose(transpose)
        _check_dimensions(*image.size, enforce_minimum=enforce_minimum)
        icc_profile = image.info.get("icc_profile")
        nclx_profile = image.info.get("nclx_profile")
        return DecodedImage(
            image=image,
            detected_format="HEIF",
            icc_profile=icc_profile,
            nclx_profile=nclx_profile,
        )
    except ImageValidationError:
        raise
    except Exception as exc:  # noqa: BLE001 - normalizes decoder-specific failures
        raise ImageValidationError(
            "The HEIC/HEIF photo could not be decoded. Please choose another photo.",
            code="IMAGE_DECODE_FAILED",
        ) from exc


def decode_image_bytes(
    data: bytes,
    *,
    content_type: str | None = None,
    enforce_minimum: bool = True,
) -> DecodedImage:
    """Decode a supported image using its content, not browser MIME metadata."""
    settings = get_settings()
    if not data:
        raise ImageValidationError(
            "Uploaded file is empty.", code="IMAGE_DECODE_FAILED"
        )
    if len(data) > settings.upload_max_bytes:
        raise ImageValidationError(
            f"File is too large: {len(data)} bytes exceeds the "
            f"{settings.upload_max_bytes} byte limit."
        )

    if _looks_like_heif(data):
        return _decode_heif(data, enforce_minimum=enforce_minimum)

    try:
        with Image.open(io.BytesIO(data)) as opened:
            detected_format = (opened.format or "UNKNOWN").upper()
            if detected_format not in SUPPORTED_PIL_FORMATS:
                raise ImageValidationError(
                    f"Unsupported image format '{detected_format}'. Please upload a JPEG, PNG, WEBP or HEIC photo.",
                    code="UNSUPPORTED_IMAGE_FORMAT",
                )
            # Image headers provide dimensions before full decode. Check them
            # first to bound allocations from untrusted uploads.
            _check_dimensions(*opened.size, enforce_minimum=enforce_minimum)
            opened.load()
            oriented = ImageOps.exif_transpose(opened)
            image = oriented.copy()
            icc_profile = image.info.get("icc_profile")
    except ImageValidationError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        if _looks_like_heif(data):
            return _decode_heif(data, enforce_minimum=enforce_minimum)
        raise ImageValidationError(
            "The photo could not be decoded. Please choose a valid JPEG, PNG, WEBP or HEIC photo.",
            code="IMAGE_DECODE_FAILED",
        ) from exc

    return DecodedImage(
        image=image,
        detected_format=detected_format,
        icc_profile=icc_profile if isinstance(icc_profile, bytes) else None,
    )


def _to_srgb_rgb(decoded: DecodedImage) -> Image.Image:
    image = ImageOps.exif_transpose(decoded.image)
    if image.mode in {"RGBA", "LA", "P"} or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        rgb = Image.alpha_composite(background, rgba).convert("RGB")
    else:
        rgb = image.convert("RGB")

    profile_bytes = decoded.icc_profile or image.info.get("icc_profile")
    if profile_bytes:
        try:
            source_profile = ImageCms.ImageCmsProfile(io.BytesIO(profile_bytes))
            srgb_profile = ImageCms.createProfile("sRGB")
            rgb = ImageCms.profileToProfile(
                rgb,
                source_profile,
                srgb_profile,
                outputMode="RGB",
                renderingIntent=ImageCms.Intent.PERCEPTUAL,
            )
        except (ImageCms.PyCMSError, OSError, ValueError) as exc:
            raise ImageValidationError(
                "The photo color profile could not be normalized.",
                code="IMAGE_NORMALIZATION_FAILED",
            ) from exc
    elif decoded.nclx_profile:
        rgb = _convert_nclx_to_srgb(rgb, decoded.nclx_profile)
    return rgb


def _convert_nclx_to_srgb(image: Image.Image, profile: dict) -> Image.Image:
    """Convert common SDR HEIF NCLX primaries/transfers to sRGB pixels."""
    if not isinstance(profile, dict):
        raise ImageValidationError(
            "The photo color profile could not be normalized.",
            code="IMAGE_NORMALIZATION_FAILED",
        )
    try:
        primaries = int(profile["color_primaries"])
        transfer = int(profile["transfer_characteristics"])
        import numpy as np

        values = np.asarray(image, dtype=np.float32) / 255.0
        if transfer == 13:  # IEC 61966-2-1 / sRGB
            linear = np.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4)
        elif transfer in {1, 6, 14, 15}:  # BT.709 / BT.601 / BT.2020 SDR
            linear = np.where(values < 0.081, values / 4.5, ((values + 0.099) / 1.099) ** (1.0 / 0.45))
        elif transfer == 8:  # linear light
            linear = values
        else:
            raise ImageValidationError(
                "This HEIC/HEIF color profile cannot be converted to sRGB.",
                code="IMAGE_NORMALIZATION_FAILED",
            )

        if primaries == 1:  # BT.709 / sRGB D65
            to_srgb = np.eye(3, dtype=np.float32)
        elif primaries == 12:  # Display P3 D65
            to_srgb = np.asarray(
                [[1.224745, -0.224904, 0.0], [-0.042058, 1.042081, 0.0], [-0.019642, -0.078655, 1.098537]],
                dtype=np.float32,
            )
        elif primaries == 9:  # BT.2020 D65
            to_srgb = np.asarray(
                [[1.660491, -0.587641, -0.072850], [-0.124550, 1.132900, -0.008349], [-0.018151, -0.100579, 1.118730]],
                dtype=np.float32,
            )
        else:
            raise ImageValidationError(
                "This HEIC/HEIF color profile cannot be converted to sRGB.",
                code="IMAGE_NORMALIZATION_FAILED",
            )

        converted = np.clip(linear @ to_srgb.T, 0.0, 1.0)
        encoded = np.where(
            converted <= 0.0031308,
            converted * 12.92,
            1.055 * np.maximum(converted, 0.0) ** (1.0 / 2.4) - 0.055,
        )
        return Image.fromarray(np.rint(np.clip(encoded, 0.0, 1.0) * 255).astype(np.uint8), "RGB")
    except ImageValidationError:
        raise
    except Exception as exc:  # noqa: BLE001 - normalizes malformed profile failures
        raise ImageValidationError(
            "The photo color profile could not be normalized.",
            code="IMAGE_NORMALIZATION_FAILED",
        ) from exc


def _check_dimensions(width: int, height: int, *, enforce_minimum: bool = True) -> None:
    settings = get_settings()
    if enforce_minimum and min(width, height) < settings.upload_min_dimension:
        raise ImageValidationError(
            f"Image is too small: {width}x{height}. Minimum is "
            f"{settings.upload_min_dimension}px on both sides."
        )
    if max(width, height) > settings.upload_max_dimension:
        raise ImageValidationError(
            f"Image is too large: {width}x{height}. Maximum is "
            f"{settings.upload_max_dimension}px on the longest side."
        )


def validate_decoded_dimensions(decoded: DecodedImage) -> tuple[int, int]:
    """Check dimensions after image orientation has been physically applied."""
    image = ImageOps.exif_transpose(decoded.image)
    width, height = image.size
    _check_dimensions(width, height)
    return width, height


def normalize_decoded_image(decoded: DecodedImage, *, max_side: int | None = None) -> bytes:
    """Apply orientation, convert to RGB/sRGB, and encode a canonical JPEG."""
    try:
        image = _to_srgb_rgb(decoded)
        if max_side is not None:
            width, height = image.size
            longest = max(width, height)
            if longest > max_side:
                scale = max_side / float(longest)
                image = image.resize(
                    (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
                    Image.Resampling.LANCZOS,
                )
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=94, optimize=True, progressive=True)
        return output.getvalue()
    except ImageValidationError:
        raise
    except (OSError, ValueError, RuntimeError) as exc:
        raise ImageValidationError(
            "The photo could not be normalized. Please choose another photo.",
            code="IMAGE_NORMALIZATION_FAILED",
        ) from exc


def validate_canonical_image(data: bytes) -> ValidatedImage:
    """Validate canonical JPEG bytes and return metadata for persistence."""
    settings = get_settings()
    if not data:
        raise ImageValidationError("Uploaded file is empty.", code="IMAGE_DECODE_FAILED")
    if len(data) > settings.upload_max_bytes:
        raise ImageValidationError(
            f"Normalized file is too large: {len(data)} bytes exceeds the "
            f"{settings.upload_max_bytes} byte limit."
        )
    try:
        with Image.open(io.BytesIO(data)) as image:
            if (image.format or "").upper() != "JPEG":
                raise ImageValidationError(
                    "The normalized photo is not a JPEG.", code="IMAGE_NORMALIZATION_FAILED"
                )
            image.load()
            width, height = image.size
    except ImageValidationError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageValidationError(
            "The normalized photo could not be decoded.", code="IMAGE_NORMALIZATION_FAILED"
        ) from exc

    _check_dimensions(width, height)
    return ValidatedImage(
        width=width,
        height=height,
        format="JPEG",
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
    )


def normalize_uploaded_image(data: bytes, *, content_type: str | None = None) -> CanonicalImage:
    """Return a size-checked, physically oriented JPEG/sRGB customer image."""
    decoded = decode_image_bytes(data, content_type=content_type)
    oriented = ImageOps.exif_transpose(decoded.image)
    validate_decoded_dimensions(decoded)
    canonical_bytes = normalize_decoded_image(
        DecodedImage(oriented, decoded.detected_format, decoded.icc_profile)
    )
    validated = validate_canonical_image(canonical_bytes)
    return CanonicalImage(
        data=canonical_bytes,
        width=validated.width,
        height=validated.height,
        source_format=decoded.detected_format,
        sha256=validated.sha256,
        size_bytes=validated.size_bytes,
    )


def validate_image_bytes(data: bytes, *, content_type: str | None = None) -> ValidatedImage:
    """Decode and validate a supported image, ignoring unreliable MIME labels."""
    decoded = decode_image_bytes(data, content_type=content_type)
    oriented = ImageOps.exif_transpose(decoded.image)
    _check_dimensions(*oriented.size)
    return ValidatedImage(
        width=oriented.width,
        height=oriented.height,
        format=decoded.detected_format,
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
    )


def normalize_for_provider(data: bytes, *, max_side: int = 1536) -> tuple[bytes, str]:
    """Return an orientation-correct JPEG/sRGB payload for an AI provider."""
    decoded = decode_image_bytes(data, enforce_minimum=False)
    image = ImageOps.exif_transpose(decoded.image)
    jpeg_bytes = normalize_decoded_image(
        DecodedImage(image, decoded.detected_format, decoded.icc_profile),
        max_side=max_side,
    )
    return jpeg_bytes, "image/jpeg"
