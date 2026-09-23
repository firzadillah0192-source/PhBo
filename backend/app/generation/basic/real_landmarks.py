"""MediaPipe Face Mesh landmark adapter for the Basic engine.

The wheel bundles the CPU face-landmark model. No model is downloaded at
runtime; the bundled TFLite asset is verified before inference.
"""

from __future__ import annotations

import hashlib
import importlib.resources
import time

import cv2
import numpy as np

from .dense import DenseLandmarks

MODEL_SHA256 = "1055cb9d4a9ca8b8c688902a3a5194311138ba256bcc94e336d8373a5f30c814"
MEDIAPIPE_VERSION = "0.10.21"

_EYE_GROUPS = (
    (33, 160, 158, 133, 153, 144, 145, 163),
    (362, 385, 387, 263, 373, 380, 381, 390),
)
_BROW_GROUPS = (
    (70, 63, 105, 66, 107),
    (336, 296, 334, 293, 300),
)
_NOSE_BRIDGE = (168, 6, 197)
_NOSE_WINGS = (98, 327)
_MOUTH_CONTOUR = (
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
    308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78,
)
_FACE_OVAL = (
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
)

_DENSE_EYE_GROUPS = (
    (33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246),
    (362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398),
)
_DENSE_BROW_GROUPS = (
    (70, 63, 105, 66, 107, 55, 65, 52, 53, 46),
    (336, 296, 334, 293, 300, 285, 295, 282, 283, 276),
)
_DENSE_NOSE = (168, 6, 197, 195, 5, 4, 45, 220, 115, 48, 64, 98, 327, 294, 278, 344, 440, 275)
_DENSE_MOUTH_OUTER = (
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
    291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
)
_DENSE_MOUTH_INNER = (
    78, 191, 80, 81, 82, 13, 312, 311, 310, 415,
    308, 324, 318, 402, 317, 14, 87, 178, 88, 95,
)
_DENSE_CHEEK_GROUPS = (
    (116, 117, 118, 119, 100, 101, 123, 147),
    (345, 346, 347, 348, 329, 330, 352, 376),
)
_DENSE_JAW_GROUPS = (
    (234, 93, 132, 58, 172, 136, 150, 149),
    (454, 323, 361, 288, 397, 365, 379, 378),
)
DENSE_SEMANTIC_COUNT = 166

# The 19 samples follow the MediaPipe oval from forehead center, down image
# right, around the chin, and back up image left. They were previously all
# fixed. Only the upper five samples are truly head/hairline controls.
BOUNDARY_SAMPLE_CLASSIFICATION = (
    ("upper_head_center", "hard_template_boundary", "HARD_TEMPLATE_BOUNDARY"),
    ("right_upper_forehead", "hard_template_boundary", "HARD_TEMPLATE_BOUNDARY"),
    ("right_hairline_interface", "hard_template_boundary", "HARD_TEMPLATE_BOUNDARY"),
    ("right_temple", "temple_boundary", "SOFT_FACE_BOUNDARY"),
    ("right_upper_cheek", "upper_cheek_boundary", "SOFT_FACE_BOUNDARY"),
    ("right_cheek", "cheek_boundary", "SOFT_FACE_BOUNDARY"),
    ("right_lower_cheek", "lower_cheek_boundary", "SOFT_FACE_BOUNDARY"),
    ("right_jaw_angle", "jaw_angle_boundary", "SOFT_FACE_BOUNDARY"),
    ("right_mandibular_contour", "jaw_boundary", "SOFT_FACE_BOUNDARY"),
    ("right_chin", "chin_boundary", "SOFT_FACE_BOUNDARY"),
    ("left_chin", "chin_boundary", "SOFT_FACE_BOUNDARY"),
    ("left_mandibular_contour", "jaw_boundary", "SOFT_FACE_BOUNDARY"),
    ("left_jaw_angle", "jaw_angle_boundary", "SOFT_FACE_BOUNDARY"),
    ("left_lower_cheek", "lower_cheek_boundary", "SOFT_FACE_BOUNDARY"),
    ("left_cheek", "cheek_boundary", "SOFT_FACE_BOUNDARY"),
    ("left_upper_cheek", "upper_cheek_boundary", "SOFT_FACE_BOUNDARY"),
    ("left_temple", "temple_boundary", "SOFT_FACE_BOUNDARY"),
    ("left_hairline_interface", "hard_template_boundary", "HARD_TEMPLATE_BOUNDARY"),
    ("left_upper_forehead", "hard_template_boundary", "HARD_TEMPLATE_BOUNDARY"),
)


def _verify_bundled_model() -> None:
    try:
        resource = importlib.resources.files("mediapipe").joinpath(
            "modules/face_landmark/face_landmark.tflite"
        )
        digest = hashlib.sha256(resource.read_bytes()).hexdigest()
    except Exception as exc:
        raise RuntimeError(f"bundled MediaPipe face model is unavailable: {exc}") from exc
    if digest != MODEL_SHA256:
        raise RuntimeError(
            "bundled MediaPipe face model checksum mismatch: "
            f"expected {MODEL_SHA256}, got {digest}"
        )


def _resample_closed(points: np.ndarray, count: int) -> np.ndarray:
    values = np.asarray(points, dtype=np.float32)
    if len(values) < 3:
        raise ValueError("closed landmark contour needs at least three points")
    closed = np.concatenate([values, values[:1]], axis=0)
    lengths = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    cumulative = np.concatenate([[0.0], np.cumsum(lengths)])
    total = float(cumulative[-1])
    samples = np.linspace(0.0, total, count, endpoint=False)
    output = []
    for sample in samples:
        segment = max(
            0,
            min(len(lengths) - 1, int(np.searchsorted(cumulative, sample, side="right") - 1)),
        )
        fraction = (sample - cumulative[segment]) / max(float(lengths[segment]), 1e-6)
        output.append(closed[segment] + (closed[segment + 1] - closed[segment]) * fraction)
    return np.asarray(output, dtype=np.float32)


def _pixels(face_landmarks, width: int, height: int) -> np.ndarray:
    return np.asarray(
        [(float(point.x) * width, float(point.y) * height) for point in face_landmarks],
        dtype=np.float32,
    )


def _side_point(
    oval: np.ndarray,
    midpoint_x: float,
    target_y: float,
    side: str,
    scale: float,
) -> np.ndarray:
    candidates = oval[oval[:, 0] < midpoint_x] if side == "left" else oval[oval[:, 0] >= midpoint_x]
    if len(candidates) == 0:
        raise ValueError(f"no {side} face-oval candidates")
    vertical = np.abs(candidates[:, 1] - target_y)
    outer = midpoint_x - candidates[:, 0] if side == "left" else candidates[:, 0] - midpoint_x
    score = vertical / max(scale, 1.0) - outer * 0.001
    return candidates[int(np.argmin(score))]


def _quality_score(points: np.ndarray, face_box) -> float:
    if not np.isfinite(points).all():
        return 0.0
    oval = points[list(_FACE_OVAL)]
    oval_min = oval.min(axis=0)
    oval_max = oval.max(axis=0)
    oval_width = float(oval_max[0] - oval_min[0])
    oval_height = float(oval_max[1] - oval_min[1])
    if oval_width < 20 or oval_height < 20:
        return 0.0
    face_center = np.asarray(face_box.center, dtype=np.float32)
    oval_center = (oval_min + oval_max) * 0.5
    center_error = float(np.linalg.norm(oval_center - face_center))
    center_score = max(0.0, 1.0 - center_error / max(face_box.width, face_box.height))
    coverage = min(1.0, oval_width / max(face_box.width * 0.55, 1.0))
    coverage *= min(1.0, oval_height / max(face_box.height * 0.55, 1.0))
    return float(np.clip(center_score * coverage, 0.0, 1.0))


def _make_semantic_72(points: np.ndarray) -> DenseLandmarks:
    eye_values = [points[list(group)] for group in _EYE_GROUPS]
    eye_centers = [values.mean(axis=0) for values in eye_values]
    left_eye_index, right_eye_index = sorted(range(2), key=lambda index: eye_centers[index][0])
    left_eye = eye_values[left_eye_index]
    right_eye = eye_values[right_eye_index]

    brow_values = [points[list(group)] for group in _BROW_GROUPS]
    brow_centers = [values.mean(axis=0) for values in brow_values]
    left_brow_index, right_brow_index = sorted(range(2), key=lambda index: brow_centers[index][0])
    left_brow = brow_values[left_brow_index]
    right_brow = brow_values[right_brow_index]

    left_eye_center = left_eye.mean(axis=0)
    right_eye_center = right_eye.mean(axis=0)
    eye_midpoint = (left_eye_center + right_eye_center) * 0.5
    eye_distance = float(np.linalg.norm(right_eye_center - left_eye_center))
    if eye_distance < 8.0:
        raise ValueError("detected inter-eye distance is too small")
    eye_y = float((left_eye_center[1] + right_eye_center[1]) * 0.5)

    nose_tip = points[1]
    mouth_center = (points[13] + points[14]) * 0.5
    oval = points[list(_FACE_OVAL)]
    chin = oval[np.argmax(oval[:, 1])]
    scale = max(eye_distance, 1.0)

    point_map: dict[str, np.ndarray] = {}
    group_map: dict[str, str] = {}

    def add(name: str, value, group: str) -> None:
        point_map[name] = np.asarray(value, dtype=np.float32)
        group_map[name] = group

    add("left_eye_center", left_eye_center, "eyes")
    add("right_eye_center", right_eye_center, "eyes")
    add("nose_tip", nose_tip, "nose")
    add("mouth_center", mouth_center, "mouth")
    add("chin", chin, "chin")

    for side, values in (("left", left_eye), ("right", right_eye)):
        for index, value in enumerate(values):
            add(f"{side}_eye_{index:02d}", value, "eyes")
    for side, values in (("left", left_brow), ("right", right_brow)):
        values = values[np.argsort(values[:, 0])]
        for index, value in enumerate(values):
            add(f"{side}_brow_{index:02d}", value, "eyebrows")

    bridge = points[list(_NOSE_BRIDGE)]
    bridge = bridge[np.argsort(bridge[:, 1])]
    for index, value in enumerate(bridge):
        add(f"nose_bridge_{index:02d}", value, "nose")
    wings = points[list(_NOSE_WINGS)]
    wings = wings[np.argsort(wings[:, 0])]
    add("nose_wing_left", wings[0], "nose")
    add("nose_wing_right", wings[1], "nose")

    mouth = _resample_closed(points[list(_MOUTH_CONTOUR)], 8)
    for index, value in enumerate(mouth):
        add(f"mouth_{index:02d}", value, "mouth")

    mouth_y = float(mouth_center[1])
    chin_y = float(chin[1])
    cheek_targets = (
        eye_y + (mouth_y - eye_y) * 0.48,
        eye_y + (mouth_y - eye_y) * 0.72,
        mouth_y + (chin_y - mouth_y) * 0.35,
    )
    for side in ("left", "right"):
        for suffix, target_y in zip(("upper", "mid", "lower"), cheek_targets, strict=True):
            add(
                f"{side}_cheek_{suffix}",
                _side_point(oval, float(eye_midpoint[0]), target_y, side, scale),
                "cheeks",
            )

    jaw_targets = (
        mouth_y + (chin_y - mouth_y) * 0.25,
        mouth_y + (chin_y - mouth_y) * 0.50,
        mouth_y + (chin_y - mouth_y) * 0.75,
        mouth_y + (chin_y - mouth_y) * 0.96,
    )
    for side in ("left", "right"):
        for suffix, target_y in zip(("upper", "mid", "lower", "chin"), jaw_targets, strict=True):
            add(
                f"{side}_jaw_{suffix}",
                _side_point(oval, float(eye_midpoint[0]), target_y, side, scale),
                "jaw",
            )

    boundary = _resample_closed(oval, 14)
    for index, value in enumerate(boundary):
        add(f"inner_boundary_{index:02d}", value, "inner_boundary")
    return DenseLandmarks(point_map, group_map)


def _make_semantic_166(points: np.ndarray, soft_boundary: bool = False) -> DenseLandmarks:
    point_map: dict[str, np.ndarray] = {}
    group_map: dict[str, str] = {}

    def add(name: str, value, group: str) -> None:
        point_map[name] = np.asarray(value, dtype=np.float32)
        group_map[name] = group

    eye_values = [points[list(group)] for group in _DENSE_EYE_GROUPS]
    eye_centers = [values.mean(axis=0) for values in eye_values]
    left_index, right_index = sorted(range(2), key=lambda index: eye_centers[index][0])
    left_eye = eye_values[left_index]
    right_eye = eye_values[right_index]
    left_eye_center = left_eye.mean(axis=0)
    right_eye_center = right_eye.mean(axis=0)
    eye_distance = float(np.linalg.norm(right_eye_center - left_eye_center))
    if eye_distance < 8.0:
        raise ValueError("detected inter-eye distance is too small")

    add("left_eye_center", left_eye_center, "eyes")
    add("right_eye_center", right_eye_center, "eyes")
    add("nose_tip", points[1], "nose")
    add("mouth_center", (points[13] + points[14]) * 0.5, "mouth")
    add("chin", points[152], "chin")

    for side, values in (("left", left_eye), ("right", right_eye)):
        for index, value in enumerate(values):
            add(f"{side}_eye_{index:02d}", value, "eyes")

    brow_values = [points[list(group)] for group in _DENSE_BROW_GROUPS]
    brow_centers = [values.mean(axis=0) for values in brow_values]
    left_index, right_index = sorted(range(2), key=lambda index: brow_centers[index][0])
    for side, values in (("left", brow_values[left_index]), ("right", brow_values[right_index])):
        values = values[np.argsort(values[:, 0])]
        for index, value in enumerate(values):
            add(f"{side}_brow_{index:02d}", value, "eyebrows")

    for index, landmark_index in enumerate(_DENSE_NOSE):
        add(f"nose_feature_{index:02d}", points[landmark_index], "nose")
    for contour, indices in (("outer", _DENSE_MOUTH_OUTER), ("inner", _DENSE_MOUTH_INNER)):
        for index, landmark_index in enumerate(indices):
            add(f"mouth_{contour}_{index:02d}", points[landmark_index], "mouth")

    for group_name, index_groups in (("cheek", _DENSE_CHEEK_GROUPS), ("jaw", _DENSE_JAW_GROUPS)):
        values = [points[list(group)] for group in index_groups]
        centers = [group.mean(axis=0) for group in values]
        left_index, right_index = sorted(range(2), key=lambda index: centers[index][0])
        for side, side_values in (("left", values[left_index]), ("right", values[right_index])):
            side_values = side_values[np.argsort(side_values[:, 1])]
            for index, value in enumerate(side_values):
                add(f"{side}_{group_name}_{index:02d}", value, "cheeks" if group_name == "cheek" else "jaw")

    boundary = _resample_closed(points[list(_FACE_OVAL)], 19)
    for index, value in enumerate(boundary):
        group = BOUNDARY_SAMPLE_CLASSIFICATION[index][1] if soft_boundary else "inner_boundary"
        add(f"inner_boundary_{index:02d}", value, group)
    if len(point_map) != DENSE_SEMANTIC_COUNT:
        raise ValueError(f"dense semantic mesh expected {DENSE_SEMANTIC_COUNT} points, got {len(point_map)}")
    return DenseLandmarks(point_map, group_map)


def _make_dense(points: np.ndarray, mesh_profile: str) -> DenseLandmarks:
    if mesh_profile == "semantic_72":
        return _make_semantic_72(points)
    if mesh_profile == "semantic_166":
        return _make_semantic_166(points)
    if mesh_profile == "semantic_166_soft":
        return _make_semantic_166(points, soft_boundary=True)
    raise ValueError(f"unsupported semantic mesh profile '{mesh_profile}'")


def detect_real_dense_landmarks(
    image: np.ndarray,
    face_box,
    mesh_profile: str = "semantic_72",
) -> tuple[DenseLandmarks, dict[str, tuple[float, float]], dict]:
    """Run CPU MediaPipe Face Mesh and return semantic dense points.

    The Haar box remains a validation/reference signal only. It never creates
    landmark coordinates.
    """
    started = time.perf_counter()
    try:
        _verify_bundled_model()
        import mediapipe as mp
    except Exception as exc:
        from .errors import BasicLandmarksUnavailableError

        raise BasicLandmarksUnavailableError(
            f"BASIC_LANDMARK_FAILED: MediaPipe Face Mesh unavailable: {exc}"
        ) from exc

    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    try:
        with mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=2,
            refine_landmarks=True,
            min_detection_confidence=0.60,
            min_tracking_confidence=0.60,
        ) as mesh:
            result = mesh.process(rgb)
    except Exception as exc:
        from .errors import BasicLandmarksUnavailableError

        raise BasicLandmarksUnavailableError(
            f"BASIC_LANDMARK_FAILED: MediaPipe inference failed: {exc}"
        ) from exc

    faces = result.multi_face_landmarks or []
    from .errors import BasicFaceNotFoundError, BasicMultipleFacesError, BasicLandmarksUnavailableError

    if len(faces) == 0:
        raise BasicFaceNotFoundError("BASIC_FACE_NOT_FOUND: no usable facial landmarks detected")
    if len(faces) > 1:
        raise BasicMultipleFacesError(
            f"BASIC_MULTIPLE_FACES: MediaPipe detected {len(faces)} faces"
        )

    try:
        values = _pixels(faces[0].landmark, image.shape[1], image.shape[0])
        quality = _quality_score(values, face_box)
        if quality < 0.35:
            raise ValueError(f"landmark geometry quality {quality:.3f} is below threshold")
        dense = _make_dense(values, mesh_profile)
    except Exception as exc:
        raise BasicLandmarksUnavailableError(
            f"BASIC_LANDMARK_FAILED: unusable landmark geometry: {exc}"
        ) from exc

    anchors = {
        "left_eye": tuple(float(value) for value in dense.points["left_eye_center"]),
        "right_eye": tuple(float(value) for value in dense.points["right_eye_center"]),
        "nose": tuple(float(value) for value in dense.points["nose_tip"]),
        "mouth": tuple(float(value) for value in dense.points["mouth_center"]),
        "chin": tuple(float(value) for value in dense.points["chin"]),
    }
    metadata = {
        "backend": "mediapipe_face_mesh",
        "model": f"mediapipe-face-mesh-{MEDIAPIPE_VERSION}",
        "model_sha256": MODEL_SHA256,
        "detected_landmark_count": int(len(faces[0].landmark)),
        "mesh_profile": mesh_profile,
        "quality_score": round(quality, 4),
        "inference_ms": round((time.perf_counter() - started) * 1000.0, 3),
    }
    if mesh_profile in {"semantic_166", "semantic_166_soft"}:
        oval = values[list(_FACE_OVAL)]
        audit = []
        for index, (semantic_region, _, recommended_class) in enumerate(BOUNDARY_SAMPLE_CLASSIFICATION):
            point = dense.points[f"inner_boundary_{index:02d}"]
            nearest = int(np.argmin(np.linalg.norm(oval - point, axis=1)))
            audit.append({
                "control": f"inner_boundary_{index:02d}",
                "mediapipe_landmark_index": int(_FACE_OVAL[nearest]),
                "semantic_region": semantic_region,
                "current_class": "HARD_TEMPLATE_BOUNDARY",
                "recommended_class": recommended_class,
            })
        metadata["boundary_audit"] = audit
    return dense, anchors, metadata
