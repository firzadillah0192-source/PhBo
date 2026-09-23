"""Template-first deterministic Basic facial morphology transfer."""

from __future__ import annotations

import io
import json
import logging
import math
import uuid
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from app.templates_registry import TemplateDefinition

from .blending import (
    composite,
    estimate_eye_similarity,
    frequency_separated_identity,
    geometry_influence_mask,
    geometry_polygon_for_region,
    harmonize_color,
    harmonize_local_illumination,
    identity_texture_mask,
    multiband_composite,
    piecewise_affine_warp,
    restore_local_face_contrast,
    soft_face_mask,
    transform_points,
    warp_face,
)
from .dense import (
    DenseLandmarks,
    canonicalize,
    denormalize,
    dense_landmarks,
    morph_toward_template,
    normalized_face_width,
    normalized_group_width,
)
from .errors import (
    BasicGeometryError,
    BasicLandmarksUnavailableError,
    BasicTemplateMetadataMissingError,
)
from .landmarks import FaceBox, detect_exactly_one_face, estimate_landmarks
from .profiles import BasicIdentityProfile, get_identity_profile
from .real_landmarks import detect_real_dense_landmarks

logger = logging.getLogger(__name__)
REQUIRED_ANCHORS = ("left_eye", "right_eye", "nose", "mouth", "chin")


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
        identity_profile = get_identity_profile(str(options.get("identity_profile", "production")))
        template: TemplateDefinition = options.get("template")
        if (
            template is None
            or not template.asset_filename
            or not template.face_region
            or not template.face_anchors
            or any(name not in template.face_anchors for name in REQUIRED_ANCHORS)
        ):
            raise BasicTemplateMetadataMissingError(
                f"BASIC_TEMPLATE_METADATA_MISSING: template '{template_id}' lacks asset, face ROI, or anchors"
            )
        template_path = Path(options.get("template_path", ""))
        if not template_path.exists():
            raise BasicTemplateMetadataMissingError(
                f"BASIC_TEMPLATE_METADATA_MISSING: template asset missing for '{template_id}'"
            )

        source = cv2.imread(str(user_image_path), cv2.IMREAD_COLOR)
        target = cv2.imread(str(template_path), cv2.IMREAD_COLOR)
        if source is None or target is None:
            raise BasicTemplateMetadataMissingError(
                "BASIC_TEMPLATE_METADATA_MISSING: image asset unreadable"
            )
        target_height, target_width = target.shape[:2]
        if (template.width, template.height) != (target_width, target_height):
            raise BasicTemplateMetadataMissingError(
                f"BASIC_TEMPLATE_METADATA_MISSING: metadata dimensions {template.width}x{template.height} "
                f"do not match asset {target_width}x{target_height}"
            )
        _validate_template_geometry(template, target_width, target_height)

        source_box = detect_exactly_one_face(source)
        scaffold_landmarks = estimate_landmarks(source_box).named_points()
        scaffold_dense = dense_landmarks(
            (source_box.x, source_box.y, source_box.width, source_box.height),
            scaffold_landmarks,
        )
        landmark_backend = options.get("landmark_backend", "real")
        if landmark_backend == "scaffold":
            source_landmarks = scaffold_landmarks
            source_dense = scaffold_dense
            landmark_metadata = {
                "backend": "bbox_scaffold",
                "model": "opencv-haar-face-box-scaffold",
                "detected_landmark_count": 0,
                "semantic_landmark_count": len(source_dense.points),
                "quality_score": None,
                "inference_ms": 0.0,
                "degraded_mode": True,
            }
        elif landmark_backend == "real":
            source_dense, source_landmarks, landmark_metadata = detect_real_dense_landmarks(
                source, source_box, identity_profile.mesh_profile
            )
            landmark_metadata = {
                **landmark_metadata,
                "semantic_landmark_count": len(source_dense.points),
                "degraded_mode": False,
            }
        else:
            raise BasicLandmarksUnavailableError(
                f"BASIC_LANDMARK_FAILED: unsupported landmark backend '{landmark_backend}'"
            )

        geometry_polygon = geometry_polygon_for_region(template.face_region)
        if identity_profile.use_template_landmarks:
            detected_template_dense, _, template_landmark_metadata = detect_real_dense_landmarks(
                target,
                FaceBox(*template.face_region),
                identity_profile.mesh_profile,
            )
            template_dense = _align_template_dense(
                detected_template_dense,
                template.face_anchors,
                geometry_polygon,
                semantic_boundary_alignment=identity_profile.semantic_boundary_alignment,
            )
            template_landmark_metadata = {
                **template_landmark_metadata,
                "semantic_landmark_count": len(template_dense.points),
                "aligned_to_curated_eye_anchors": True,
                "fixed_boundary_count": sum(
                    group in {"inner_boundary", "hard_template_boundary"}
                    for group in template_dense.groups.values()
                ),
            }
        else:
            template_dense = dense_landmarks(
                template.face_region,
                template.face_anchors,
                tuple(tuple(float(value) for value in point) for point in geometry_polygon),
            )
            template_landmark_metadata = {
                "backend": "curated_template_scaffold",
                "mesh_profile": "semantic_72",
                "semantic_landmark_count": len(template_dense.points),
                "aligned_to_curated_eye_anchors": True,
                "fixed_boundary_count": sum(
                    group == "inner_boundary" for group in template_dense.groups.values()
                ),
            }
        target_points, source_normalized, template_normalized, target_normalized = morph_toward_template(
            source_dense,
            template_dense,
            identity_profile.morphology_strength,
            identity_profile.contour_movement_limits,
        )
        morphed_dense = DenseLandmarks(target_points, template_dense.groups)
        if identity_profile.enable_soft_contour_mask:
            contour_names = sorted(
                (name for name in target_points if name.startswith("inner_boundary_")),
                key=lambda name: int(name.rsplit("_", 1)[-1]),
            )
            geometry_polygon = np.asarray(
                [target_points[name] for name in contour_names],
                dtype=np.float32,
            )
        measurement_template_dense = template_dense
        measurement_morphed_dense = morphed_dense
        if identity_profile.use_template_landmarks and not identity_profile.semantic_boundary_alignment:
            measurement_template_dense = _align_template_dense(
                detected_template_dense,
                template.face_anchors,
                geometry_polygon,
                semantic_boundary_alignment=True,
            )
            measurement_points = dict(morphed_dense.points)
            for name in measurement_points:
                if name.startswith("inner_boundary_"):
                    measurement_points[name] = measurement_template_dense.points[name]
            measurement_morphed_dense = DenseLandmarks(
                measurement_points,
                measurement_template_dense.groups,
            )

        registration_source = np.asarray(
            [source_landmarks[name] for name in ("left_eye", "right_eye", "nose", "mouth")],
            dtype=np.float32,
        )
        registration_target = np.asarray(
            [template.face_anchors[name] for name in ("left_eye", "right_eye", "nose", "mouth")],
            dtype=np.float32,
        )
        registration = estimate_eye_similarity(registration_source, registration_target)
        registered_points = transform_points(registration_source, registration.matrix)
        registration_residuals = {
            name: float(np.linalg.norm(point - target))
            for name, point, target in zip(
                ("left_eye", "right_eye", "nose", "mouth"),
                registered_points,
                registration_target,
                strict=True,
            )
        }
        _validate_registration(
            registration.scale,
            registration.rotation_degrees,
            registration_residuals,
            float(np.linalg.norm(registration_target[1] - registration_target[0])),
        )

        labels = list(template_dense.points)
        template_control = np.asarray([template_dense.points[name] for name in labels], dtype=np.float32)
        target_control = np.asarray([target_points[name] for name in labels], dtype=np.float32)
        morphed_template, triangles = piecewise_affine_warp(
            target, template_control, target_control, (target_width, target_height)
        )

        geometry_mask = geometry_influence_mask(
            (target_width, target_height),
            template.face_region,
            target_points,
            geometry_polygon,
            template_dense.groups,
            identity_profile.enable_soft_contour_mask,
        )
        geometry_base = composite(target, morphed_template, geometry_mask)

        aligned_user = warp_face(
            source, registration.matrix, (target_width, target_height)
        )
        warped_user = aligned_user
        if identity_profile.warp_user_texture:
            registered_source_control = transform_points(
                np.asarray([source_dense.points[name] for name in labels], dtype=np.float32),
                registration.matrix,
            )
            warped_user, _ = piecewise_affine_warp(
                aligned_user,
                registered_source_control,
                target_control,
                (target_width, target_height),
            )
        texture_mask = identity_texture_mask(
            (target_width, target_height),
            target_points,
            template_dense.groups,
            template.face_region,
            identity_profile.identity_texture_strength,
            (
                tuple(tuple(float(component) for component in point) for point in geometry_polygon)
                if identity_profile.warp_user_texture
                else template.mask_polygon
            ),
            inward_only=identity_profile.warp_user_texture,
        )
        photometric_debug_images = {}
        pre_contrast_result = None
        if identity_profile.texture_pipeline == "multiband_local_illumination":
            adjusted_user = harmonize_local_illumination(warped_user, geometry_base, texture_mask)
            if options.get("capture_photometric_debug"):
                result, pyramid_trace = multiband_composite(
                    geometry_base, adjusted_user, texture_mask, return_trace=True
                )
                photometric_debug_images = {
                    "17_geometry_base.png": geometry_base,
                    "18_f_multiband_pyramid_layers.png": _pyramid_trace_preview(pyramid_trace),
                }
            else:
                result = multiband_composite(geometry_base, adjusted_user, texture_mask)
        elif identity_profile.texture_pipeline == "frequency_authority":
            adjusted_user, frequency_layers = frequency_separated_identity(
                geometry_base,
                warped_user,
                texture_mask,
            )
            pre_contrast_result = composite(geometry_base, adjusted_user, texture_mask)
            result = restore_local_face_contrast(
                pre_contrast_result,
                texture_mask,
                strength=identity_profile.local_contrast_strength,
            ) if identity_profile.local_contrast_strength > 0.0 else pre_contrast_result
            photometric_debug_images = {
                "01_template_low_frequency.png": frequency_layers["template_low_frequency"],
                "02_user_warped.png": warped_user,
                "03_user_low_frequency.png": frequency_layers["identity_low_frequency"],
                "04_user_mid_frequency.png": frequency_layers["identity_mid_frequency"],
                "05_user_high_frequency.png": frequency_layers["identity_high_frequency"],
                "06_frequency_composite.png": frequency_layers["frequency_composite"],
                "07_mask.png": np.rint(np.clip(texture_mask, 0.0, 1.0) * 255).astype(np.uint8),
                "08_pre_contrast.png": pre_contrast_result,
                "09_post_contrast.png": result,
                "10_final.png": result,
                "11_geometry_base.png": geometry_base,
            }
        else:
            adjusted_user = harmonize_color(warped_user, geometry_base, texture_mask)
            result = composite(geometry_base, adjusted_user, texture_mask)

        final_dense = None
        final_landmark_metadata = None
        if options.get("measure_final_geometry"):
            final_dense, _, final_landmark_metadata = detect_real_dense_landmarks(
                result,
                FaceBox(*template.face_region),
                "semantic_166_soft",
            )

        geometry_bbox, geometry_area = _mask_geometry(geometry_mask)
        texture_bbox, texture_area = _mask_geometry(texture_mask)
        diagnostics = _diagnostics(
            source,
            target,
            source_box,
            source_landmarks,
            template,
            source_dense,
            scaffold_dense,
            template_dense,
            landmark_metadata,
            template_landmark_metadata,
            identity_profile,
            morphed_dense,
            source_normalized,
            template_normalized,
            target_normalized,
            registration,
            registration_residuals,
            geometry_bbox,
            geometry_area,
            texture_bbox,
            texture_area,
            len(triangles),
            measurement_template_dense,
            measurement_morphed_dense,
            final_dense,
            final_landmark_metadata,
        )
        logger.info("basic_face_morphology=%s", json.dumps(diagnostics, sort_keys=True))

        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        debug_dir = Path(options.get("debug_dir", output.parent / "basic-debug"))
        _write_debug_images(
            debug_dir,
            source,
            target,
            source_box,
            source_dense,
            scaffold_dense,
            template_dense,
            morphed_dense,
            landmark_metadata,
            geometry_polygon,
            triangles,
            target,
            morphed_template,
            warped_user,
            adjusted_user,
            texture_mask,
            geometry_base,
            result,
            diagnostics,
            final_dense,
            registration.matrix,
            photometric_debug_images,
        )
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


def _resample_closed_polygon(points: np.ndarray, count: int) -> np.ndarray:
    values = np.asarray(points, dtype=np.float32)
    closed = np.concatenate([values, values[:1]], axis=0)
    lengths = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    cumulative = np.concatenate([[0.0], np.cumsum(lengths)])
    samples = np.linspace(0.0, float(cumulative[-1]), count, endpoint=False)
    output = []
    for sample in samples:
        segment = max(0, min(len(lengths) - 1, int(np.searchsorted(cumulative, sample, side="right") - 1)))
        fraction = (sample - cumulative[segment]) / max(float(lengths[segment]), 1e-6)
        output.append(closed[segment] + (closed[segment + 1] - closed[segment]) * fraction)
    return np.asarray(output, dtype=np.float32)


def _align_template_dense(
    detected: DenseLandmarks,
    anchors: dict[str, tuple[float, float]],
    fixed_boundary: np.ndarray,
    semantic_boundary_alignment: bool = False,
) -> DenseLandmarks:
    """Align detected template features while pinning the inner head boundary."""
    detected_eyes = np.asarray(
        [detected.points["left_eye_center"], detected.points["right_eye_center"]],
        dtype=np.float32,
    )
    curated_eyes = np.asarray([anchors["left_eye"], anchors["right_eye"]], dtype=np.float32)
    alignment = estimate_eye_similarity(detected_eyes, curated_eyes)
    names = list(detected.points)
    transformed = transform_points(
        np.asarray([detected.points[name] for name in names], dtype=np.float32),
        alignment.matrix,
    )
    points = {name: point for name, point in zip(names, transformed, strict=True)}
    boundary_names = [name for name in names if name.startswith("inner_boundary_")]
    boundary_values = _resample_closed_polygon(fixed_boundary, len(boundary_names))
    if semantic_boundary_alignment and len(boundary_values):
        center_x = float(np.mean(curated_eyes[:, 0]))
        top = int(np.argmin(boundary_values[:, 1] + np.abs(boundary_values[:, 0] - center_x) * 0.05))
        boundary_values = np.roll(boundary_values, -top, axis=0)
        if len(boundary_values) > 1 and boundary_values[1, 0] < boundary_values[-1, 0]:
            boundary_values = np.concatenate([boundary_values[:1], boundary_values[:0:-1]], axis=0)
    for name, point in zip(boundary_names, boundary_values, strict=True):
        points[name] = point
    return DenseLandmarks(points, dict(detected.groups))


def _validate_template_geometry(template: TemplateDefinition, width: int, height: int) -> None:
    x, y, roi_width, roi_height = template.face_region
    if min(x, y, roi_width, roi_height) < 0 or roi_width <= 0 or roi_height <= 0:
        raise BasicTemplateMetadataMissingError("BASIC_TEMPLATE_METADATA_MISSING: invalid face ROI")
    if x + roi_width > width or y + roi_height > height:
        raise BasicTemplateMetadataMissingError("BASIC_TEMPLATE_METADATA_MISSING: face ROI exceeds template")
    for name, (point_x, point_y) in template.face_anchors.items():
        if not (0 <= point_x < width and 0 <= point_y < height):
            raise BasicTemplateMetadataMissingError(
                f"BASIC_TEMPLATE_METADATA_MISSING: pixel anchor '{name}' exceeds template"
            )


def _validate_registration(
    scale: float,
    rotation: float,
    residuals: dict[str, float],
    template_eye_distance: float,
) -> None:
    if not 0.08 <= scale <= 4.0:
        raise BasicGeometryError(
            f"BASIC_GEOMETRY_INVALID: implausible registration scale {scale:.4f}"
        )
    if abs(rotation) > 25.0:
        raise BasicGeometryError(
            f"BASIC_GEOMETRY_INVALID: excessive registration rotation {rotation:.2f}"
        )
    eye_residual = max(residuals["left_eye"], residuals["right_eye"])
    eye_distance = max(1.0, template_eye_distance)
    if eye_residual > max(2.5, eye_distance * 0.03):
        raise BasicGeometryError(
            f"BASIC_GEOMETRY_INVALID: eye registration residual {eye_residual:.2f}px"
        )


def _mask_geometry(mask: np.ndarray) -> tuple[tuple[int, int, int, int], int]:
    ys, xs = np.where(mask > 0.01)
    if len(xs) == 0:
        raise BasicGeometryError("BASIC_GEOMETRY_INVALID: mask is empty")
    return (
        (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1),
        int((mask > 0.05).sum()),
    )


def _point(value) -> list[float]:
    return [round(float(value[0]), 3), round(float(value[1]), 3)]


def _points_json(points: dict[str, np.ndarray]) -> dict[str, list[float]]:
    return {name: _point(point) for name, point in points.items()}


def _normalized_json(points: dict[str, np.ndarray]) -> dict[str, list[float]]:
    return _points_json(points)


def _pixel_group_width(dense: DenseLandmarks, group: str) -> float:
    values = np.asarray(
        [
            point for name, point in dense.points.items()
            if dense.groups.get(name) == group
            or (group == "inner_boundary" and name.startswith("inner_boundary_"))
        ],
        dtype=np.float32,
    )
    if values.size == 0:
        return 0.0
    return float(values[:, 0].max() - values[:, 0].min())


def _canonical_named_width_px(
    dense: DenseLandmarks,
    names: tuple[str, ...],
    template_eye_distance: float,
) -> float:
    normalized = canonicalize(dense)
    values = [float(normalized[name][0]) for name in names if name in normalized]
    if len(values) < 2:
        return 0.0
    return (max(values) - min(values)) * template_eye_distance


def _shared_geometry_measurements(
    source: DenseLandmarks,
    template: DenseLandmarks,
    target: DenseLandmarks,
    final: DenseLandmarks | None,
    template_eye_distance: float,
    source_box: FaceBox,
    template_region: tuple[int, int, int, int],
) -> dict:
    boundary = tuple(f"inner_boundary_{index:02d}" for index in range(19))
    definitions = {
        "FACE": boundary,
        "CHEEK": tuple(
            name for name, group in template.groups.items() if group == "cheeks"
        ) + tuple(boundary[index] for index in (4, 5, 6, 13, 14, 15)),
        "JAW": tuple(
            name for name, group in template.groups.items() if group == "jaw"
        ) + tuple(boundary[index] for index in (7, 8, 11, 12)),
        "CHIN": (boundary[8], boundary[9], boundary[10], boundary[11]),
    }
    measurements = {}
    for region, names in definitions.items():
        measurements[region] = {
            "template": round(_canonical_named_width_px(template, names, template_eye_distance), 3),
            "normalized_user": round(_canonical_named_width_px(source, names, template_eye_distance), 3),
            "target": round(_canonical_named_width_px(target, names, template_eye_distance), 3),
            "final_measured_output": (
                round(_canonical_named_width_px(final, names, template_eye_distance), 3)
                if final is not None else None
            ),
        }
    template_head_width = float(template_region[2])
    normalized_user_head_width = source_box.width / max(
        math.dist(source.points["left_eye_center"], source.points["right_eye_center"]),
        1.0,
    ) * template_eye_distance
    measurements["HEAD"] = {
        "template": round(template_head_width, 3),
        "normalized_user": round(normalized_user_head_width, 3),
        "target": round(template_head_width, 3),
        "final_measured_output": round(template_head_width, 3),
    }
    return {
        "coordinate_system": "canonical inter-eye normalized; contour widths reported in template pixels",
        "definitions": {
            "HEAD": "template face ROI width; user Haar face-box width normalized by inter-eye distance; target/final fixed to template ROI",
            **{region: list(names) for region, names in definitions.items()},
        },
        "widths_px": measurements,
    }


def _bbox_json(points: dict[str, np.ndarray]) -> dict[str, float]:
    values = np.asarray(list(points.values()), dtype=np.float32)
    x1, y1 = values.min(axis=0)
    x2, y2 = values.max(axis=0)
    return {
        "x1": round(float(x1), 3),
        "y1": round(float(y1), 3),
        "x2": round(float(x2), 3),
        "y2": round(float(y2), 3),
        "width": round(float(x2 - x1), 3),
        "height": round(float(y2 - y1), 3),
    }


def _diagnostics(
    source,
    target,
    source_box,
    source_landmarks,
    template,
    source_dense,
    scaffold_dense,
    template_dense,
    landmark_metadata,
    template_landmark_metadata,
    identity_profile: BasicIdentityProfile,
    morphed_dense,
    source_normalized,
    template_normalized,
    target_normalized,
    registration,
    registration_residuals,
    geometry_bbox,
    geometry_area,
    texture_bbox,
    texture_area,
    triangle_count,
    measurement_template_dense,
    measurement_morphed_dense,
    final_dense,
    final_landmark_metadata,
):
    source_eye = math.dist(source_landmarks["left_eye"], source_landmarks["right_eye"])
    template_eye = math.dist(
        template.face_anchors["left_eye"], template.face_anchors["right_eye"]
    )
    source_face_width = source_box.width / max(source_eye, 1.0)
    template_face_width = template.face_region[2] / max(template_eye, 1.0)
    morphed_face_width = normalized_face_width(morphed_dense)
    template_normalized_width = normalized_face_width(template_dense)
    normalized_user_chin = denormalize({"chin": source_normalized["chin"]}, template_dense)["chin"]
    shared_geometry = _shared_geometry_measurements(
        source_dense,
        measurement_template_dense,
        measurement_morphed_dense,
        final_dense,
        template_eye,
        source_box,
        template.face_region,
    )

    def canonical_width_px(dense: DenseLandmarks, group: str) -> float:
        return normalized_group_width(dense, group) * template_eye

    geometry_measurements = {
        "face_width_px": {
            "template": round(canonical_width_px(template_dense, "inner_boundary"), 3),
            "normalized_user": round(canonical_width_px(source_dense, "inner_boundary"), 3),
            "target": round(canonical_width_px(morphed_dense, "inner_boundary"), 3),
        },
        "cheek_width_px": {
            "template": round(canonical_width_px(template_dense, "cheeks"), 3),
            "normalized_user": round(canonical_width_px(source_dense, "cheeks"), 3),
            "target": round(canonical_width_px(morphed_dense, "cheeks"), 3),
        },
        "jaw_width_px": {
            "template": round(canonical_width_px(template_dense, "jaw"), 3),
            "normalized_user": round(canonical_width_px(source_dense, "jaw"), 3),
            "target": round(canonical_width_px(morphed_dense, "jaw"), 3),
        },
        "chin_geometry": {
            "template_px": _point(template_dense.points["chin"]),
            "normalized_user_px": _point(normalized_user_chin),
            "target_px": _point(morphed_dense.points["chin"]),
            "template_normalized": _point(template_normalized["chin"]),
            "user_normalized": _point(source_normalized["chin"]),
            "target_normalized": _point(target_normalized["chin"]),
        },
    }
    return {
        "architecture": "template_morphology_plus_controlled_identity_texture",
        "coordinate_system": "pixel_xy; canonical=(eye_midpoint, eye_axis, inter_eye_distance)",
        "identity_profile": {
            "name": identity_profile.name,
            "mesh_profile": identity_profile.mesh_profile,
            "morphology_strength": dict(identity_profile.morphology_strength),
            "identity_texture_strength": dict(identity_profile.identity_texture_strength),
            "contour_movement_limits": dict(identity_profile.contour_movement_limits),
            "soft_contour_enabled": identity_profile.enable_soft_contour_mask,
            "warp_user_texture": identity_profile.warp_user_texture,
            "texture_pipeline": identity_profile.texture_pipeline,
            "local_contrast_strength": identity_profile.local_contrast_strength,
            "production_default_unchanged": identity_profile.name == "production",
        },
        "landmark_backend": landmark_metadata,
        "template_landmark_backend": template_landmark_metadata,
        "fixed_identity_regions": ["outer_skull", "hairline", "hair", "ears", "neck"],
        "source": {
            "image_width": int(source.shape[1]),
            "image_height": int(source.shape[0]),
            "face_bbox": {
                "x1": source_box.x,
                "y1": source_box.y,
                "x2": source_box.x2,
                "y2": source_box.y2,
                "width": source_box.width,
                "height": source_box.height,
            },
            **_points_json(source_landmarks),
            "inter_eye_distance": round(source_eye, 3),
            "dense_landmark_count": len(source_dense.points),
            "dense_landmarks": _points_json(source_dense.points),
            "scaffold_landmarks": _points_json(scaffold_dense.points),
        },
        "template": {
            "image_width": int(target.shape[1]),
            "image_height": int(target.shape[0]),
            "face_bbox": {
                "x1": template.face_region[0],
                "y1": template.face_region[1],
                "x2": template.face_region[0] + template.face_region[2],
                "y2": template.face_region[1] + template.face_region[3],
                "width": template.face_region[2],
                "height": template.face_region[3],
            },
            **_points_json(template.face_anchors),
            "inter_eye_distance": round(template_eye, 3),
            "dense_landmark_count": len(template_dense.points),
        },
        "normalized_source_landmarks": _normalized_json(source_normalized),
        "normalized_template_landmarks": _normalized_json(template_normalized),
        "target_morph_landmarks": _points_json(morphed_dense.points),
        "target_morph_normalized_landmarks": _normalized_json(target_normalized),
        "landmark_group_weights": dict(identity_profile.morphology_strength),
        "identity_texture_strength": dict(identity_profile.identity_texture_strength),
        "geometry_measurements": geometry_measurements,
        "shared_geometry_measurements": shared_geometry,
        "final_landmark_backend": final_landmark_metadata,
        "registration": {
            "scale": round(float(registration.scale), 6),
            "rotation_degrees": round(float(registration.rotation_degrees), 4),
            "residuals_px": {name: round(value, 3) for name, value in registration_residuals.items()},
        },
        "geometry_widths_px": {
            "active_face_width": round(_pixel_group_width(source_dense, "inner_boundary"), 3),
            "active_cheek_width": round(_pixel_group_width(source_dense, "cheeks"), 3),
            "active_jaw_width": round(_pixel_group_width(source_dense, "jaw"), 3),
            "template_face_width": round(_pixel_group_width(template_dense, "inner_boundary"), 3),
            "template_cheek_width": round(_pixel_group_width(template_dense, "cheeks"), 3),
            "template_jaw_width": round(_pixel_group_width(template_dense, "jaw"), 3),
            "target_face_width": round(_pixel_group_width(morphed_dense, "inner_boundary"), 3),
            "target_cheek_width": round(_pixel_group_width(morphed_dense, "cheeks"), 3),
            "target_jaw_width": round(_pixel_group_width(morphed_dense, "jaw"), 3),
        },
        "ratios": {
            "face_width_ratio_before_source_to_template": round(source_face_width / max(template_face_width, 1e-6), 4),
            "face_width_ratio_after_morphed_to_template": round(morphed_face_width / max(template_normalized_width, 1e-6), 4),
            "cheek_width_ratio_before_source_to_template": round(
                normalized_group_width(source_dense, "cheeks") / max(normalized_group_width(template_dense, "cheeks"), 1e-6), 4
            ),
            "cheek_width_ratio_after_morphed_to_template": round(
                normalized_group_width(morphed_dense, "cheeks") / max(normalized_group_width(template_dense, "cheeks"), 1e-6), 4
            ),
            "jaw_width_ratio_before_source_to_template": round(
                normalized_group_width(source_dense, "jaw") / max(normalized_group_width(template_dense, "jaw"), 1e-6), 4
            ),
            "jaw_width_ratio_after_morphed_to_template": round(
                normalized_group_width(morphed_dense, "jaw") / max(normalized_group_width(template_dense, "jaw"), 1e-6), 4
            ),
            "eye_distance_ratio_before_source_to_template": round(source_eye / max(template_eye, 1e-6), 4),
            "eye_distance_ratio_after_morphed_to_template": round(
                math.dist(morphed_dense.points["left_eye_center"], morphed_dense.points["right_eye_center"]) / max(template_eye, 1e-6), 4
            ),
        },
        "morphology_transform_residual": {
            "max_target_to_template_px": round(
                max(float(np.linalg.norm(morphed_dense.points[name] - template_dense.points[name])) for name in template_dense.points),
                3,
            ),
            "eye_anchor_residual_px": round(
                max(float(np.linalg.norm(morphed_dense.points[name] - template_dense.points[name]))
                    for name in ("left_eye_center", "right_eye_center")),
                3,
            ),
        },
        "geometry_mask": {"bbox": geometry_bbox, "area": geometry_area},
        "texture_mask": {"bbox": texture_bbox, "area": texture_area},
        "delaunay_triangle_count": triangle_count,
    }


def _draw_dense(image, dense: DenseLandmarks, color_by_group: bool = True) -> None:
    colors = {
        "eyes": (0, 220, 255),
        "eyebrows": (255, 180, 0),
        "nose": (0, 255, 0),
        "mouth": (255, 0, 200),
        "cheeks": (0, 140, 255),
        "jaw": (255, 0, 0),
        "chin": (180, 0, 255),
        "inner_boundary": (120, 120, 120),
    }
    for name, point in dense.points.items():
        color = colors.get(dense.groups.get(name), (0, 255, 255)) if color_by_group else (0, 255, 255)
        location = tuple(np.rint(point).astype(int))
        cv2.circle(image, location, 3, color, -1, cv2.LINE_AA)
        if name in {"left_eye_center", "right_eye_center", "nose_tip", "mouth_center", "chin"}:
            cv2.putText(
                image, name, (location[0] + 6, location[1] - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1, cv2.LINE_AA,
            )


def _draw_dense_points(image, dense: DenseLandmarks, color, label: str) -> None:
    for name, point in dense.points.items():
        location = tuple(np.rint(point).astype(int))
        cv2.circle(image, location, 2, color, -1, cv2.LINE_AA)
        if name in {"left_eye_center", "right_eye_center", "nose_tip", "mouth_center", "chin"}:
            cv2.putText(
                image,
                f"{label}:{name}",
                (location[0] + 5, location[1] + 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.32,
                color,
                1,
                cv2.LINE_AA,
            )


def _normalized_overlay(source_normalized, template_normalized, target_normalized) -> np.ndarray:
    canvas = np.full((560, 760, 3), 248, dtype=np.uint8)

    def plot(points, color, label):
        for name, point in points.items():
            x = int(380 + float(point[0]) * 180)
            y = int(150 + float(point[1]) * 180)
            cv2.circle(canvas, (x, y), 3, color, -1, cv2.LINE_AA)
        cv2.putText(canvas, label, (24, 34 + 28 * {"template": 0, "source": 1, "target": 2}[label]),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, color, 2, cv2.LINE_AA)

    plot(template_normalized, (0, 150, 0), "template")
    plot(source_normalized, (0, 0, 220), "source")
    plot(target_normalized, (220, 100, 0), "target")
    cv2.line(canvas, (380, 65), (380, 520), (180, 180, 180), 1)
    cv2.line(canvas, (80, 150), (700, 150), (180, 180, 180), 1)
    return canvas


def _draw_mesh(image: np.ndarray, points: dict[str, np.ndarray], triangles) -> np.ndarray:
    output = image.copy()
    labels = list(points)
    values = np.asarray([points[name] for name in labels], dtype=np.float32)
    for i0, i1, i2 in triangles:
        polygon = np.rint(values[[i0, i1, i2]]).astype(np.int32)
        cv2.polylines(output, [polygon], True, (255, 120, 0), 1, cv2.LINE_AA)
    _draw_dense(output, DenseLandmarks(points, {name: "inner_boundary" for name in points}), False)
    return output


def _draw_jaw_cheek_overlay(
    image: np.ndarray,
    template_dense: DenseLandmarks,
    target_dense: DenseLandmarks,
) -> np.ndarray:
    output = image.copy()
    for group, color in (("cheeks", (0, 140, 255)), ("jaw", (255, 0, 0))):
        for side in ("left", "right"):
            names = [
                name for name in template_dense.points
                if template_dense.groups.get(name) == group and name.startswith(side)
            ]
            names.sort(key=lambda name: float(template_dense.points[name][1]))
            if len(names) >= 2:
                template_line = np.rint([template_dense.points[name] for name in names]).astype(np.int32)
                target_line = np.rint([target_dense.points[name] for name in names]).astype(np.int32)
                cv2.polylines(output, [template_line], False, (210, 210, 210), 2, cv2.LINE_AA)
                cv2.polylines(output, [target_line], False, color, 2, cv2.LINE_AA)
            for name in names:
                cv2.circle(output, tuple(np.rint(target_dense.points[name]).astype(int)), 3, color, -1, cv2.LINE_AA)
    template_chin = tuple(np.rint(template_dense.points["chin"]).astype(int))
    target_chin = tuple(np.rint(target_dense.points["chin"]).astype(int))
    cv2.line(output, template_chin, target_chin, (180, 0, 255), 2, cv2.LINE_AA)
    cv2.circle(output, template_chin, 4, (210, 210, 210), -1, cv2.LINE_AA)
    cv2.circle(output, target_chin, 4, (180, 0, 255), -1, cv2.LINE_AA)
    cv2.putText(output, "gray=template orange/blue=target", (22, 36),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, (245, 245, 245), 2, cv2.LINE_AA)
    return output


def _draw_contour_categories(
    image: np.ndarray,
    source_dense: DenseLandmarks,
    template_dense: DenseLandmarks,
    target_dense: DenseLandmarks,
    final_dense: DenseLandmarks,
    registration_matrix: np.ndarray,
) -> np.ndarray:
    output = image.copy()
    names = sorted(
        (name for name in template_dense.points if name.startswith("inner_boundary_")),
        key=lambda name: int(name.rsplit("_", 1)[-1]),
    )
    registered_user = transform_points(
        np.asarray([source_dense.points[name] for name in names], dtype=np.float32),
        registration_matrix,
    )
    contours = (
        (registered_user, (0, 220, 255), "user"),
        (np.asarray([template_dense.points[name] for name in names]), (190, 190, 190), "template"),
        (np.asarray([target_dense.points[name] for name in names]), (255, 0, 255), "target"),
        (np.asarray([final_dense.points[name] for name in names]), (255, 255, 0), "final"),
    )
    for values, color, _ in contours:
        cv2.polylines(output, [np.rint(values).astype(np.int32)], True, color, 2, cv2.LINE_AA)

    soft_groups = {
        "temple_boundary", "upper_cheek_boundary", "cheek_boundary",
        "lower_cheek_boundary", "jaw_angle_boundary", "jaw_boundary", "chin_boundary",
    }
    for name in names:
        point = tuple(np.rint(template_dense.points[name]).astype(int))
        if template_dense.groups.get(name) == "hard_template_boundary":
            cv2.drawMarker(output, point, (0, 0, 255), cv2.MARKER_SQUARE, 12, 2, cv2.LINE_AA)
        elif template_dense.groups.get(name) in soft_groups:
            cv2.circle(output, point, 5, (0, 255, 0), 2, cv2.LINE_AA)

    legend = (
        ("user contour", (0, 220, 255)),
        ("template contour", (190, 190, 190)),
        ("target contour", (255, 0, 255)),
        ("final contour", (255, 255, 0)),
        ("red square=hard; green circle=soft", (245, 245, 245)),
    )
    for index, (label, color) in enumerate(legend):
        cv2.putText(output, label, (22, 30 + index * 24), cv2.FONT_HERSHEY_SIMPLEX,
                    0.52, color, 1, cv2.LINE_AA)
    return output


def _mask_overlay(base: np.ndarray, mask: np.ndarray) -> np.ndarray:
    heat = cv2.applyColorMap(np.rint(np.clip(mask, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_JET)
    return cv2.addWeighted(base, 0.65, heat, 0.35, 0)


def _write_debug_images(
    debug_dir,
    source,
    target,
    source_box,
    source_dense,
    scaffold_dense,
    template_dense,
    morphed_dense,
    landmark_metadata,
    geometry_polygon,
    triangles,
    aligned_template,
    morphed_template,
    warped_user,
    adjusted_user,
    texture_mask,
    geometry_base,
    result,
    diagnostics,
    final_dense,
    registration_matrix,
    photometric_debug_images,
) -> None:
    debug_dir.mkdir(parents=True, exist_ok=True)
    source_debug = source.copy()
    cv2.rectangle(source_debug, (source_box.x, source_box.y), (source_box.x2, source_box.y2), (0, 255, 0), 2)
    _draw_dense(source_debug, source_dense)
    scaffold_debug = source.copy()
    cv2.rectangle(scaffold_debug, (source_box.x, source_box.y), (source_box.x2, source_box.y2), (0, 255, 0), 2)
    _draw_dense(scaffold_debug, scaffold_dense)
    comparison_debug = source.copy()
    cv2.rectangle(comparison_debug, (source_box.x, source_box.y), (source_box.x2, source_box.y2), (0, 255, 0), 2)
    _draw_dense(comparison_debug, source_dense)
    _draw_dense_points(comparison_debug, scaffold_dense, (255, 255, 0), "scaffold")
    template_debug = target.copy()
    _draw_dense(template_debug, template_dense)
    target_debug = target.copy()
    cv2.polylines(target_debug, [np.rint(geometry_polygon).astype(np.int32)], True, (255, 0, 255), 2)
    _draw_dense(target_debug, morphed_dense)
    mesh_debug = _draw_mesh(target, morphed_dense.points, triangles)
    jaw_cheek_debug = _draw_jaw_cheek_overlay(target, template_dense, morphed_dense)
    raw_texture_mask = np.rint(np.clip(texture_mask, 0, 1) * 255).astype(np.uint8)
    contour_debug = (
        _draw_contour_categories(
            target,
            source_dense,
            template_dense,
            morphed_dense,
            final_dense,
            registration_matrix,
        )
        if final_dense is not None else None
    )
    final_debug = result.copy()
    _draw_dense(final_debug, morphed_dense)
    if landmark_metadata.get("backend") == "mediapipe_face_mesh":
        images = {
            "01_source_real_landmarks.jpg": source_debug,
            "02_source_scaffold_landmarks.jpg": scaffold_debug,
            "03_landmark_comparison.jpg": comparison_debug,
            "04_template_landmarks.jpg": template_debug,
            "05_normalized_shapes.jpg": _normalized_overlay(
                diagnostics["normalized_source_landmarks"],
                diagnostics["normalized_template_landmarks"],
                diagnostics["target_morph_normalized_landmarks"],
            ),
            "06_target_morph.jpg": target_debug,
            "07_piecewise_mesh.jpg": mesh_debug,
            "08_template_morphed.jpg": morphed_template,
            "09_texture_transfer.jpg": _mask_overlay(aligned_template, texture_mask),
            "10_final_real_landmarks.jpg": final_debug,
            "11_jaw_cheek_overlay.jpg": jaw_cheek_debug,
            "12_texture_mask.png": raw_texture_mask,
            "13_warped_raw_user_face.jpg": warped_user,
            "14_color_harmonized_user_face.jpg": adjusted_user,
            "15_final_blend.png": result,
        }
        if contour_debug is not None:
            images["16_contour_categories.jpg"] = contour_debug
    else:
        images = {
            "01_source_dense_landmarks.jpg": source_debug,
            "02_template_dense_landmarks.jpg": template_debug,
            "03_normalized_landmark_comparison.jpg": _normalized_overlay(
                diagnostics["normalized_source_landmarks"],
                diagnostics["normalized_template_landmarks"],
                diagnostics["target_morph_normalized_landmarks"],
            ),
            "04_target_morph_landmarks.jpg": target_debug,
            "05_delaunay_mesh.jpg": mesh_debug,
            "06_template_morphed.jpg": morphed_template,
            "07_identity_texture_regions.jpg": _mask_overlay(aligned_template, texture_mask),
            "08_final_composite.jpg": result,
            "09_jaw_cheek_overlay.jpg": jaw_cheek_debug,
            "10_texture_mask.png": raw_texture_mask,
        }
    images.update(photometric_debug_images)
    for filename, image in images.items():
        params = (
            [cv2.IMWRITE_PNG_COMPRESSION, 3]
            if Path(filename).suffix.lower() == ".png"
            else [cv2.IMWRITE_JPEG_QUALITY, 94]
        )
        if not cv2.imwrite(str(debug_dir / filename), image, params):
            raise RuntimeError(f"could not write Basic debug image {filename}")
    (debug_dir / "geometry.json").write_text(json.dumps(diagnostics, indent=2) + "\n", encoding="utf-8")


def _pyramid_trace_preview(trace: dict[str, list[np.ndarray]]) -> np.ndarray:
    """Build a compact contact sheet of the legacy F multiband layers."""
    names = ("template_laplacian", "identity_laplacian", "blended_laplacian")
    levels = len(trace["blended_laplacian"])
    cell_width = 320
    cell_height = 420
    sheet = np.full((levels * cell_height, len(names) * cell_width, 3), 24, dtype=np.uint8)
    for column, name in enumerate(names):
        for level, values in enumerate(trace[name]):
            layer = np.asarray(values, dtype=np.float32)
            if level == levels - 1:
                visible = np.clip(layer, 0, 255).astype(np.uint8)
            else:
                bound = max(float(np.percentile(np.abs(layer), 99.5)), 1.0)
                visible = np.rint(128.0 + 112.0 * np.clip(layer / bound, -1.0, 1.0)).astype(np.uint8)
            visible = cv2.resize(visible, (cell_width, cell_height), interpolation=cv2.INTER_AREA)
            row = level * cell_height
            col = column * cell_width
            sheet[row:row + cell_height, col:col + cell_width] = visible
            cv2.putText(
                sheet,
                f"{name} L{level}",
                (col + 8, row + 24),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (0, 255, 255),
                1,
                cv2.LINE_AA,
            )
    return sheet


def make_session_output(runtime_tmp: Path, job_id: str) -> Path:
    return runtime_tmp / job_id / f"basic-{uuid.uuid4().hex}.png"


def get_basic_engine() -> BasicGenerationEngine:
    return BasicGenerationEngine()
