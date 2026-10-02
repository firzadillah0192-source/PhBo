"""Geometry-first face alignment, local color matching, and compositing."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Mapping

import cv2
import numpy as np


@dataclass(frozen=True)
class SimilarityTransform:
    matrix: np.ndarray
    scale: float
    rotation_degrees: float


def estimate_eye_similarity(source_points: np.ndarray, target_points: np.ndarray) -> SimilarityTransform:
    """Return a uniform-scale transform that aligns both eye centers exactly."""
    source = np.asarray(source_points, dtype=np.float64)
    target = np.asarray(target_points, dtype=np.float64)
    if source.shape[0] < 2 or target.shape[0] < 2:
        raise ValueError("at least left-eye and right-eye points are required")

    source_eye = source[1] - source[0]
    target_eye = target[1] - target[0]
    source_distance = float(np.linalg.norm(source_eye))
    target_distance = float(np.linalg.norm(target_eye))
    if source_distance < 1.0 or target_distance < 1.0:
        raise ValueError("inter-eye distance is too small for alignment")

    scale = target_distance / source_distance
    source_angle = math.atan2(float(source_eye[1]), float(source_eye[0]))
    target_angle = math.atan2(float(target_eye[1]), float(target_eye[0]))
    rotation = target_angle - source_angle
    cosine = math.cos(rotation) * scale
    sine = math.sin(rotation) * scale
    linear = np.array([[cosine, -sine], [sine, cosine]], dtype=np.float64)
    source_midpoint = (source[0] + source[1]) / 2.0
    target_midpoint = (target[0] + target[1]) / 2.0
    translation = target_midpoint - linear @ source_midpoint
    matrix = np.column_stack((linear, translation)).astype(np.float32)
    return SimilarityTransform(
        matrix=matrix,
        scale=scale,
        rotation_degrees=math.degrees(rotation),
    )


def transform_points(points: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    values = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
    return cv2.transform(values, matrix).reshape(-1, 2)


def warp_face(source: np.ndarray, matrix: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    return cv2.warpAffine(
        source,
        matrix,
        size,
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REFLECT_101,
    )


def soft_face_mask(
    size: tuple[int, int],
    region: tuple[int, int, int, int],
    polygon: tuple[tuple[float, float], ...] | None = None,
    inward_only: bool = False,
) -> np.ndarray:
    """Build a feathered inner-face mask that excludes hair, ears, jaw, and neck."""
    width, height = size
    mask = np.zeros((height, width), dtype=np.float32)
    x, y, region_width, region_height = region
    if polygon:
        points = np.rint(np.asarray(polygon, dtype=np.float32)).astype(np.int32)
        cv2.fillPoly(mask, [points], 1.0)
    else:
        center = (int(x + region_width * 0.50), int(y + region_height * 0.56))
        axes = (max(1, int(region_width * 0.36)), max(1, int(region_height * 0.32)))
        cv2.ellipse(mask, center, axes, 0, 0, 360, 1.0, -1)
    sigma = max(3.0, min(region_width, region_height) * 0.035)
    if inward_only:
        distance = cv2.distanceTransform((mask > 0).astype(np.uint8), cv2.DIST_L2, 5)
        mask = np.clip(distance / sigma, 0.0, 1.0)
    else:
        mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=sigma, sigmaY=sigma)
    return np.clip(mask * 0.94, 0.0, 0.94)


def harmonize_color(source: np.ndarray, target: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Apply bounded LAB statistics matching only for the composited face area."""
    active = mask > 0.05
    if int(active.sum()) < 100:
        return source

    source_lab = cv2.cvtColor(source, cv2.COLOR_BGR2LAB).astype(np.float32)
    target_lab = cv2.cvtColor(target, cv2.COLOR_BGR2LAB).astype(np.float32)
    source_pixels = source_lab[active]
    target_pixels = target_lab[active]
    source_mean = source_pixels.mean(axis=0)
    target_mean = target_pixels.mean(axis=0)
    source_std = np.maximum(source_pixels.std(axis=0), 1.0)
    target_std = np.maximum(target_pixels.std(axis=0), 1.0)
    ratios = np.clip(target_std / source_std, [0.75, 0.80, 0.80], [1.25, 1.20, 1.20])
    adjusted_lab = (source_lab - source_mean) * ratios + target_mean
    adjusted_lab = np.clip(adjusted_lab, 0, 255).astype(np.uint8)
    return cv2.cvtColor(adjusted_lab, cv2.COLOR_LAB2BGR)


def harmonize_local_illumination(
    source: np.ndarray,
    target: np.ndarray,
    mask: np.ndarray,
) -> np.ndarray:
    """Keep source facial detail while making template illumination authoritative."""
    active = mask > 0.05
    if int(active.sum()) < 100:
        return source

    source_lab = cv2.cvtColor(source, cv2.COLOR_BGR2LAB).astype(np.float32)
    target_lab = cv2.cvtColor(target, cv2.COLOR_BGR2LAB).astype(np.float32)
    source_pixels = source_lab[active]
    target_pixels = target_lab[active]

    adjusted = source_lab.copy()
    source_low = cv2.GaussianBlur(source_lab[..., 0], (0, 0), sigmaX=13.0, sigmaY=13.0)
    source_detail = source_lab[..., 0] - source_low
    target_low = cv2.GaussianBlur(target_lab[..., 0], (0, 0), sigmaX=13.0, sigmaY=13.0)
    adjusted[..., 0] = target_low + source_detail * 0.88

    for channel in (1, 2):
        source_mean = float(source_pixels[:, channel].mean())
        target_mean = float(target_pixels[:, channel].mean())
        source_std = max(float(source_pixels[:, channel].std()), 1.0)
        target_std = max(float(target_pixels[:, channel].std()), 1.0)
        ratio = float(np.clip(target_std / source_std, 0.78, 1.22))
        adjusted[..., channel] = (source_lab[..., channel] - source_mean) * ratio + target_mean
    return cv2.cvtColor(np.clip(adjusted, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def frequency_separated_identity(
    template: np.ndarray,
    identity: np.ndarray,
    face_mask: np.ndarray,
    *,
    low_sigma: float = 14.0,
    mid_sigma: float = 3.5,
    mid_luminance_authority: float = 0.84,
    high_luminance_authority: float = 0.90,
    template_mid_luminance_authority: float = 0.16,
    template_high_luminance_authority: float = 0.10,
    mid_chroma_authority: float = 0.75,
    high_chroma_authority: float = 0.65,
    template_mid_chroma_authority: float = 0.25,
    template_high_chroma_authority: float = 0.35,
    user_intrinsic_chroma_authority: float = 0.68,
    user_intrinsic_luminance_authority: float = 0.25,
) -> tuple[np.ndarray, dict[str, np.ndarray]]:
    """Reconstruct user facial detail over template low-frequency lighting.

    The returned candidate is only composited under the caller's inward-only
    identity mask. Its low-frequency luminance follows the template. A bounded
    constant luminance offset and mostly user-derived low-frequency chroma
    retain some intrinsic skin-tone identity without carrying over selfie
    illumination gradients.
    """
    if template.shape != identity.shape or template.ndim != 3 or template.shape[2] != 3:
        raise ValueError("frequency identity inputs must be matching BGR images")
    if face_mask.shape != template.shape[:2]:
        raise ValueError("frequency identity mask must match image dimensions")
    authorities = (
        mid_luminance_authority,
        high_luminance_authority,
        template_mid_luminance_authority,
        template_high_luminance_authority,
        mid_chroma_authority,
        high_chroma_authority,
        template_mid_chroma_authority,
        template_high_chroma_authority,
        user_intrinsic_chroma_authority,
        user_intrinsic_luminance_authority,
    )
    if any(not 0.0 <= float(value) <= 1.0 for value in authorities):
        raise ValueError("frequency authorities must be between 0 and 1")

    template_lab = cv2.cvtColor(template, cv2.COLOR_BGR2LAB).astype(np.float32)
    identity_lab = cv2.cvtColor(identity, cv2.COLOR_BGR2LAB).astype(np.float32)
    template_low = cv2.GaussianBlur(template_lab, (0, 0), low_sigma, low_sigma)
    template_mid_base = cv2.GaussianBlur(template_lab, (0, 0), mid_sigma, mid_sigma)
    template_mid = template_mid_base - template_low
    template_high = template_lab - template_mid_base
    identity_low = cv2.GaussianBlur(identity_lab, (0, 0), low_sigma, low_sigma)
    identity_mid_base = cv2.GaussianBlur(identity_lab, (0, 0), mid_sigma, mid_sigma)
    identity_mid = identity_mid_base - identity_low
    identity_high = identity_lab - identity_mid_base

    active = np.asarray(face_mask) > 0.10
    if int(active.sum()) < 100:
        raise ValueError("frequency identity mask has insufficient inner-face coverage")

    # Preserve only a bounded part of the user's mean intrinsic lightness; the
    # template's spatial illumination field remains authoritative.
    source_skin_l = float(np.median(identity_low[..., 0][active]))
    template_skin_l = float(np.median(template_low[..., 0][active]))
    intrinsic_luminance_delta = float(np.clip(source_skin_l - template_skin_l, -8.0, 8.0))

    reconstructed = template_low.copy()
    reconstructed[..., 0] = (
        template_low[..., 0]
        + intrinsic_luminance_delta * user_intrinsic_luminance_authority
        + identity_mid[..., 0] * mid_luminance_authority
        + template_mid[..., 0] * template_mid_luminance_authority
        + identity_high[..., 0] * high_luminance_authority
        + template_high[..., 0] * template_high_luminance_authority
    )
    low_chroma = (
        template_low[..., 1:] * (1.0 - user_intrinsic_chroma_authority)
        + identity_low[..., 1:] * user_intrinsic_chroma_authority
    )
    reconstructed[..., 1:] = (
        low_chroma
        + identity_mid[..., 1:] * mid_chroma_authority
        + template_mid[..., 1:] * template_mid_chroma_authority
        + identity_high[..., 1:] * high_chroma_authority
        + template_high[..., 1:] * template_high_chroma_authority
    )
    reconstructed_bgr = cv2.cvtColor(
        np.clip(reconstructed, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR
    )

    return reconstructed_bgr, {
        "template_low_frequency": cv2.cvtColor(
            np.clip(template_low, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR
        ),
        "identity_low_frequency": cv2.cvtColor(
            np.clip(identity_low, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR
        ),
        "identity_mid_frequency": _signed_luminance_band_preview(identity_mid[..., 0]),
        "identity_high_frequency": _signed_luminance_band_preview(identity_high[..., 0]),
        "frequency_composite": reconstructed_bgr,
        "intrinsic_luminance_delta_lab": np.asarray([intrinsic_luminance_delta], dtype=np.float32),
    }


def _signed_luminance_band_preview(band: np.ndarray) -> np.ndarray:
    """Show a signed L* band as gray-centered contrast; reconstruction uses LAB."""
    values = np.asarray(band, dtype=np.float32)
    bound = max(float(np.percentile(np.abs(values), 99.5)), 1.0)
    encoded = np.rint(128.0 + 112.0 * np.clip(values / bound, -1.0, 1.0)).astype(np.uint8)
    return cv2.cvtColor(encoded, cv2.COLOR_GRAY2BGR)


def restore_local_face_contrast(
    image: np.ndarray,
    regional_mask: np.ndarray,
    *,
    strength: float = 0.14,
    sigma: float = 2.0,
    maximum_detail: float = 10.0,
) -> np.ndarray:
    """Apply a bounded luminance-detail lift only inside facial feature masks."""
    if image.ndim != 3 or image.shape[2] != 3 or regional_mask.shape != image.shape[:2]:
        raise ValueError("local contrast inputs must be a BGR image and matching mask")
    if not 0.0 <= strength <= 0.35 or sigma <= 0 or maximum_detail <= 0:
        raise ValueError("local contrast parameters are outside safe bounds")
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    luminance = lab[..., 0]
    local_base = cv2.GaussianBlur(luminance, (0, 0), sigma, sigma)
    detail = np.clip(luminance - local_base, -maximum_detail, maximum_detail)
    mask = np.clip(np.asarray(regional_mask, dtype=np.float32), 0.0, 1.0)
    lab[..., 0] = luminance + detail * (strength * mask)
    restored = np.clip(lab, 0, 255).astype(np.uint8)
    output = cv2.cvtColor(restored, cv2.COLOR_LAB2BGR)
    output[mask <= 0.0] = image[mask <= 0.0]
    return output


def composite(template: np.ndarray, aligned_face: np.ndarray, mask: np.ndarray) -> np.ndarray:
    alpha = mask[..., None]
    result = aligned_face.astype(np.float32) * alpha + template.astype(np.float32) * (1 - alpha)
    return np.clip(result, 0, 255).astype(np.uint8)


def multiband_composite(
    template: np.ndarray,
    identity: np.ndarray,
    mask: np.ndarray,
    levels: int = 4,
    *,
    return_trace: bool = False,
) -> np.ndarray | tuple[np.ndarray, dict[str, list[np.ndarray]]]:
    """Deterministic Laplacian-pyramid blend under a regional authority mask."""
    template_float = template.astype(np.float32)
    identity_float = identity.astype(np.float32)
    mask_float = np.clip(mask.astype(np.float32), 0.0, 1.0)

    template_gaussian = [template_float]
    identity_gaussian = [identity_float]
    mask_gaussian = [mask_float]
    for _ in range(levels):
        template_gaussian.append(cv2.pyrDown(template_gaussian[-1]))
        identity_gaussian.append(cv2.pyrDown(identity_gaussian[-1]))
        mask_gaussian.append(cv2.pyrDown(mask_gaussian[-1]))

    template_laplacian = []
    identity_laplacian = []
    for level in range(levels):
        size = (template_gaussian[level].shape[1], template_gaussian[level].shape[0])
        template_laplacian.append(
            template_gaussian[level] - cv2.pyrUp(template_gaussian[level + 1], dstsize=size)
        )
        identity_laplacian.append(
            identity_gaussian[level] - cv2.pyrUp(identity_gaussian[level + 1], dstsize=size)
        )
    template_laplacian.append(template_gaussian[-1])
    identity_laplacian.append(identity_gaussian[-1])

    blended_levels = []
    for template_level, identity_level, level_mask in zip(
        template_laplacian,
        identity_laplacian,
        mask_gaussian,
        strict=True,
    ):
        alpha = level_mask[..., None]
        blended_levels.append(identity_level * alpha + template_level * (1.0 - alpha))

    output = blended_levels[-1]
    for level in range(levels - 1, -1, -1):
        size = (blended_levels[level].shape[1], blended_levels[level].shape[0])
        output = cv2.pyrUp(output, dstsize=size) + blended_levels[level]
    result = np.clip(output, 0, 255).astype(np.uint8)
    if not return_trace:
        return result
    return result, {
        "template_laplacian": template_laplacian,
        "identity_laplacian": identity_laplacian,
        "blended_laplacian": blended_levels,
        "mask_gaussian": mask_gaussian,
    }


def delaunay_triangles(points: np.ndarray, size: tuple[int, int]) -> list[tuple[int, int, int]]:
    """Return stable point-index triangles from OpenCV's deterministic Delaunay."""
    width, height = size
    values = np.asarray(points, dtype=np.float32)
    subdiv = cv2.Subdiv2D((0, 0, width, height))
    for point in values:
        x, y = float(point[0]), float(point[1])
        if 0 <= x < width and 0 <= y < height:
            subdiv.insert((x, y))
    triangles = []
    for raw in subdiv.getTriangleList().reshape(-1, 6):
        vertices = raw.reshape(3, 2)
        indices = []
        for vertex in vertices:
            distances = np.linalg.norm(values - vertex, axis=1)
            index = int(np.argmin(distances))
            if float(distances[index]) > 2.0 or index in indices:
                indices = []
                break
            indices.append(index)
        if len(indices) == 3 and len(set(indices)) == 3:
            triangle = tuple(indices)
            if triangle not in triangles and tuple(reversed(triangle)) not in triangles:
                triangles.append(triangle)
    return triangles


def piecewise_affine_warp(
    image: np.ndarray,
    source_points: np.ndarray,
    target_points: np.ndarray,
    size: tuple[int, int],
) -> tuple[np.ndarray, list[tuple[int, int, int]]]:
    """Warp only the template face scaffold using per-triangle affine maps."""
    width, height = size
    source = np.asarray(source_points, dtype=np.float32)
    target = np.asarray(target_points, dtype=np.float32)
    if source.shape != target.shape or source.shape[0] < 3:
        raise ValueError("piecewise warp requires matching point arrays")
    triangles = delaunay_triangles(target, size)
    result = image.copy()
    for i0, i1, i2 in triangles:
        source_triangle = source[[i0, i1, i2]]
        target_triangle = target[[i0, i1, i2]]
        if abs(float(cv2.contourArea(target_triangle))) < 0.5:
            continue
        matrix = cv2.getAffineTransform(source_triangle, target_triangle)
        warped = cv2.warpAffine(
            image,
            matrix,
            (width, height),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT_101,
        )
        triangle_mask = np.zeros((height, width), dtype=np.uint8)
        cv2.fillConvexPoly(triangle_mask, np.rint(target_triangle).astype(np.int32), 255)
        result[triangle_mask > 0] = warped[triangle_mask > 0]
    return result, triangles


def geometry_polygon_for_region(region: tuple[int, int, int, int]) -> np.ndarray:
    """Inner head/face boundary; excludes hairline, ears, and neck."""
    x, y, width, height = [float(value) for value in region]
    fractions = (
        (0.18, 0.30), (0.28, 0.18), (0.43, 0.13), (0.58, 0.13),
        (0.73, 0.19), (0.86, 0.32), (0.91, 0.50), (0.86, 0.68),
        (0.75, 0.84), (0.63, 0.96), (0.50, 1.00), (0.37, 0.96),
        (0.25, 0.84), (0.14, 0.68), (0.09, 0.50), (0.14, 0.32),
    )
    return np.asarray([(x + width * fx, y + height * fy) for fx, fy in fractions], dtype=np.float32)


def geometry_influence_mask(
    size: tuple[int, int],
    region: tuple[int, int, int, int],
    points: dict[str, np.ndarray],
    polygon: np.ndarray | None = None,
    groups: dict[str, str] | None = None,
    enable_soft_contour: bool = False,
) -> np.ndarray:
    """Soft template-morph influence: broad face allowed, boundary and neck zero."""
    width, height = size
    x, y, region_width, region_height = [float(value) for value in region]
    polygon = polygon if polygon is not None else geometry_polygon_for_region(region)
    inside = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(inside, [np.rint(polygon).astype(np.int32)], 255)
    distance = cv2.distanceTransform(inside, cv2.DIST_L2, 5)
    feather = np.clip(distance / max(min(region_width, region_height) * 0.12, 1.0), 0.0, 1.0)
    eye_y = float(np.mean([points["left_eye_center"][1], points["right_eye_center"][1]]))
    mouth_y = float(points["mouth_center"][1])
    chin_y = float(points["chin"][1])
    rows = np.arange(height, dtype=np.float32)[:, None]
    top_y = float(np.min(polygon[:, 1]))
    upper = np.where(
        rows < eye_y,
        0.16 + 0.36 * np.clip((rows - top_y) / max(eye_y - top_y, 1.0), 0.0, 1.0),
        0.52,
    )
    lower_fraction = np.clip((rows - mouth_y) / max(chin_y - mouth_y, 1.0), 0.0, 1.0)
    lower = np.where(rows > mouth_y, 0.48 - 0.16 * lower_fraction, upper)
    mask = feather * np.minimum(upper, lower) * (inside > 0)
    if enable_soft_contour and groups:
        contour = np.zeros((height, width), dtype=np.float32)
        names = sorted(
            (name for name in points if name.startswith("inner_boundary_")),
            key=lambda name: int(name.rsplit("_", 1)[-1]),
        )
        thickness = max(8, int(region_width * 0.11))
        soft_groups = {
            "temple_boundary", "upper_cheek_boundary", "cheek_boundary",
            "lower_cheek_boundary", "jaw_angle_boundary", "jaw_boundary",
            "chin_boundary",
        }
        for first, second in zip(names, names[1:], strict=False):
            if groups.get(first) in soft_groups and groups.get(second) in soft_groups:
                cv2.line(
                    contour,
                    tuple(np.rint(points[first]).astype(int)),
                    tuple(np.rint(points[second]).astype(int)),
                    0.90,
                    thickness,
                    cv2.LINE_AA,
                )
        for name in names:
            if groups.get(name) in soft_groups:
                cv2.circle(
                    contour,
                    tuple(np.rint(points[name]).astype(int)),
                    thickness // 2,
                    0.90,
                    -1,
                    cv2.LINE_AA,
                )
        contour = cv2.GaussianBlur(contour, (0, 0), sigmaX=4.0, sigmaY=4.0)
        mask = np.maximum(mask, contour)
    mask = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), sigmaX=3.0, sigmaY=3.0)
    return np.clip(mask, 0.0, 0.90 if enable_soft_contour else 0.58)


def identity_texture_mask(
    size: tuple[int, int],
    dense_points: dict[str, np.ndarray],
    groups: dict[str, str],
    region: tuple[int, int, int, int],
    strengths: Mapping[str, float],
    polygon: tuple[tuple[float, float], ...] | None = None,
    inward_only: bool = False,
    clip_to_polygon: bool = False,
) -> np.ndarray:
    """Regional user-detail mask, independent from morphology strength."""
    required = {"eyes", "eyebrows", "nose", "mouth", "cheeks"}
    if set(strengths) != required:
        raise ValueError(f"identity texture strengths must contain exactly {sorted(required)}")
    if any(not 0.0 <= float(value) <= 1.0 for value in strengths.values()):
        raise ValueError("identity texture strengths must be between 0 and 1")
    width, height = size
    mask = np.zeros((height, width), dtype=np.float32)
    for group, weight in strengths.items():
        values = np.asarray(
            [point for name, point in dense_points.items() if groups.get(name) == group],
            dtype=np.float32,
        )
        if values.size == 0:
            continue
        min_point = values.min(axis=0)
        max_point = values.max(axis=0)
        center = ((min_point + max_point) * 0.5).astype(int)
        axes = (
            max(3, int((max_point[0] - min_point[0]) * 0.75 + 8)),
            max(3, int((max_point[1] - min_point[1]) * 0.85 + 8)),
        )
        group_mask = np.zeros((height, width), dtype=np.float32)
        cv2.ellipse(group_mask, tuple(center), axes, 0, 0, 360, 1.0, -1)
        mask = np.maximum(mask, group_mask * weight)
    inner = soft_face_mask(size, region, polygon, inward_only=inward_only)
    mask = np.minimum(mask, inner * 0.96)
    maximum = max(float(value) for value in strengths.values())
    mask = np.clip(cv2.GaussianBlur(mask, (0, 0), 3.0), 0.0, maximum)
    if clip_to_polygon:
        if polygon is None or not inward_only:
            raise ValueError("strict texture-mask clipping requires an inward-only polygon")
        inside = np.zeros((height, width), dtype=np.uint8)
        cv2.fillPoly(inside, [np.rint(np.asarray(polygon, dtype=np.float32)).astype(np.int32)], 1)
        distance = cv2.distanceTransform(inside, cv2.DIST_L2, 5)
        feather_distance = max(3.0, min(region[2], region[3]) * 0.035)
        inward_feather = np.clip((distance - 1.0) / feather_distance, 0.0, 1.0)
        mask *= inward_feather
        mask[inside == 0] = 0.0
    return mask
