#!/usr/bin/env python3
"""Run the worker's current face detectors against non-private fixtures."""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps


PARAMETERS = {
    "opencv_haar": {
        "cascade": "haarcascade_frontalface_default.xml",
        "scale_factor": 1.1,
        "min_neighbors": 5,
        "min_size_px": [64, 64],
        "max_size": None,
        "confidence_available": False,
        "nms": "CascadeClassifier detectMultiScale internal rectangle grouping; no explicit NMS",
    },
    "mediapipe_face_mesh": {
        "static_image_mode": True,
        "max_num_faces": 2,
        "refine_landmarks": True,
        "min_detection_confidence": 0.60,
        "min_tracking_confidence": 0.60,
    },
}


def _rgb_array(image: Image.Image) -> np.ndarray:
    return np.asarray(image.convert("RGB"), dtype=np.uint8).copy()


def _save_fixture(
    folder: Path,
    fixture_id: str,
    image: Image.Image,
    expected_faces: int,
    source: str,
    transform: str,
    orientation: int | None = None,
) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{fixture_id}.jpg"
    exif = Image.Exif()
    if orientation is not None:
        exif[274] = orientation
    image.convert("RGB").save(path, format="JPEG", quality=94, exif=exif)
    return {
        "fixture_id": fixture_id,
        "path": path,
        "expected_face_count": expected_faces,
        "source": source,
        "transform": transform,
        "exif_orientation": orientation or 1,
    }


def _projective_proxy(base: Image.Image, kind: str) -> Image.Image:
    rgb = _rgb_array(base)
    height, width = rgb.shape[:2]
    # The crop encloses the face on the bundled frontal preview. This bounded
    # projective warp is a reproducible detector stress proxy, not a real pose.
    x1, y1 = int(width * 0.24), int(height * 0.17)
    x2, y2 = int(width * 0.78), int(height * 0.78)
    roi = rgb[y1:y2, x1:x2]
    roi_h, roi_w = roi.shape[:2]
    source = np.float32([[0, 0], [roi_w - 1, 0], [roi_w - 1, roi_h - 1], [0, roi_h - 1]])
    if kind == "yaw_proxy":
        destination = np.float32([
            [roi_w * 0.045, roi_h * 0.01],
            [roi_w - 1, 0],
            [roi_w * 0.96, roi_h - 1],
            [0, roi_h * 0.98],
        ])
    else:
        destination = np.float32([
            [roi_w * 0.015, 0],
            [roi_w - 1, roi_h * 0.035],
            [roi_w * 0.975, roi_h - 1],
            [0, roi_h * 0.965],
        ])
    matrix = cv2.getPerspectiveTransform(source, destination)
    warped = cv2.warpPerspective(roi, matrix, (roi_w, roi_h), borderMode=cv2.BORDER_REPLICATE)
    mask = np.zeros((roi_h, roi_w), dtype=np.uint8)
    cv2.ellipse(mask, (roi_w // 2, roi_h // 2), (int(roi_w * 0.49), int(roi_h * 0.49)), 0, 0, 360, 255, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=18).astype(np.float32)[..., None] / 255.0
    rgb[y1:y2, x1:x2] = np.rint(roi * (1.0 - mask) + warped * mask).astype(np.uint8)
    return Image.fromarray(rgb, "RGB")


def _mobile_portrait(grace: Image.Image) -> Image.Image:
    canvas = Image.new("RGB", (1200, 1600), (132, 141, 150))
    subject = ImageOps.contain(grace.convert("RGB"), (1120, 1480), Image.Resampling.LANCZOS)
    canvas.paste(subject, ((1200 - subject.width) // 2, (1600 - subject.height) // 2))
    return canvas


def make_fixtures(
    fixture_dir: Path,
    portrait_path: Path,
    template_path: Path,
    grace_path: Path,
) -> list[dict]:
    portrait = Image.open(portrait_path).convert("RGB")
    template = Image.open(template_path).convert("RGB")
    grace = Image.open(grace_path).convert("RGB")
    fixtures: list[dict] = []

    def add(fixture_id, image, count, source, transform, orientation=None):
        fixtures.append(_save_fixture(fixture_dir, fixture_id, image, count, source, transform, orientation))

    add("A_frontal_good_light", portrait, 1, "tracked preview portrait", "none")
    add("B_slight_yaw_proxy", _projective_proxy(portrait, "yaw_proxy"), 1, "tracked preview portrait", "synthetic 2D yaw-like projective warp; not a real head-pose capture")
    add("C_slight_pitch_proxy", _projective_proxy(portrait, "pitch_proxy"), 1, "tracked preview portrait", "synthetic 2D pitch-like projective warp; not a real head-pose capture")
    add("D_glasses", grace, 1, "Matplotlib bundled Grace Hopper sample photo", "original sample; eyeglasses present")
    add("E_darker_lighting", ImageEnhance.Brightness(portrait).enhance(0.42), 1, "tracked preview portrait", "brightness factor 0.42")
    add("F_partially_cropped", portrait.crop((420, 0, portrait.width, portrait.height)), 1, "tracked preview portrait", "left edge crops part of the visible face")

    small_canvas = Image.new("RGB", (1800, 1400), (85, 91, 99))
    small_subject = portrait.copy()
    small_subject.thumbnail((140, 140), Image.Resampling.LANCZOS)
    small_canvas.paste(small_subject, ((1800 - small_subject.width) // 2, (1400 - small_subject.height) // 2))
    add("G_small_face_large_image", small_canvas, 1, "tracked preview portrait", "face scaled to about 63px width in a 1800x1400 image")

    two = Image.new("RGB", (1600, 900), (190, 196, 202))
    first = ImageOps.contain(grace, (650, 780), Image.Resampling.LANCZOS)
    second = ImageOps.contain(portrait, (650, 650), Image.Resampling.LANCZOS)
    two.paste(first, (70, (900 - first.height) // 2))
    two.paste(second, (880, (900 - second.height) // 2))
    add("H_two_people", two, 2, "two bundled non-customer sample portraits", "side-by-side composite of two distinct people")

    zero = np.zeros((480, 640, 3), dtype=np.uint8)
    for y in range(zero.shape[0]):
        zero[y, :, 0] = 35 + (y * 80 // zero.shape[0])
        zero[y, :, 1] = 55 + (y * 90 // zero.shape[0])
        zero[y, :, 2] = 85 + (y * 100 // zero.shape[0])
    for offset in range(0, 640, 64):
        cv2.line(zero, (offset, 0), (640 - offset, 479), (150, 158, 170), 2)
    add("I_zero_people", Image.fromarray(zero, "RGB"), 0, "procedurally generated abstract background", "no people")

    mobile = _mobile_portrait(grace)
    add("J_exif_90_cw", mobile.transpose(Image.Transpose.ROTATE_90), 1, "Matplotlib bundled Grace Hopper sample photo", "stored pixels rotated; EXIF orientation 6 requests display rotation 90 clockwise", 6)
    add("J_exif_90_ccw", mobile.transpose(Image.Transpose.ROTATE_270), 1, "Matplotlib bundled Grace Hopper sample photo", "stored pixels rotated; EXIF orientation 8 requests display rotation 90 counter-clockwise", 8)
    add("J_exif_180", mobile.transpose(Image.Transpose.ROTATE_180), 1, "Matplotlib bundled Grace Hopper sample photo", "stored pixels rotated; EXIF orientation 3 requests display rotation 180", 3)
    add("K_mobile_portrait_like", mobile, 1, "Matplotlib bundled Grace Hopper sample photo", "1200x1600 JPEG portrait with EXIF orientation 1")
    add("L_busy_background", template, 1, "approved sci-fi-space-commander template", "original busy space / costume background")
    return fixtures


def _classification(expected: int, haar: int, mesh: int) -> str:
    if expected == 1 and haar == 0 and mesh == 1:
        return "FALSE NEGATIVE"
    if expected == 1 and haar > 1 and mesh == 1:
        return "FALSE POSITIVE"
    if expected == 0 and (haar > 0 or mesh > 0):
        return "FALSE POSITIVE"
    if expected > 1 and ((haar == 1 and mesh > 1) or (haar == 0 and mesh > 0)):
        return "FALSE NEGATIVE"
    if expected > 1 and haar > 1 and mesh == 1:
        return "MULTI-FACE AMBIGUITY"
    if expected == 1 and haar == 1 and mesh > 1:
        return "MULTI-FACE AMBIGUITY"
    if expected == haar == mesh:
        return "PASS"
    if expected == 1 and (haar == 0 or mesh == 0):
        return "FALSE NEGATIVE"
    return "UNKNOWN"


def _draw_sheet(records: list[dict], output: Path) -> None:
    columns, panel_w, panel_h, image_h = 4, 390, 360, 300
    rows = (len(records) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * panel_w, rows * panel_h), (22, 27, 36))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, record in enumerate(records):
        x = (index % columns) * panel_w
        y = (index // columns) * panel_h
        with Image.open(record["path"]) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
        image.thumbnail((panel_w - 16, image_h - 12), Image.Resampling.LANCZOS)
        px = x + (panel_w - image.width) // 2
        py = y + (image_h - image.height) // 2
        sheet.paste(image, (px, py))
        sx, sy = image.width / record["opencv_width"], image.height / record["opencv_height"]
        color = (54, 222, 153) if record["haar_count"] == record["expected_face_count"] else (255, 89, 94)
        for box in record["haar_boxes"]:
            bx, by, bw, bh = box["bbox_xywh"]
            draw.rectangle((px + bx * sx, py + by * sy, px + (bx + bw) * sx, py + (by + bh) * sy), outline=color, width=3)
        basic = record["basic_face_count_result"].replace("BASIC_", "")
        label = f'{record["fixture_id"]} | exp {record["expected_face_count"]} | Haar {record["haar_count"]} | MP {record["mediapipe_count"]} | Basic {basic}'
        draw.rectangle((x + 4, y + image_h + 2, x + panel_w - 4, y + panel_h - 3), fill=(22, 27, 36))
        draw.text((x + 10, y + image_h + 10), label, fill=(244, 247, 250), font=font)
        draw.text((x + 10, y + image_h + 27), record["classification"], fill=color, font=font)
    sheet.save(output, format="PNG", optimize=True)


def run(args) -> None:
    fixture_dir, output_dir = Path(args.fixtures).resolve(), Path(args.output).resolve()
    fixture_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    fixtures = make_fixtures(fixture_dir, Path(args.portrait), Path(args.template), Path(args.grace))
    cascade_path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
    cascade_started = time.perf_counter()
    cascade = cv2.CascadeClassifier(str(cascade_path))
    cascade_init_ms = (time.perf_counter() - cascade_started) * 1000.0
    mesh_started = time.perf_counter()
    mesh_context = mp.solutions.face_mesh.FaceMesh(**PARAMETERS["mediapipe_face_mesh"])
    mesh_init_ms = (time.perf_counter() - mesh_started) * 1000.0
    records = []
    try:
        for fixture in fixtures:
            started = time.perf_counter()
            raw_dims = None
            exif = 1
            with Image.open(fixture["path"]) as source_image:
                raw_dims = list(source_image.size)
                exif = int(source_image.getexif().get(274, 1))
            image = cv2.imread(str(fixture["path"]), cv2.IMREAD_COLOR)
            prep_ms = (time.perf_counter() - started) * 1000.0
            if image is None:
                raise RuntimeError(f"OpenCV could not decode fixture {fixture['fixture_id']}")
            height, width = image.shape[:2]
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            haar_started = time.perf_counter()
            boxes = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(64, 64))
            haar_ms = (time.perf_counter() - haar_started) * 1000.0
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            mesh_started = time.perf_counter()
            mesh_result = mesh_context.process(rgb)
            mesh_ms = (time.perf_counter() - mesh_started) * 1000.0
            mesh_faces = mesh_result.multi_face_landmarks or []
            box_records = []
            for box in boxes:
                x, y, w, h = [int(value) for value in box]
                box_records.append({
                    "bbox_xywh": [x, y, w, h],
                    "face_area_ratio": round((w * h) / max(width * height, 1), 8),
                    "confidence": None,
                })
            orientation_applied = None
            ignored_count = None
            if exif not in (1, 0):
                ignored = cv2.imread(str(fixture["path"]), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
                orientation_applied = bool(ignored is not None and (ignored.shape != image.shape or not np.array_equal(ignored, image)))
                if ignored is not None:
                    ignored_gray = cv2.cvtColor(ignored, cv2.COLOR_BGR2GRAY)
                    ignored_count = int(len(cascade.detectMultiScale(ignored_gray, scaleFactor=1.1, minNeighbors=5, minSize=(64, 64))))
            record = {
                "fixture_id": fixture["fixture_id"],
                "source": fixture["source"],
                "transform": fixture["transform"],
                "expected_face_count": fixture["expected_face_count"],
                "detected_face_count": int(len(boxes)),
                "haar_count": int(len(boxes)),
                "mediapipe_count": int(len(mesh_faces)),
                "haar_boxes": box_records,
                "image_dimensions_raw_pixels": raw_dims,
                "image_dimensions_after_opencv_imread": [width, height],
                "exif_orientation": exif,
                "opencv_applied_exif_orientation": orientation_applied,
                "haar_count_if_exif_ignored": ignored_count,
                "confidence_available": False,
                "preprocessing": "cv2.imread(IMREAD_COLOR); BGR to grayscale; no pre-detector resize or equalization",
                "preprocess_ms": round(prep_ms, 3),
                "haar_detection_ms": round(haar_ms, 3),
                "mediapipe_crosscheck_ms": round(mesh_ms, 3),
                "total_ms": round(prep_ms + haar_ms + mesh_ms, 3),
                "classification": (
                    "INPUT QUALITY ISSUE"
                    if fixture["fixture_id"] == "G_small_face_large_image" and len(mesh_faces) == 0
                    else _classification(fixture["expected_face_count"], len(boxes), len(mesh_faces))
                ),
                "legacy_haar_gate_result": (
                    "BASIC_FACE_NOT_FOUND" if len(boxes) == 0 else
                    "BASIC_MULTIPLE_FACES" if len(boxes) > 1 else
                    "BASIC_FACE_MESH_ACCEPTED" if len(mesh_faces) == 1 else
                    "BASIC_FACE_NOT_FOUND" if len(mesh_faces) == 0 else
                    "BASIC_MULTIPLE_FACES"
                ),
                "basic_face_count_result": (
                    "BASIC_FACE_NOT_FOUND" if len(mesh_faces) == 0 else
                    "BASIC_MULTIPLE_FACES" if len(mesh_faces) > 1 else
                    "BASIC_FACE_MESH_ACCEPTED"
                ),
                "expected_mediapipe_passes_after_reconciliation": 2 if len(boxes) != 1 and len(mesh_faces) == 1 else 1,
                "basic_processing_ms_estimate_after_reconciliation": round(
                    prep_ms + haar_ms + mesh_ms * (2 if len(boxes) != 1 and len(mesh_faces) == 1 else 1),
                    3,
                ),
                "path": fixture["path"],
                "opencv_width": width,
                "opencv_height": height,
            }
            records.append(record)
    finally:
        mesh_context.close()

    document = {
        "runtime": {
            "opencv_version": cv2.__version__,
            "numpy_version": np.__version__,
            "mediapipe_version": mp.__version__,
            "cpu_only": True,
            "haar_cascade_sha256": __import__("hashlib").sha256(cascade_path.read_bytes()).hexdigest(),
            "haar_initialization_ms": round(cascade_init_ms, 3),
            "mediapipe_initialization_ms": round(mesh_init_ms, 3),
        },
        "parameters": PARAMETERS,
        "method_note": "Raw Haar and MediaPipe counts are recorded independently. basic_face_count_result simulates the implemented reconciliation policy: if Haar is not exactly one, Face Mesh must report exactly one usable face; the downstream landmark pass still runs afterward.",
        "fixture_limitations": [
            "The two head-pose cases are synthetic 2D projective proxies, not captured yaw/pitch examples.",
            "This small matrix uses a few bundled/internal non-customer sources and cannot establish population-wide detector recall.",
            "OpenCV Haar does not expose per-box confidence through the production detectMultiScale call; confidence is null.",
        ],
        "fixtures": [{key: value for key, value in record.items() if key not in {"path", "opencv_width", "opencv_height"}} for record in records],
    }
    (output_dir / "detection-matrix.json").write_text(json.dumps(document, indent=2) + "\n")
    fields = ["fixture_id", "expected_face_count", "haar_count", "mediapipe_count", "legacy_haar_gate_result", "basic_face_count_result", "classification", "image_dimensions_raw_pixels", "image_dimensions_after_opencv_imread", "exif_orientation", "opencv_applied_exif_orientation", "haar_count_if_exif_ignored", "preprocess_ms", "haar_detection_ms", "mediapipe_crosscheck_ms", "total_ms", "basic_processing_ms_estimate_after_reconciliation", "haar_boxes"]
    with (output_dir / "detection-summary.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for record in records:
            writer.writerow({field: json.dumps(record[field], separators=(",", ":")) if isinstance(record[field], (list, dict)) else record[field] for field in fields})
    lines = ["# Basic face-detection matrix", "", "| Fixture | Expected | Haar | MediaPipe cross-check | Legacy result | Reconciled result | Classification | Time (ms) |", "|---|---:|---:|---:|---|---|---|---:|"]
    for record in records:
        lines.append(f'| {record["fixture_id"]} | {record["expected_face_count"]} | {record["haar_count"]} | {record["mediapipe_count"]} | {record["legacy_haar_gate_result"]} | {record["basic_face_count_result"]} | {record["classification"]} | {record["basic_processing_ms_estimate_after_reconciliation"]:.2f} |')
    lines.extend(["", "Per-box Haar confidence is unavailable from the production detectMultiScale call. See JSON for boxes, area ratios, resolution, preprocessing, orientation behavior, and timings.", ""])
    (output_dir / "detection-summary.md").write_text("\n".join(lines))
    _draw_sheet(records, output_dir / "detection-debug-sheet.png")
    print(json.dumps({"fixture_count": len(records), "haar_version": cv2.__version__, "mediapipe_version": mp.__version__, "outputs": ["detection-matrix.json", "detection-summary.csv", "detection-summary.md", "detection-debug-sheet.png"]}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--portrait", required=True)
    parser.add_argument("--template", required=True)
    parser.add_argument("--grace", required=True)
    parser.add_argument("--fixtures", required=True)
    parser.add_argument("--output", required=True)
    run(parser.parse_args())


if __name__ == "__main__":
    main()
