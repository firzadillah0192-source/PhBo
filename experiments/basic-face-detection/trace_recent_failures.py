#!/usr/bin/env python3
"""Trace recent Basic detection failures without retaining customer images."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import cv2
import mediapipe as mp
from PIL import Image
from sqlalchemy import desc

sys.path.insert(0, "/app")

from app.db import SessionLocal
from app.models import GenerationJob


def run(output_path: str) -> None:
    db = SessionLocal()
    records = []
    detector_cache = {}
    cascade = cv2.CascadeClassifier(str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"))
    jobs = db.query(GenerationJob).filter(
        GenerationJob.mode == "BASIC",
        GenerationJob.state == "FAILED",
    ).order_by(desc(GenerationJob.created_at)).limit(10).all()
    try:
        for job in jobs:
            upload = job.upload
            result = {
                "created_at_utc": job.created_at.isoformat(),
                "job_id": job.id,
                "upload_id": upload.id if upload else None,
                "failure_code": job.error_code,
                "stored_image_dimensions": [upload.width, upload.height] if upload else None,
                "format": upload.format if upload else None,
                "content_type": upload.content_type if upload else None,
                "exif_orientation": None,
                "opencv_decoded_dimensions": None,
                "opencv_applied_exif_orientation": None,
                "haar_detected_count": None,
                "mediapipe_crosscheck_count": None,
                "classification": "UNKNOWN",
                "note": None,
            }
            if not upload or job.error_code not in {"BASIC_FACE_NOT_FOUND", "BASIC_MULTIPLE_FACES"}:
                result["note"] = "Face detector was not the recorded failure stage."
                records.append(result)
                continue
            cached = detector_cache.get(upload.id)
            if cached is not None:
                result.update(cached)
            elif upload.storage_path and Path(upload.storage_path).is_file():
                try:
                    with Image.open(upload.storage_path) as image_file:
                        result["exif_orientation"] = int(image_file.getexif().get(274, 1))
                except Exception:
                    result["exif_orientation"] = "unreadable"
                image = cv2.imread(upload.storage_path, cv2.IMREAD_COLOR)
                if image is not None:
                    height, width = image.shape[:2]
                    result["opencv_decoded_dimensions"] = [width, height]
                    orientation = result["exif_orientation"]
                    if orientation not in (None, 0, 1, "unreadable"):
                        ignored = cv2.imread(upload.storage_path, cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
                        result["opencv_applied_exif_orientation"] = bool(
                            ignored is not None and (ignored.shape != image.shape or not (ignored == image).all())
                        )
                    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
                    haar_count = int(len(cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(64, 64))))
                    with mp.solutions.face_mesh.FaceMesh(
                        static_image_mode=True,
                        max_num_faces=2,
                        refine_landmarks=True,
                        min_detection_confidence=0.60,
                        min_tracking_confidence=0.60,
                    ) as mesh:
                        mesh_result = mesh.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
                    mesh_count = int(len(mesh_result.multi_face_landmarks or []))
                    cached = {
                        "exif_orientation": result["exif_orientation"],
                        "opencv_decoded_dimensions": result["opencv_decoded_dimensions"],
                        "opencv_applied_exif_orientation": result["opencv_applied_exif_orientation"],
                        "haar_detected_count": haar_count,
                        "mediapipe_crosscheck_count": mesh_count,
                    }
                    detector_cache[upload.id] = cached
                    result.update(cached)
                else:
                    cached = {"haar_detected_count": None, "mediapipe_crosscheck_count": None}
                    detector_cache[upload.id] = cached
                    result.update(cached)
            else:
                cached = {"haar_detected_count": None, "mediapipe_crosscheck_count": None}
                detector_cache[upload.id] = cached
                result.update(cached)
            if result["haar_detected_count"] == 0 and result["mediapipe_crosscheck_count"] == 1:
                result["classification"] = "FALSE NEGATIVE"
                result["note"] = "Haar rejected while the independent MediaPipe cross-check found one face; no visual review was performed."
            elif result["haar_detected_count"] == 2 and result["mediapipe_crosscheck_count"] == 1:
                result["classification"] = "MULTI-FACE AMBIGUITY"
                result["note"] = "Haar found two boxes but MediaPipe found one; a second human face cannot be ruled out without visual review."
            elif result["haar_detected_count"] is None:
                result["classification"] = "UNKNOWN"
                result["note"] = "Temporary upload bytes are unavailable or unreadable."
            else:
                result["note"] = "The two detector results do not establish a single cause."
            records.append(result)
        Path(output_path).write_text(json.dumps({
            "lookback": "10 latest failed BASIC jobs",
            "customer_image_bytes_saved": False,
            "customer_storage_paths_output": False,
            "opencv_version": cv2.__version__,
            "mediapipe_version": mp.__version__,
            "records": records,
        }, indent=2) + "\n")
    finally:
        db.close()
    print(json.dumps({"records": len(records), "output_file": Path(output_path).name, "customer_image_bytes_saved": False}))


if __name__ == "__main__":
    run(sys.argv[1])
