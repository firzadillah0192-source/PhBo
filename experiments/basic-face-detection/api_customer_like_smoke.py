#!/usr/bin/env python3
"""Upload one non-customer test portrait and enqueue a Basic job locally."""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path

import cv2
import httpx
import mediapipe as mp


def _detector_measurements(path: Path) -> tuple[dict[str, int], float, str | None]:
    from app.generation.basic.errors import BasicFaceNotFoundError, BasicMultipleFacesError
    from app.generation.basic.landmarks import detect_exactly_one_face
    from app.generation.basic.real_landmarks import detect_real_dense_landmarks

    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError("test fixture decode failed")
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
        mediapipe_count = len(
            mesh.process(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)).multi_face_landmarks or []
        )

    started = time.perf_counter()
    try:
        face_box = detect_exactly_one_face(image)
        detect_real_dense_landmarks(image, face_box)
        error_code = None
    except BasicFaceNotFoundError:
        error_code = "BASIC_FACE_NOT_FOUND"
    except BasicMultipleFacesError:
        error_code = "BASIC_MULTIPLE_FACES"
    return {"haar": int(haar_count), "mediapipe": int(mediapipe_count)}, round((time.perf_counter() - started) * 1000.0, 3), error_code


def _error_code(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    detail = body.get("detail") if isinstance(body, dict) else None
    return detail.get("error_code") if isinstance(detail, dict) else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--api", default="http://photobooth-api:8000")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    image_path = Path(args.image)

    counts, detector_ms, detector_error = _detector_measurements(image_path)
    record = {
        "job_id": None,
        "status": "UPLOAD_FAILED",
        "error_code": None,
        "detector_counts": counts,
        "timing_ms": {"detector_validation": detector_ms, "job_runtime": None, "request_to_terminal": None},
    }
    with httpx.Client(base_url=args.api, timeout=15.0) as client:
        with image_path.open("rb") as image_file:
            upload = client.post(
                "/api/uploads",
                files={"file": ("basic-smoke.jpg", image_file, "image/jpeg")},
            )
        if upload.status_code != 201:
            record["error_code"] = _error_code(upload)
        else:
            payload = upload.json()
            created = time.perf_counter()
            # Production guest cookies are Secure, so httpx correctly omits
            # them on this internal HTTP hop. Replay the cookie explicitly:
            # a real browser reaches the same API through the HTTPS proxy.
            guest_cookie = "; ".join(
                f"{cookie.name}={cookie.value}" for cookie in client.cookies.jar
            )
            session_headers = {"Cookie": guest_cookie} if guest_cookie else {}
            generation = client.post(
                "/api/generations",
                json={
                    "upload_id": payload["upload_id"],
                    "template_id": "sci-fi-space-commander-001",
                    "mode": "BASIC",
                },
                headers=session_headers,
            )
            if generation.status_code != 202:
                record["status"] = "GENERATION_SUBMIT_FAILED"
                record["error_code"] = _error_code(generation)
            else:
                record["job_id"] = generation.json()["job_id"]
                deadline = time.monotonic() + 60.0
                terminal = None
                while time.monotonic() < deadline:
                    status_response = client.get(
                        f"/api/generations/{record['job_id']}",
                        headers=session_headers,
                    )
                    if status_response.status_code != 200:
                        record["status"] = "STATUS_REQUEST_FAILED"
                        record["error_code"] = _error_code(status_response)
                        break
                    terminal = status_response.json()
                    record["status"] = terminal["state"]
                    record["error_code"] = terminal.get("error_code")
                    if terminal["state"] in {"COMPLETED", "FAILED"}:
                        started_at = terminal.get("started_at")
                        finished_at = terminal.get("finished_at")
                        if started_at and finished_at:
                            start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                            finish = datetime.fromisoformat(finished_at.replace("Z", "+00:00"))
                            record["timing_ms"]["job_runtime"] = round((finish - start).total_seconds() * 1000.0, 3)
                        break
                    time.sleep(1.0)
                record["timing_ms"]["request_to_terminal"] = round((time.perf_counter() - created) * 1000.0, 3)
                if terminal is None or terminal.get("state") not in {"COMPLETED", "FAILED"}:
                    record["status"] = "TIMEOUT"

    # The API job itself is the authoritative check; this field helps explain
    # whether the same fixture passed the detector before submission.
    record["detector_replay_error_code"] = detector_error
    Path(args.output).write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record))


if __name__ == "__main__":
    main()
