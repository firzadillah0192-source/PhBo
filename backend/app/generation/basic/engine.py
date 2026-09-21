"""Basic Local Face Fitting - DEV EXPERIMENTAL.

This is deterministic local compositing, not generative AI and not a literal
face swap. The template remains the visual authority; only an aligned,
soft-masked facial region is contributed by the validated user photo.
"""

from __future__ import annotations

import io
import uuid
from dataclasses import dataclass
from pathlib import Path

import cv2
from PIL import Image

from app.templates_registry import TemplateDefinition

from .blending import align_face, composite, harmonize_color, soft_face_mask
from .errors import BasicTemplateMetadataMissingError
from .landmarks import detect_exactly_one_face, estimate_landmarks


@dataclass(frozen=True)
class BasicResult:
    image_bytes: bytes
    output_path: str
    width: int
    height: int
    engine_name: str = "basic-local"
    status: str = "EXPERIMENTAL"
    content_type: str = "image/png"


class BasicGenerationEngine:
    name = "Basic Local Face Fitting - DEV EXPERIMENTAL"

    def generate(
        self,
        user_image_path: str | Path,
        template_id: str,
        output_path: str | Path,
        options: dict | None = None,
    ) -> BasicResult:
        options = options or {}
        template: TemplateDefinition = options.get("template")
        if template is None or not template.asset_filename or not template.face_region:
            raise BasicTemplateMetadataMissingError(
                f"BASIC_TEMPLATE_METADATA_MISSING: template '{template_id}' lacks asset or face region"
            )
        template_path = Path(options.get("template_path", ""))
        if not template_path.exists():
            raise BasicTemplateMetadataMissingError(
                f"BASIC_TEMPLATE_METADATA_MISSING: template asset missing for '{template_id}'"
            )

        source = cv2.imread(str(user_image_path), cv2.IMREAD_COLOR)
        target = cv2.imread(str(template_path), cv2.IMREAD_COLOR)
        if source is None or target is None:
            raise BasicTemplateMetadataMissingError("BASIC_TEMPLATE_METADATA_MISSING: image asset unreadable")

        face = detect_exactly_one_face(source)
        source_landmarks = estimate_landmarks(face).as_array()
        x, y, width, height = template.face_region
        target_landmarks = _target_landmarks(x, y, width, height)
        aligned = align_face(source, source_landmarks, target_landmarks, (target.shape[1], target.shape[0]))
        mask = soft_face_mask((target.shape[1], target.shape[0]), template.face_region)
        adjusted = harmonize_color(aligned, target, mask)
        result = composite(target, adjusted, mask)

        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(output), result, [cv2.IMWRITE_PNG_COMPRESSION, 3]):
            raise RuntimeError("could not write Basic Local PNG result")
        image_bytes = output.read_bytes()
        with Image.open(io.BytesIO(image_bytes)) as image:
            image.load()
            width_out, height_out = image.size
        return BasicResult(
            image_bytes=image_bytes,
            output_path=str(output),
            width=width_out,
            height=height_out,
        )


def _target_landmarks(x: float, y: float, width: float, height: float):
    import numpy as np

    return np.array(
        [
            (x + 0.31 * width, y + 0.38 * height),
            (x + 0.69 * width, y + 0.38 * height),
            (x + 0.50 * width, y + 0.56 * height),
            (x + 0.35 * width, y + 0.74 * height),
            (x + 0.65 * width, y + 0.74 * height),
        ],
        dtype=np.float32,
    )


def make_session_output(runtime_tmp: Path, job_id: str) -> Path:
    return runtime_tmp / job_id / f"basic-{uuid.uuid4().hex}.png"


def get_basic_engine() -> BasicGenerationEngine:
    return BasicGenerationEngine()
