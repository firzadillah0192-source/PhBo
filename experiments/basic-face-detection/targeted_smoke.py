#!/usr/bin/env python3
"""Targeted CPU smoke cases for the deployed Basic face-count gate."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from unittest.mock import patch

import cv2
import mediapipe as mp
import numpy as np


class _ForcedCascade:
    def __init__(self, count: int):
        self.count = count

    def empty(self):
        return False

    def detectMultiScale(self, _gray, **_kwargs):
        if self.count == 0:
            return np.empty((0, 4), dtype=np.int32)
        return np.asarray([[20 + 90 * i, 20, 80, 80] for i in range(self.count)], dtype=np.int32)


def _raw_counts(image: np.ndarray) -> tuple[int, int]:
    cascade = cv2.CascadeClassifier(
        str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
    )
    haar_count = len(cascade.detectMultiScale(
        cv2.cvtColor(image, cv2.COLOR_BGR2GRAY),
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(64, 64),
    ))
    with mp.solutions.face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=2,
        refine_landmarks=True,
        min_detection_confidence=0.60,
        min_tracking_confidence=0.60,
    ) as mesh:
        result = mesh.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    return haar_count, len(result.multi_face_landmarks or [])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    from app.generation.basic import landmarks
    from app.generation.basic.errors import BasicFaceNotFoundError, BasicMultipleFacesError
    from app.generation.basic.real_landmarks import detect_real_dense_landmarks

    cases = [
        ("single_face", "D_glasses.jpg", None, 1, "ACCEPTED"),
        ("haar0_mediapipe1", "A_dark_haar0_mediapipe1.jpg", None, 1, "ACCEPTED"),
        ("haar2_mediapipe1", "A_frontal_good_light.jpg", None, 1, "ACCEPTED"),
        ("mediapipe0", "I_zero_people.jpg", None, 0, "BASIC_FACE_NOT_FOUND"),
        ("mediapipe2", "H_two_people.jpg", None, 2, "BASIC_MULTIPLE_FACES"),
    ]
    records = []
    for case, filename, forced_haar, expected_mp, expected_result in cases:
        image = cv2.imread(str(Path(args.fixtures) / filename), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError(f"non-customer fixture could not be decoded: {filename}")
        actual_haar, actual_mp = _raw_counts(image)
        started = time.perf_counter()
        result = "ACCEPTED"
        try:
            if forced_haar is None:
                face_box = landmarks.detect_exactly_one_face(image)
            else:
                with patch.object(
                    landmarks.cv2,
                    "CascadeClassifier",
                    side_effect=lambda _path: _ForcedCascade(forced_haar),
                ):
                    face_box = landmarks.detect_exactly_one_face(image)
            detect_real_dense_landmarks(image, face_box)
        except BasicFaceNotFoundError:
            result = "BASIC_FACE_NOT_FOUND"
        except BasicMultipleFacesError:
            result = "BASIC_MULTIPLE_FACES"
        except Exception as exc:
            result = f"TECHNICAL_ERROR:{type(exc).__name__}"
        records.append({
            "case": case,
            "fixture": filename,
            "actual_haar_count": actual_haar,
            "haar_count_used_by_case": actual_haar if forced_haar is None else forced_haar,
            "haar_count_forced_for_branch_coverage": forced_haar is not None,
            "actual_mediapipe_count": actual_mp,
            "expected_mediapipe_count": expected_mp,
            "expected_result": expected_result,
            "result": result,
            "processing_ms": round((time.perf_counter() - started) * 1000.0, 3),
            "pass": actual_mp == expected_mp and result == expected_result,
        })
    output = {
        "cpu_only": True,
        "non_customer_fixtures_only": True,
        "image_bytes_saved": False,
        "records": records,
        "all_pass": all(record["pass"] for record in records),
    }
    Path(args.output).write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"cases": len(records), "all_pass": output["all_pass"], "output": Path(args.output).name}))


if __name__ == "__main__":
    main()
