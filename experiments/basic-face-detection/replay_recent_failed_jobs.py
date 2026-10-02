#!/usr/bin/env python3
"""Replay recent failed Basic face checks in memory; emit metadata only."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
from PIL import Image
from sqlalchemy import desc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-app-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    sys.path.insert(0, str(Path(args.source_app_root).resolve()))
    from app.db import SessionLocal
    from app.generation.basic.errors import (
        BasicFaceNotFoundError,
        BasicMultipleFacesError,
    )
    from app.generation.basic.landmarks import detect_exactly_one_face
    from app.generation.basic.real_landmarks import detect_real_dense_landmarks
    from app.models import GenerationJob

    db = SessionLocal()
    records = []
    try:
        jobs = (
            db.query(GenerationJob)
            .filter(
                GenerationJob.mode == "BASIC",
                GenerationJob.state == "FAILED",
                GenerationJob.error_code.in_(("BASIC_FACE_NOT_FOUND", "BASIC_MULTIPLE_FACES")),
            )
            .order_by(desc(GenerationJob.created_at))
            .limit(args.limit)
            .all()
        )
        for job in jobs:
            upload = job.upload
            record = {
                "created_at_utc": job.created_at.isoformat(),
                "job_id": job.id,
                "upload_id": upload.id if upload else None,
                "previous_failure_code": job.error_code,
                "customer_image_bytes_saved": False,
                "storage_path_output": False,
            }
            if not upload or not upload.storage_path or not Path(upload.storage_path).is_file():
                record["candidate_result"] = "UPLOAD_MISSING_OR_EXPIRED"
                records.append(record)
                continue
            try:
                with Image.open(upload.storage_path) as opened:
                    record["exif_orientation"] = int(opened.getexif().get(274, 1))
                    record["stored_image_dimensions"] = [int(opened.width), int(opened.height)]
                    record["format"] = opened.format
                image = cv2.imread(upload.storage_path, cv2.IMREAD_COLOR)
                if image is None:
                    record["candidate_result"] = "IMAGE_DECODE_FAILED"
                    records.append(record)
                    continue
                record["opencv_decoded_dimensions"] = [int(image.shape[1]), int(image.shape[0])]
                started = time.perf_counter()
                try:
                    face_box = detect_exactly_one_face(image)
                    record["candidate_face_count_result"] = "ACCEPTED_ONE"
                    _, _, metadata = detect_real_dense_landmarks(image, face_box)
                    record["candidate_result"] = "ACCEPTED"
                    record["landmark_quality_score"] = metadata["quality_score"]
                except BasicFaceNotFoundError:
                    record["candidate_result"] = "BASIC_FACE_NOT_FOUND"
                except BasicMultipleFacesError:
                    record["candidate_result"] = "BASIC_MULTIPLE_FACES"
                except Exception as exc:
                    record["candidate_result"] = "TECHNICAL_ERROR"
                    record["error_type"] = type(exc).__name__
                record["candidate_validation_ms"] = round((time.perf_counter() - started) * 1000.0, 3)
            except Exception as exc:
                record["candidate_result"] = "TRACE_ERROR"
                record["error_type"] = type(exc).__name__
            records.append(record)
    finally:
        db.close()

    Path(args.output).write_text(json.dumps({
        "purpose": "candidate source replay against recent failed uploads; all image reads were in-memory and local",
        "customer_image_bytes_saved": False,
        "storage_paths_output": False,
        "records": records,
    }, indent=2) + "\n")
    print(json.dumps({"records": len(records), "output": Path(args.output).name}, indent=2))


if __name__ == "__main__":
    main()
