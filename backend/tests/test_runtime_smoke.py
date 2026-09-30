"""Smoke checks for the CPU-only image dependencies used in production."""

import pytest


def test_mediapipe_face_mesh_runs_with_headless_opencv():
    cv2 = pytest.importorskip("cv2")
    mediapipe = pytest.importorskip("mediapipe")
    numpy = pytest.importorskip("numpy")

    frame = numpy.zeros((192, 192, 3), dtype=numpy.uint8)
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    with mediapipe.solutions.face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.60,
    ) as mesh:
        result = mesh.process(rgb)

    # The synthetic frame intentionally contains no face. This proves the
    # MediaPipe graph initializes and executes with the image's pinned,
    # headless OpenCV runtime without depending on optional task packages.
    assert result.multi_face_landmarks is None
