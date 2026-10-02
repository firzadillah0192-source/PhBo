#!/usr/bin/env python3
"""Offline compositor ablation from frozen raw A; never runs face swap.

C5-C7 isolate broad photometric treatment. Run initial, inspect the sheet,
then balanced. All new artifacts go in a fresh subdirectory; prior POC stays
byte-identical. CPU detector/recognition checkpoints are local and guarded.
"""
from __future__ import annotations

import argparse
import json
import os
import resource
import socket
import time
from pathlib import Path

os.environ["NO_ALBUMENTATIONS_UPDATE"] = "1"


def _network_forbidden(*args, **kwargs):
    raise RuntimeError("POC_NETWORK_FORBIDDEN: local evaluation only")


# Also prevent an accidental library download/telemetry request.
socket.socket.connect = _network_forbidden
socket.socket.connect_ex = _network_forbidden
socket.create_connection = _network_forbidden

import compositor_iteration as base
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

DEST = base.OUTPUTS / "detail-round-2"
METRICS = DEST / "metrics.json"
NAMES = {
    "C5": "C5_no_harmonization_control.png",
    "C6": "C6_bounded_illumination.png",
    "C7": "C7_boundary_harmonization.png",
    "C8": "C8_balanced_detail.png",
}


def protected_hashes():
    paths = list(base.INPUTS.iterdir()) + [p for p in base.OUTPUTS.iterdir() if p.is_file()]
    paths += [base.REPO_ROOT / "backend/app/generation/basic" / name for name in
              ("engine.py", "blending.py", "landmarks.py", "errors.py")]
    return {str(p.relative_to(base.REPO_ROOT)): base.sha256_file(p) for p in paths if p.is_file()}


def validate_frozen():
    expected = json.loads(base.METRICS_PATH.read_text())["frozen_baseline_sha256"]
    for name, digest in expected.items():
        if base.sha256_file(base.EXPERIMENT_ROOT / name) != digest:
            raise RuntimeError("frozen artifact checksum mismatch: " + name)
    manifest = json.loads((base.OUTPUTS / "model_manifest.json").read_text())
    # Verify all existing checkpoints, including the swapper which is NOT loaded.
    for checkpoint in manifest["model_files"]:
        if "non-commercial research" not in checkpoint["license_status"].lower():
            raise RuntimeError("POC_BLOCKED_BY_MODEL_TERMS")
        path = base.EXPERIMENT_ROOT / checkpoint["path"]
        if not path.is_file() or base.sha256_file(path) != checkpoint["sha256"]:
            raise RuntimeError("required local checkpoint missing/changed: " + checkpoint["filename"])
    return manifest


def masks(images, metadata):
    meta = metadata["template"]
    region = tuple(meta["face_region"])
    polygon = tuple(tuple(point) for point in meta["mask_polygon"])
    _, current, binary = base.build_masks(images["template"].shape, region, polygon)
    wide = base.build_wider_lower_mask(images["template"].shape, region, polygon,
                                        current, binary, meta["face_anchors"])
    prior = json.loads(base.METRICS_PATH.read_text())["candidates"]
    assert base.mask_metrics(current)["active_mask_pixels"] == prior["C"]["active_mask_pixels"]
    assert base.mask_metrics(wide)["active_mask_pixels"] == prior["C4"]["active_mask_pixels"]
    return current, wide


def bounded_adjustment(template, raw, mask, mode):
    """Add a bounded smooth field; no replacement of raw facial frequency bands."""
    raw_lab = cv2.cvtColor(raw, cv2.COLOR_BGR2LAB).astype(np.float32)
    target_lab = cv2.cvtColor(template, cv2.COLOR_BGR2LAB).astype(np.float32)
    delta = cv2.GaussianBlur(target_lab, (0, 0), 18) - cv2.GaussianBlur(raw_lab, (0, 0), 18)
    if mode == "illumination":
        correction = np.zeros_like(raw_lab)
        correction[..., 0] = np.clip(delta[..., 0], -24, 24) * 0.30
    elif mode in {"boundary", "balanced"}:
        # Core stays exactly raw A; light/color influence rises only in feather.
        alpha = mask / max(float(mask.max()), 1e-6)
        edge = np.clip((0.82 - alpha) / 0.82, 0, 1)
        edge = edge * edge * (3 - 2 * edge)
        correction = np.clip(delta, (-20, -10, -10), (20, 10, 10))
        correction *= edge[..., None] * (0.60 if mode == "boundary" else 0.45)
    else:
        raise ValueError(mode)
    adjusted = cv2.cvtColor(np.clip(raw_lab + correction, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    # Avoid LAB round-trip changes where no correction was requested.
    untouched = np.all(correction == 0, axis=2)
    adjusted[untouched] = raw[untouched]
    return adjusted


def compose(template, raw, mask, mode):
    adjusted = raw if mode == "raw" else bounded_adjustment(template, raw, mask, mode)
    return base.composite(template, adjusted, mask)


def contact_sheet(app, labels, face_crops, phase):
    width, height, caption = (256, 256, 42) if face_crops else (300, 450, 42)
    sheet = Image.new("RGB", (width * 4, (height + caption) * 3), (10, 13, 20))
    draw = ImageDraw.Draw(sheet)
    for index, (label, path) in enumerate(labels):
        x, y = (index % 4) * width, (index // 4) * (height + caption)
        if face_crops:
            data = base.read_image(path)
            face = base.exactly_one_face(app, data, label)
            crop = base.norm_crop(data, face.kps, image_size=256, mode="arcface")
            image = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        else:
            image = ImageOps.contain(Image.open(path).convert("RGB"), (width, height), Image.Resampling.LANCZOS)
        sheet.paste(image, (x + (width-image.width)//2, y + (height-image.height)//2))
        draw.text((x+8, y+height+10), label, fill="white", font=ImageFont.load_default())
    name = "face-crops-review.png" if face_crops else "full-image-review.png"
    if phase == "balanced":
        name = "balanced-" + name
    sheet.save(DEST / name)


def run(phase):
    validate_frozen()
    before = protected_hashes()
    _, images, metadata = base.load_frozen()
    started = time.perf_counter()
    current, wide = masks(images, metadata)
    preprocessing_ms = (time.perf_counter()-started)*1000
    if phase == "initial":
        if DEST.exists():
            raise FileExistsError("refusing to overwrite prior detail-round-2")
        DEST.mkdir()
        report = {"protected_sha256": before, "variants": {}, "phase": "initial",
                  "scope": "compositor only; frozen fixture, not recent customer photo",
                  "license": "NON-COMMERCIAL RESEARCH / EVALUATION ONLY",
                  "no_network": True, "no_swap_inference": True,
                  "no_restoration_or_sharpening": True}
        configs = [("C5", current, "raw"), ("C6", current, "illumination"), ("C7", current, "boundary")]
    else:
        report = json.loads(METRICS.read_text())
        if report["phase"] != "initial" or report["protected_sha256"] != before:
            raise RuntimeError("initial phase or frozen artifacts changed")
        # Widen lower cheek/jaw using the already reviewed C4 support, boost
        # its core from alpha .94 to 1, and keep only bounded boundary correction.
        configs = [("C8", np.clip(wide / float(wide.max()), 0, 1), "balanced")]
    app, sessions, init_ms = base.create_face_app()
    user_face, template_face = base.detect_embeddings(app, images["user"], images["template"])
    for label, mask, mode in configs:
        path = DEST / NAMES[label]
        if path.exists():
            raise FileExistsError(path.name)
        durations = []
        for _ in range(4):  # one first compositor call + three warm calls only
            start = time.perf_counter()
            candidate = compose(images["template"], images["A"], mask, mode)
            durations.append((time.perf_counter()-start)*1000)
        metric = base.candidate_report(app, user_face.normed_embedding, template_face.normed_embedding,
            images["user"], images["template"], candidate, mask,
            round(float(np.median(durations[1:])), 2),
            round(preprocessing_ms + float(np.median(durations[1:])), 2), round(preprocessing_ms, 2))
        assert metric["changed_pixels_outside_intended_mask"] == 0
        metric.update({"first_compositor_ms": round(durations[0], 2),
                       "warm_compositor_runs_ms": [round(v, 2) for v in durations[1:]],
                       "method": mode, "cold_swap_inference": "not rerun; frozen raw A"})
        report["variants"][label] = metric
        if not cv2.imwrite(str(path), candidate):
            raise RuntimeError("output write failed")
        base.mask_debug_image(images["template"], mask, label + " - " + mode, DEST/(label+"_mask_debug.png"))
        np.save(DEST/(label+"_mask.npy"), mask)
    report["runtime"] = {"face_analysis_init_ms": init_ms, "providers": sessions,
        "peak_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024, 1)}
    report["phase"] = phase
    report["status"] = "READY FOR HUMAN REVIEW"
    labels = [("USER (FROZEN FIXTURE)", base.INPUTS/"user_photo.jpg"),
              ("TEMPLATE", base.INPUTS/"template.png"), ("V1", base.OUTPUTS/"V1_reference.png"),
              ("RAW A", base.OUTPUTS/"A_raw_faceswap.png"), ("CURRENT C", base.OUTPUTS/"C_faceswap_plus_compositor.png"),
              ("C3", base.OUTPUTS/"C3_frequency_identity.png"), ("C4", base.OUTPUTS/"C4_balanced_candidate.png")]
    labels += [(label+" "+report["variants"][label]["method"], DEST/NAMES[label]) for label in report["variants"]]
    contact_sheet(app, labels, True, phase)
    contact_sheet(app, labels, False, phase)
    if protected_hashes() != before:
        raise RuntimeError("frozen inputs, prior outputs or V1 source changed")
    destination = METRICS if phase == "initial" else DEST / "balanced-metrics.json"
    if destination.exists():
        raise FileExistsError(destination.name)
    base.write_json(destination, report)
    print(json.dumps({"status": report["status"], "phase": phase, "variants": report["variants"], "runtime": report["runtime"]}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=["initial", "balanced"])
    run(parser.parse_args().phase)
