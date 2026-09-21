"""Face alignment, color harmonization, and soft compositing helpers."""

from __future__ import annotations

import cv2
import numpy as np


def align_face(source, source_points, target_points, size):
    matrix, _ = cv2.estimateAffinePartial2D(source_points, target_points, method=cv2.LMEDS)
    if matrix is None:
        raise ValueError("could not estimate face alignment transform")
    return cv2.warpAffine(
        source,
        matrix,
        size,
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REFLECT_101,
    )


def soft_face_mask(size, region):
    width, height = size
    mask = np.zeros((height, width), dtype=np.float32)
    x, y, region_width, region_height = region
    center = (int(x + region_width / 2), int(y + region_height * 0.50))
    axes = (max(1, int(region_width * 0.47)), max(1, int(region_height * 0.52)))
    cv2.ellipse(mask, center, axes, 0, 0, 360, 1.0, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=max(4.0, region_width * 0.035))
    return np.clip(mask, 0.0, 1.0)


def harmonize_color(source, target, mask):
    """Match source face mean/std to nearby target pixels without flattening detail."""
    source_float = source.astype(np.float32)
    target_float = target.astype(np.float32)
    active = mask > 0.55
    if int(active.sum()) < 100:
        return source
    source_pixels = source_float[active]
    target_pixels = target_float[active]
    source_mean = source_pixels.mean(axis=0)
    source_std = np.maximum(source_pixels.std(axis=0), 1.0)
    target_mean = target_pixels.mean(axis=0)
    target_std = np.maximum(target_pixels.std(axis=0), 1.0)
    adjusted = (source_float - source_mean) * (target_std / source_std) + target_mean
    return np.clip(adjusted, 0, 255).astype(np.uint8)


def composite(template, aligned_face, mask):
    alpha = mask[..., None]
    result = aligned_face.astype(np.float32) * alpha + template.astype(np.float32) * (1 - alpha)
    return np.clip(result, 0, 255).astype(np.uint8)
