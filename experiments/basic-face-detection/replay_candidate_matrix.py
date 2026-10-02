#!/usr/bin/env python3
"""Run the candidate Basic detector and existing landmark gate on fixtures."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-app-root", required=True)
    parser.add_argument("--fixtures", required=True)
    parser.add_argument("--raw-matrix", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    sys.path.insert(0, str(Path(args.source_app_root).resolve()))
    from app.generation.basic.errors import (
        BasicFaceNotFoundError,
        BasicMultipleFacesError,
    )
    from app.generation.basic.landmarks import detect_exactly_one_face
    from app.generation.basic.real_landmarks import detect_real_dense_landmarks

    expected = {
        item["fixture_id"]: item["expected_face_count"]
        for item in json.loads(Path(args.raw_matrix).read_text())["fixtures"]
    }
    records = []
    for path in sorted(Path(args.fixtures).glob("*.jpg")):
        image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if image is None:
            records.append({"fixture_id": path.stem, "result": "DECODE_FAILED"})
            continue
        record = {
            "fixture_id": path.stem,
            "expected_face_count": expected.get(path.stem),
            "image_dimensions_after_opencv_imread": [int(image.shape[1]), int(image.shape[0])],
        }
        started = time.perf_counter()
        try:
            face_box = detect_exactly_one_face(image)
            record["face_count_gate"] = "ACCEPTED_ONE"
            record["face_box_xywh"] = [face_box.x, face_box.y, face_box.width, face_box.height]
        except BasicFaceNotFoundError:
            record["face_count_gate"] = "BASIC_FACE_NOT_FOUND"
            record["landmark_gate"] = "NOT_RUN"
            record["candidate_total_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
            records.append(record)
            continue
        except BasicMultipleFacesError:
            record["face_count_gate"] = "BASIC_MULTIPLE_FACES"
            record["landmark_gate"] = "NOT_RUN"
            record["candidate_total_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
            records.append(record)
            continue
        except Exception as exc:
            record["face_count_gate"] = "TECHNICAL_ERROR"
            record["error_type"] = type(exc).__name__
            record["landmark_gate"] = "NOT_RUN"
            record["candidate_total_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
            records.append(record)
            continue

        try:
            _, _, metadata = detect_real_dense_landmarks(image, face_box)
            record["landmark_gate"] = "ACCEPTED"
            record["landmark_quality_score"] = metadata["quality_score"]
            record["landmark_inference_ms"] = metadata["inference_ms"]
            record["candidate_result"] = "ACCEPTED"
        except BasicFaceNotFoundError:
            record["landmark_gate"] = "BASIC_FACE_NOT_FOUND"
            record["candidate_result"] = "BASIC_FACE_NOT_FOUND"
        except BasicMultipleFacesError:
            record["landmark_gate"] = "BASIC_MULTIPLE_FACES"
            record["candidate_result"] = "BASIC_MULTIPLE_FACES"
        except Exception as exc:
            record["landmark_gate"] = "TECHNICAL_ERROR"
            record["candidate_result"] = "TECHNICAL_ERROR"
            record["error_type"] = type(exc).__name__
        record["candidate_total_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
        records.append(record)

    output = {
        "purpose": "candidate detector and existing landmark validation only; no identity processing",
        "customer_images_used": False,
        "candidate_source_root": Path(args.source_app_root).name,
        "fixtures": records,
    }
    Path(args.output).write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"fixtures": len(records), "output": Path(args.output).name}, indent=2))


if __name__ == "__main__":
    main()
