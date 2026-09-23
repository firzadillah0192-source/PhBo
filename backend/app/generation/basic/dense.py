"""Deterministic facial geometry for the Basic engine.

The legacy scaffold remains available for production compatibility. Real
MediaPipe landmarks can provide a denser semantic mesh, while fixed boundary
controls keep hair, ears, skull, and neck outside identity deformation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping
import numpy as np

from .profiles import PRODUCTION_MORPHOLOGY


# Backward-compatible production alias. Candidate profiles are passed
# explicitly to ``morph_toward_template``.
GROUP_WEIGHTS = PRODUCTION_MORPHOLOGY

MORPH_DELTA_CAPS = {
    "eyes": 0.16,
    "eyebrows": 0.20,
    "nose": 0.20,
    "mouth": 0.22,
    "cheeks": 0.28,
    "jaw": 0.30,
    "chin": 0.25,
    "inner_boundary": 0.0,
    "hard_template_boundary": 0.0,
    "temple_boundary": 0.24,
    "upper_cheek_boundary": 0.30,
    "cheek_boundary": 0.34,
    "lower_cheek_boundary": 0.36,
    "jaw_angle_boundary": 0.38,
    "jaw_boundary": 0.38,
    "chin_boundary": 0.32,
}

DEFAULT_BOUNDARY_UV = (
    (0.30, 0.24), (0.42, 0.18), (0.58, 0.18), (0.70, 0.24),
    (0.84, 0.38), (0.88, 0.56), (0.82, 0.73), (0.70, 0.88),
    (0.58, 0.98), (0.42, 0.98), (0.30, 0.88), (0.18, 0.73),
    (0.12, 0.56), (0.16, 0.38),
)


@dataclass(frozen=True)
class DenseLandmarks:
    points: dict[str, np.ndarray]
    groups: dict[str, str]

    def labels(self) -> tuple[str, ...]:
        return tuple(self.points.keys())


def _as_point(value) -> np.ndarray:
    return np.asarray(value, dtype=np.float32)


def _resample_closed(points: list[np.ndarray], count: int) -> list[np.ndarray]:
    if len(points) < 3:
        return points
    values = np.asarray(points, dtype=np.float32)
    closed = np.concatenate([values, values[:1]], axis=0)
    lengths = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    cumulative = np.concatenate([[0.0], np.cumsum(lengths)])
    total = float(cumulative[-1])
    if total < 1e-6:
        return [values[index % len(values)].copy() for index in range(count)]
    samples = np.linspace(0.0, total, count, endpoint=False)
    result = []
    for sample in samples:
        segment = max(0, min(len(lengths) - 1, int(np.searchsorted(cumulative, sample, side="right") - 1)))
        fraction = (sample - cumulative[segment]) / max(float(lengths[segment]), 1e-6)
        result.append(closed[segment] + (closed[segment + 1] - closed[segment]) * fraction)
    return result


def dense_landmarks(
    face_bbox: tuple[int, int, int, int],
    anchors: dict[str, tuple[float, float]],
    boundary: tuple[tuple[float, float], ...] | None = None,
) -> DenseLandmarks:
    """Create a dense semantic scaffold in image pixels.

    Eye centers and the curated nose/mouth/chin anchors are authoritative.
    Face contour and cheek/jaw points come from the face bbox and are assigned
    low morphology influence so the template head remains structurally fixed.
    """
    x, y, width, height = [float(value) for value in face_bbox]
    left_eye = _as_point(anchors["left_eye"])
    right_eye = _as_point(anchors["right_eye"])
    eye_vector = right_eye - left_eye
    eye_distance = float(np.linalg.norm(eye_vector))
    if eye_distance < 1.0:
        raise ValueError("inter-eye distance is too small for dense landmarks")
    ux = eye_vector / eye_distance
    uy = np.asarray([-ux[1], ux[0]], dtype=np.float32)
    midpoint = (left_eye + right_eye) / 2.0

    def local(u: float, v: float) -> np.ndarray:
        return midpoint + ux * (u * eye_distance) + uy * (v * eye_distance)

    def add(name: str, point, group: str) -> None:
        points[name] = _as_point(point)
        groups[name] = group

    points: dict[str, np.ndarray] = {}
    groups: dict[str, str] = {}
    add("left_eye_center", left_eye, "eyes")
    add("right_eye_center", right_eye, "eyes")
    add("nose_tip", anchors["nose"], "nose")
    add("mouth_center", anchors["mouth"], "mouth")
    add("chin", anchors["chin"], "chin")

    eye_shape = (
        (-0.14, 0.00), (-0.09, -0.055), (0.00, -0.075), (0.09, -0.055),
        (0.14, 0.00), (0.09, 0.055), (0.00, 0.07), (-0.09, 0.05),
    )
    for side, eye_u in (("left", -0.5), ("right", 0.5)):
        for index, (du, dv) in enumerate(eye_shape):
            add(f"{side}_eye_{index:02d}", local(eye_u + du, dv), "eyes")
        for index, du in enumerate((-0.18, -0.09, 0.0, 0.09, 0.18)):
            add(f"{side}_brow_{index:02d}", local(eye_u + du, -0.20 - (0.03 if abs(du) < 0.1 else 0.0)), "eyebrows")

    nose = _as_point(anchors["nose"])
    nose_local = (float(np.dot(nose - midpoint, ux) / eye_distance),
                  float(np.dot(nose - midpoint, uy) / eye_distance))
    nose_u, nose_v = nose_local
    add("nose_bridge_00", local(nose_u, nose_v - 0.20), "nose")
    add("nose_bridge_01", local(nose_u, nose_v - 0.10), "nose")
    add("nose_bridge_02", local(nose_u, nose_v + 0.03), "nose")
    add("nose_wing_left", local(nose_u - 0.17, nose_v + 0.02), "nose")
    add("nose_wing_right", local(nose_u + 0.17, nose_v + 0.02), "nose")

    mouth = _as_point(anchors["mouth"])
    mouth_local = (float(np.dot(mouth - midpoint, ux) / eye_distance),
                   float(np.dot(mouth - midpoint, uy) / eye_distance))
    mouth_u, mouth_v = mouth_local
    mouth_half_width = min(0.36, max(0.25, (width / eye_distance) * 0.115))
    mouth_shape = (
        (-mouth_half_width, 0.00), (-mouth_half_width * 0.52, -0.075),
        (0.0, -0.095), (mouth_half_width * 0.52, -0.075),
        (mouth_half_width, 0.00), (mouth_half_width * 0.52, 0.075),
        (0.0, 0.095), (-mouth_half_width * 0.52, 0.075),
    )
    for index, (du, dv) in enumerate(mouth_shape):
        add(f"mouth_{index:02d}", local(mouth_u + du, mouth_v + dv), "mouth")

    def bbox_point(fx: float, fy: float) -> np.ndarray:
        return np.asarray((x + width * fx, y + height * fy), dtype=np.float32)

    cheek_specs = (
        ("left_cheek_upper", 0.19, 0.50), ("left_cheek_mid", 0.12, 0.64),
        ("left_cheek_lower", 0.20, 0.78), ("right_cheek_upper", 0.81, 0.50),
        ("right_cheek_mid", 0.88, 0.64), ("right_cheek_lower", 0.80, 0.78),
    )
    for name, fx, fy in cheek_specs:
        add(name, bbox_point(fx, fy), "cheeks")

    jaw_specs = (
        ("left_jaw_upper", 0.18, 0.70), ("left_jaw_mid", 0.12, 0.80),
        ("left_jaw_lower", 0.20, 0.91), ("left_jaw_chin", 0.34, 0.98),
        ("right_jaw_upper", 0.82, 0.70), ("right_jaw_mid", 0.88, 0.80),
        ("right_jaw_lower", 0.80, 0.91), ("right_jaw_chin", 0.66, 0.98),
    )
    for name, fx, fy in jaw_specs:
        add(name, bbox_point(fx, fy), "jaw")

    boundary_pixels = (
        [_as_point(point) for point in boundary]
        if boundary
        else [bbox_point(fx, fy) for fx, fy in DEFAULT_BOUNDARY_UV]
    )
    for index, point in enumerate(_resample_closed(boundary_pixels, len(DEFAULT_BOUNDARY_UV))):
        add(f"inner_boundary_{index:02d}", point, "inner_boundary")
    return DenseLandmarks(points=points, groups=groups)


def canonicalize(dense: DenseLandmarks) -> dict[str, np.ndarray]:
    left = dense.points["left_eye_center"]
    right = dense.points["right_eye_center"]
    vector = right - left
    distance = float(np.linalg.norm(vector))
    ux = vector / max(distance, 1e-6)
    uy = np.asarray([-ux[1], ux[0]], dtype=np.float32)
    midpoint = (left + right) / 2.0
    return {
        name: np.asarray(
            [float(np.dot(point - midpoint, ux) / distance),
             float(np.dot(point - midpoint, uy) / distance)],
            dtype=np.float32,
        )
        for name, point in dense.points.items()
    }


def denormalize(normalized: dict[str, np.ndarray], reference: DenseLandmarks) -> dict[str, np.ndarray]:
    left = reference.points["left_eye_center"]
    right = reference.points["right_eye_center"]
    vector = right - left
    distance = float(np.linalg.norm(vector))
    ux = vector / max(distance, 1e-6)
    uy = np.asarray([-ux[1], ux[0]], dtype=np.float32)
    midpoint = (left + right) / 2.0
    return {
        name: midpoint + ux * float(value[0]) * distance + uy * float(value[1]) * distance
        for name, value in normalized.items()
    }


def morph_toward_template(
    source: DenseLandmarks,
    template: DenseLandmarks,
    morphology_strength: Mapping[str, float] = GROUP_WEIGHTS,
    contour_movement_limits: Mapping[str, float] | None = None,
) -> tuple[
    dict[str, np.ndarray],
    dict[str, np.ndarray],
    dict[str, np.ndarray],
    dict[str, np.ndarray],
]:
    _validate_morphology_strength(morphology_strength)
    source_normalized = canonicalize(source)
    template_normalized = canonicalize(template)
    target_normalized: dict[str, np.ndarray] = {}
    weights: dict[str, float] = {}
    boundary_x = [
        value[0]
        for name, value in template_normalized.items()
        if name.startswith("inner_boundary_")
    ]
    template_face_width = float(max(boundary_x) - min(boundary_x)) if boundary_x else 1.0
    contour_movement_limits = contour_movement_limits or {}
    for name, template_value in template_normalized.items():
        source_value = source_normalized.get(name, template_value)
        group = template.groups.get(name, "inner_boundary")
        weight = morphology_strength[group]
        cap = MORPH_DELTA_CAPS[group]
        delta = np.clip(source_value - template_value, -cap, cap)
        movement = delta * weight
        if group in contour_movement_limits:
            maximum = float(contour_movement_limits[group]) * template_face_width
            magnitude = float(np.linalg.norm(movement))
            if magnitude > maximum:
                movement *= maximum / max(magnitude, 1e-6)
        target_normalized[name] = template_value + movement
        weights[group] = weight
    return (
        denormalize(target_normalized, template),
        source_normalized,
        template_normalized,
        target_normalized,
    )


def _validate_morphology_strength(strengths: Mapping[str, float]) -> None:
    missing = set(MORPH_DELTA_CAPS) - set(strengths)
    if missing:
        raise ValueError(f"missing morphology strength groups: {sorted(missing)}")
    for group in MORPH_DELTA_CAPS:
        value = float(strengths[group])
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"morphology strength for '{group}' must be between 0 and 1")
    if float(strengths["inner_boundary"]) != 0.0:
        raise ValueError("inner_boundary morphology strength must remain zero")
    if float(strengths["hard_template_boundary"]) != 0.0:
        raise ValueError("hard_template_boundary morphology strength must remain zero")


def normalized_face_width(dense: DenseLandmarks) -> float:
    values = canonicalize(dense).values()
    coordinates = np.asarray([value[0] for value in values], dtype=np.float32)
    return float(coordinates.max() - coordinates.min())


def normalized_group_width(dense: DenseLandmarks, group: str) -> float:
    normalized = canonicalize(dense)
    coordinates = [
        value[0]
        for name, value in normalized.items()
        if dense.groups.get(name) == group
        or (group == "inner_boundary" and name.startswith("inner_boundary_"))
    ]
    if not coordinates:
        return 0.0
    return float(max(coordinates) - min(coordinates))
