import numpy as np
import pytest

from app.generation.basic import landmarks
from app.generation.basic.errors import (
    BasicFaceNotFoundError,
    BasicMultipleFacesError,
)


class _Cascade:
    def __init__(self, boxes):
        self.boxes = boxes

    def empty(self):
        return False

    def detectMultiScale(self, image, **kwargs):
        return self.boxes


@pytest.mark.parametrize(
    "haar_boxes",
    [np.empty((0, 4), dtype=np.int32), np.asarray([[10, 10, 90, 90], [200, 30, 70, 70]])],
)
def test_haar_count_mismatch_uses_single_mediapipe_face(monkeypatch, haar_boxes):
    image = np.zeros((320, 320, 3), dtype=np.uint8)
    expected = landmarks.FaceBox(72, 48, 160, 190)
    monkeypatch.setattr(landmarks.cv2, "CascadeClassifier", lambda _path: _Cascade(haar_boxes))
    calls = []

    def fallback(actual_image):
        calls.append(actual_image)
        return expected

    monkeypatch.setattr(landmarks, "_detect_one_face_with_mediapipe", fallback)

    assert landmarks.detect_exactly_one_face(image) == expected
    assert len(calls) == 1
    assert calls[0] is image


def test_one_haar_face_keeps_fast_path_without_media_pipe_fallback(monkeypatch):
    image = np.zeros((240, 240, 3), dtype=np.uint8)
    monkeypatch.setattr(
        landmarks.cv2,
        "CascadeClassifier",
        lambda _path: _Cascade(np.asarray([[35, 28, 120, 128]], dtype=np.int32)),
    )
    monkeypatch.setattr(
        landmarks,
        "_detect_one_face_with_mediapipe",
        lambda _image: pytest.fail("fallback should only run on a Haar count mismatch"),
    )

    assert landmarks.detect_exactly_one_face(image) == landmarks.FaceBox(35, 28, 120, 128)


@pytest.mark.parametrize(
    "error",
    [
        BasicFaceNotFoundError("BASIC_FACE_NOT_FOUND: no face detected"),
        BasicMultipleFacesError("BASIC_MULTIPLE_FACES: MediaPipe detected 2 faces"),
    ],
)
def test_haar_mismatch_still_requires_exactly_one_mediapipe_face(monkeypatch, error):
    image = np.zeros((240, 240, 3), dtype=np.uint8)
    monkeypatch.setattr(landmarks.cv2, "CascadeClassifier", lambda _path: _Cascade(np.empty((0, 4), dtype=np.int32)))

    def fallback(_image):
        raise error

    monkeypatch.setattr(landmarks, "_detect_one_face_with_mediapipe", fallback)
    with pytest.raises(type(error)):
        landmarks.detect_exactly_one_face(image)
