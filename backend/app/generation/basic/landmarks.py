"""Experimental local face detection and landmark estimation.

OpenCV's bundled Haar cascade supplies the face detection. The five-point
landmarks are deliberately geometric estimates from the detected face box;
this keeps the engine local and deterministic while the project evaluates a
heavier landmark model for a later iteration.
"""

from __future__ import annotations

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


@dataclass(frozen=True)
class FaceLandmarks:
    left_eye: tuple[float, float]
    right_eye: tuple[float, float]
    nose: tuple[float, float]
    left_mouth: tuple[float, float]
    right_mouth: tuple[float, float]

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
    if len(faces) == 0:
        raise BasicFaceNotFoundError("BASIC_FACE_NOT_FOUND: no face detected")
    if len(faces) != 1:
        raise BasicMultipleFacesError(
            f"BASIC_MULTIPLE_FACES: expected exactly one face, detected {len(faces)}"
        )
    x, y, width, height = [int(value) for value in faces[0]]
    return FaceBox(x, y, width, height)


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
