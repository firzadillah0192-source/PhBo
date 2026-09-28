"""Experimental local face detection and landmark estimation.

OpenCV's bundled Haar cascade supplies the face detection. The five-point
landmarks are deliberately geometric estimates from the detected face box;
this keeps the engine local and deterministic while the project evaluates a
heavier landmark model for a later iteration.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import cv2

from .errors import (
    BasicFaceNotFoundError,
    BasicLandmarksUnavailableError,
    BasicMultipleFacesError,
)


@dataclass(frozen=True)
class FaceBox:
    x: int
    y: int
    width: int
    height: int

    @property
    def center(self) -> tuple[float, float]:
        return (self.x + self.width / 2, self.y + self.height / 2)

    @property
    def x2(self) -> int:
        return self.x + self.width

    @property
    def y2(self) -> int:
        return self.y + self.height


@dataclass(frozen=True)
class FaceLandmarks:
    left_eye: tuple[float, float]
    right_eye: tuple[float, float]
    nose: tuple[float, float]
    left_mouth: tuple[float, float]
    right_mouth: tuple[float, float]

    @property
    def mouth_center(self) -> tuple[float, float]:
        return (
            (self.left_mouth[0] + self.right_mouth[0]) / 2,
            (self.left_mouth[1] + self.right_mouth[1]) / 2,
        )

    @property
    def chin(self) -> tuple[float, float]:
        # The detector box is used only for this diagnostic/jaw taper point;
        # chin is deliberately excluded from transform estimation.
        mouth_y = self.mouth_center[1]
        eye_y = (self.left_eye[1] + self.right_eye[1]) / 2
        return (self.nose[0], mouth_y + (mouth_y - eye_y) * 0.76)

    def alignment_array(self):
        import numpy as np

        return np.array(
            [self.left_eye, self.right_eye, self.nose, self.mouth_center],
            dtype=np.float32,
        )

    def named_points(self) -> dict[str, tuple[float, float]]:
        return {
            "left_eye": self.left_eye,
            "right_eye": self.right_eye,
            "nose": self.nose,
            "mouth": self.mouth_center,
            "chin": self.chin,
        }

    def as_array(self):
        import numpy as np

        return np.array(
            [self.left_eye, self.right_eye, self.nose, self.left_mouth, self.right_mouth],
            dtype=np.float32,
        )


def detect_exactly_one_face(image) -> FaceBox:
    if image is None or image.size == 0:
        raise BasicFaceNotFoundError("BASIC_FACE_NOT_FOUND: input image is empty")
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(
        str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
    )
    if cascade.empty():
        raise BasicLandmarksUnavailableError("BASIC_LANDMARKS_UNAVAILABLE: face cascade is unavailable")
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(64, 64))
    if len(faces) != 1:
        # Haar is a useful fast proposal, but its boxes can miss or spuriously
        # duplicate a single face. Reconcile only disagreements with the
        # MediaPipe Face Mesh detector already used immediately downstream.
        return _detect_one_face_with_mediapipe(image)
    x, y, width, height = [int(value) for value in faces[0]]
    return FaceBox(x, y, width, height)


def _detect_one_face_with_mediapipe(image) -> FaceBox:
    """Use the existing Face Mesh detector to resolve a Haar count mismatch."""
    try:
        import mediapipe as mp

        from .real_landmarks import _verify_bundled_model

        _verify_bundled_model()
    except Exception as exc:
        raise BasicLandmarksUnavailableError(
            "BASIC_LANDMARKS_UNAVAILABLE: MediaPipe face validation is unavailable"
        ) from exc

    try:
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        with mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=2,
            refine_landmarks=True,
            min_detection_confidence=0.60,
            min_tracking_confidence=0.60,
        ) as mesh:
            result = mesh.process(rgb)
    except Exception as exc:
        raise BasicLandmarksUnavailableError(
            "BASIC_LANDMARKS_UNAVAILABLE: MediaPipe face validation failed"
        ) from exc

    detected = result.multi_face_landmarks or []
    if not detected:
        raise BasicFaceNotFoundError("BASIC_FACE_NOT_FOUND: no face detected")
    if len(detected) != 1:
        raise BasicMultipleFacesError(
            f"BASIC_MULTIPLE_FACES: expected exactly one face, MediaPipe detected {len(detected)}"
        )

    height, width = image.shape[:2]
    points = [
        (float(landmark.x) * width, float(landmark.y) * height)
        for landmark in detected[0].landmark
        if math.isfinite(float(landmark.x)) and math.isfinite(float(landmark.y))
    ]
    if not points:
        raise BasicLandmarksUnavailableError(
            "BASIC_LANDMARKS_UNAVAILABLE: MediaPipe returned no usable face bounds"
        )
    x1 = max(0, min(width, math.floor(min(point[0] for point in points))))
    y1 = max(0, min(height, math.floor(min(point[1] for point in points))))
    x2 = max(0, min(width, math.ceil(max(point[0] for point in points))))
    y2 = max(0, min(height, math.ceil(max(point[1] for point in points))))
    if x2 - x1 < 32 or y2 - y1 < 32:
        raise BasicLandmarksUnavailableError(
            "BASIC_LANDMARKS_UNAVAILABLE: detected face is too small"
        )
    return FaceBox(x1, y1, x2 - x1, y2 - y1)


def estimate_landmarks(face: FaceBox) -> FaceLandmarks:
    if face.width < 32 or face.height < 32:
        raise BasicLandmarksUnavailableError(
            "BASIC_LANDMARKS_UNAVAILABLE: detected face is too small"
        )
    x, y, w, h = face.x, face.y, face.width, face.height
    return FaceLandmarks(
        left_eye=(x + 0.31 * w, y + 0.38 * h),
        right_eye=(x + 0.69 * w, y + 0.38 * h),
        nose=(x + 0.50 * w, y + 0.56 * h),
        left_mouth=(x + 0.35 * w, y + 0.74 * h),
        right_mouth=(x + 0.65 * w, y + 0.74 * h),
    )
