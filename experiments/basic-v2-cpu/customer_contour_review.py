#!/usr/bin/env python3
"""Offline lower-face compositor ablation; frozen raw customer swap only."""
import json
import resource
import time
from pathlib import Path
import customer_faceswap_review as customer
import numpy as np
import cv2
base, detail, ROOT = customer.base, customer.detail, customer.ROOT


def lower_contour_mask(existing, meta):
    height, width = existing.shape
    polygon = np.asarray(meta['mask_polygon'], dtype=np.float32)
    binary = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(binary, [np.rint(polygon).astype(np.int32)], 255)
    expanded = cv2.dilate(binary, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (43, 17)))
    contour = base.face_mask_from_binary(expanded, tuple(meta['face_region']))
    contour /= max(float(contour.max()), 1e-6)
    anchors = meta['face_anchors']
    eye_y = (anchors['left_eye'][1] + anchors['right_eye'][1]) / 2
    start, end = eye_y + 12, anchors['mouth'][1]
    y = np.arange(height, dtype=np.float32)[:, None]
    t = np.clip((y - start) / max(end - start, 1), 0, 1)
    gate = np.broadcast_to(t*t*(3-2*t), (height, width)).copy()
    x, _, w, _ = meta['face_region']
    gate[:, :int(round(x+w*0.065))] = 0
    gate[:, int(round(x+w*0.935)):] = 0
    gate[int(np.max(polygon[:, 1]))+7:, :] = 0
    return np.clip(existing + np.maximum(contour-existing, 0)*gate, 0, 1).astype(np.float32)


def run():
    if (ROOT/'contour-metrics.json').exists():
        raise FileExistsError('refusing to overwrite prior review')
    detail.validate_frozen()
    before = customer.frozen_hashes()
    protected = {p: base.sha256_file(p) for p in ROOT.iterdir() if p.is_file()}
    meta = json.loads((customer.INPUT/'template.json').read_text())
    user = base.read_image(customer.INPUT/'source.image')
    template = base.read_image(customer.INPUT/'template.image')
    raw = base.read_image(ROOT/'A_raw_customer.png')
    current = np.load(ROOT/'C8_mask.npy')
    start = time.perf_counter()
    mask = lower_contour_mask(current, meta)
    preprocessing_ms = (time.perf_counter()-start)*1000
    app, sessions, init_ms = base.create_face_app()
    source_face, target_face = base.detect_embeddings(app, user, template)
    candidates = {}
    for label, mode, name in [('C9', 'raw', 'C9_raw_lower_contour.png'), ('C10', 'balanced', 'C10_lower_contour_boundary.png')]:
        if (ROOT/name).exists():
            raise FileExistsError(name)
        durations, first = [], None
        for _ in range(4):
            start = time.perf_counter()
            result = detail.compose(template, raw, mask, mode)
            durations.append((time.perf_counter()-start)*1000)
            if first is None:
                first = result.copy()
            else:
                assert np.array_equal(first, result)
        comp_ms = float(np.median(durations[1:]))
        metric = base.candidate_report(app, source_face.normed_embedding, target_face.normed_embedding,
            user, template, result, mask, round(comp_ms, 2), round(preprocessing_ms+comp_ms, 2), round(preprocessing_ms, 2))
        assert metric['changed_pixels_outside_intended_mask'] == 0
        assert np.array_equal(result[mask == 1], raw[mask == 1])
        metric.update({'first_compositor_ms': round(durations[0], 2), 'warm_compositor_runs_ms': [round(v, 2) for v in durations[1:]],
            'exact_raw_core_pixels': int((mask == 1).sum()), 'pixel_repeatability': True, 'file': name})
        candidates[label] = metric
        assert cv2.imwrite(str(ROOT/name), result)
        base.mask_debug_image(template, mask, label+' LOWER CONTOUR / '+mode, ROOT/(label+'_mask_debug.png'))
    np.save(ROOT/'lower_contour_mask.npy', mask)
    paths = [('YOUR PHOTO', customer.INPUT/'source.image'), ('TEMPLATE', customer.INPUT/'template.image'), ('WEB BASIC V1', customer.INPUT/'v1.image'),
        ('RAW V2', ROOT/'A_raw_customer.png'), ('C8', ROOT/'C8_customer_balanced.png'), ('C9 RAW CONTOUR', ROOT/'C9_raw_lower_contour.png'),
        ('C10 BOUNDARY CONTOUR', ROOT/'C10_lower_contour_boundary.png')]
    customer.make_sheet(app, paths, True, 'customer-contour-face-review.png')
    customer.make_sheet(app, paths, False, 'customer-contour-full-review.png')
    assert all(base.sha256_file(path) == digest for path, digest in protected.items())
    assert customer.frozen_hashes() == before
    report = {'status': 'READY FOR HUMAN REVIEW', 'job_id': customer.JOB,
        'source': 'exact existing raw A for this customer job; no swap rerun', 'candidates': candidates,
        'added_lower_contour_pixels': int(((mask > 0) & (current == 0)).sum()),
        'mask_change': 'lower cheeks/jaw/chin only, continuous gate below eyes; upper support unchanged',
        'cpu_providers': sessions, 'analysis_init_ms': round(init_ms, 2),
        'peak_rss_mb': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024, 1),
        'prior_outputs_and_V1_source_unchanged': True, 'network_blocked': True,
        'research_only': True, 'no_restoration': True}
    base.write_json(ROOT/'contour-metrics.json', report)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    run()
