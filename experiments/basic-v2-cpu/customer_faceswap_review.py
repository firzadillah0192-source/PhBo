#!/usr/bin/env python3
"""Local CPU review of a confirmed customer job; no production registration.

Uses the existing research checkpoints and the exact copied upload, template
and V1 result. Never downloads a checkpoint or modifies the application.
"""
from __future__ import annotations

import argparse
import json
import resource
import statistics
import time
from pathlib import Path

import compositor_detail_iteration as detail  # blocks connections before InsightFace import
from insightface.model_zoo import get_model
from PIL import Image, ImageDraw, ImageFont, ImageOps
import cv2
import numpy as np

base = detail.base
ROOT = base.OUTPUTS / "customer-675bc171"
INPUT = ROOT / "inputs"
JOB = "675bc171b8794ffcaee51dab28563299"


def frozen_hashes():
    paths = [p for p in base.OUTPUTS.rglob('*') if p.is_file() and ROOT not in p.parents]
    paths += list(base.INPUTS.glob('*'))
    paths += [base.REPO_ROOT/'backend/app/generation/basic'/name for name in
              ('engine.py', 'blending.py', 'landmarks.py', 'errors.py')]
    return {str(p.relative_to(base.REPO_ROOT)): base.sha256_file(p) for p in paths if p.is_file()}


def make_sheet(app, paths, face_crops, filename):
    width, height = (256, 256) if face_crops else (320, 480)
    caption = 42
    rows = (len(paths)+2)//3
    sheet = Image.new('RGB', (width*3, (height+caption)*rows), (10, 13, 20))
    draw = ImageDraw.Draw(sheet)
    for index, (label, path) in enumerate(paths):
        data = base.read_image(path)
        if face_crops:
            face = base.exactly_one_face(app, data, label)
            data = base.norm_crop(data, face.kps, image_size=256, mode='arcface')
        image = Image.fromarray(cv2.cvtColor(data, cv2.COLOR_BGR2RGB))
        image = ImageOps.contain(image, (width, height), Image.Resampling.LANCZOS)
        x, y = (index%3)*width, (index//3)*(height+caption)
        sheet.paste(image, (x+(width-image.width)//2, y+(height-image.height)//2))
        draw.text((x+8,y+height+10), label, fill='white', font=ImageFont.load_default())
    sheet.save(ROOT/filename)


def create_masks(template, meta):
    region = tuple(meta['face_region'])
    polygon = tuple(tuple(point) for point in meta['mask_polygon'])
    _, current, binary = base.build_masks(template.shape, region, polygon)
    wide = base.build_wider_lower_mask(template.shape, region, polygon, current, binary, meta['face_anchors'])
    return current, np.clip(wide/float(wide.max()),0,1)


def run():
    if (ROOT/'metrics.json').exists() or (ROOT/'A_raw_customer.png').exists():
        raise FileExistsError('refusing to overwrite existing customer review')
    detail.validate_frozen()
    before = frozen_hashes()
    copied = {name: INPUT/name for name in ('source.image','template.image','v1.image','template.json')}
    input_hashes = {name:base.sha256_file(path) for name,path in copied.items()}
    source, template, v1 = [base.read_image(INPUT/name) for name in ('source.image','template.image','v1.image')]
    meta = json.loads((INPUT/'template.json').read_text())
    if template.shape != v1.shape or template.shape[:2] != (meta['height'],meta['width']):
        raise RuntimeError('job result / authoritative template dimensions disagree')
    cv2.setNumThreads(2)
    app, sessions, face_init_ms = base.create_face_app()
    start = time.perf_counter()
    swapper = get_model(str(base.SWAPPER_PATH), providers=['CPUExecutionProvider'])
    swapper_init_ms = (time.perf_counter()-start)*1000
    sessions['swapper'] = swapper.session.get_providers()
    if any(value != ['CPUExecutionProvider'] for value in sessions.values()):
        raise RuntimeError('CPU-only provider check failed')
    start = time.perf_counter()
    source_face = base.exactly_one_face(app,source,'customer input')
    source_detection_embedding_ms = (time.perf_counter()-start)*1000
    start = time.perf_counter()
    target_face = base.exactly_one_face(app,template,'exact production template')
    template_detection_embedding_ms = (time.perf_counter()-start)*1000
    swap_times = []
    first = None
    for _ in range(4):
        start = time.perf_counter()
        raw = swapper.get(template.copy(),target_face,source_face,paste_back=True)
        swap_times.append((time.perf_counter()-start)*1000)
        if raw is None or raw.shape != template.shape:
            raise RuntimeError('invalid raw swap result')
        if first is None:
            first = raw.copy()
        elif not np.array_equal(first,raw):
            raise RuntimeError('raw inference was not pixel-repeatable')
    if not cv2.imwrite(str(ROOT/'A_raw_customer.png'),raw):
        raise RuntimeError('raw result write failed')
    start = time.perf_counter()
    current_mask, c8_mask = create_masks(template,meta)
    preprocessing_ms = (time.perf_counter()-start)*1000
    candidates = {'V1': {'file': 'inputs/v1.image'}, 'RAW A': {'file': 'A_raw_customer.png'}}
    for label, mask, mode, filename in (
        ('C CONTROL',current_mask,'current','C_frequency_control.png'),
        ('C8',c8_mask,'balanced','C8_customer_balanced.png')):
        start = time.perf_counter()
        if mode == 'current':
            image,_ = base.compose_with_identity(template,raw,mask,'current')
        else:
            image = detail.compose(template,raw,mask,'balanced')
        comp_ms = (time.perf_counter()-start)*1000
        candidate = base.candidate_report(app,source_face.normed_embedding,target_face.normed_embedding,
            source,template,image,mask,round(comp_ms,2),round(preprocessing_ms+comp_ms,2),round(preprocessing_ms,2))
        if candidate['changed_pixels_outside_intended_mask']:
            raise RuntimeError('outside-mask pixels changed')
        if label == 'C8':
            assert np.array_equal(image[mask==1],raw[mask==1])
            candidate['raw_A_exact_core_pixels'] = int((mask==1).sum())
        candidate['file'] = filename
        candidates[label] = candidate
        cv2.imwrite(str(ROOT/filename),image)
        np.save(ROOT/(label.replace(' ','_')+'_mask.npy'),mask)
        base.mask_debug_image(template,mask,label+' - customer review',ROOT/(label.replace(' ','_')+'_mask_debug.png'))
    for label, image in [('V1',v1),('RAW A',raw)]:
        face = base.exactly_one_face(app,image,label)
        candidates[label].update({'arcface_cosine_to_user':base.cosine_similarity(source_face.normed_embedding,face.normed_embedding),
            'arcface_cosine_to_template':base.cosine_similarity(target_face.normed_embedding,face.normed_embedding)})
    paths = [('YOUR PHOTO',INPUT/'source.image'),('TEMPLATE',INPUT/'template.image'),('WEB BASIC V1',INPUT/'v1.image'),
             ('RAW V2',ROOT/'A_raw_customer.png'),('C FREQUENCY CONTROL',ROOT/'C_frequency_control.png'),('C8 LOCAL ONLY',ROOT/'C8_customer_balanced.png')]
    make_sheet(app,paths,True,'customer-face-crops-review.png')
    make_sheet(app,paths,False,'customer-full-review.png')
    if before != frozen_hashes():
        raise RuntimeError('prior POC artifacts or V1 source changed')
    assert input_hashes == {name:base.sha256_file(path) for name,path in copied.items()}
    report = {'status':'READY FOR HUMAN REVIEW','job_id':JOB,'template_id':meta['id'],
        'input_sha256':input_hashes,'prior_artifacts_and_V1_source_unchanged':True,
        'customer_input_used':True,'research_only':True,'network_connections_blocked':True,
        'no_restoration_or_sharpening':True,'face_counts':{'source':1,'template':1},
        'source_detector_confidence':round(float(source_face.det_score),5),
        'template_detector_confidence':round(float(target_face.det_score),5),
        'providers':sessions,'model_init_ms':{'face_analysis':round(face_init_ms,2),'swapper':round(swapper_init_ms,2)},
        'source_detection_embedding_ms':round(source_detection_embedding_ms,2),
        'template_detection_embedding_ms':round(template_detection_embedding_ms,2),
        'raw_swap_cold_ms':round(swap_times[0],2),'raw_swap_warm_runs_ms':[round(v,2) for v in swap_times[1:]],
        'raw_swap_warm_median_ms':round(statistics.median(swap_times[1:]),2),
        'raw_swap_pixel_repeatability':True,'peak_rss_mb':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,1),
        'candidates':candidates,'human_recognizability':'PENDING; automated scores do not establish identity',
        'license':'Existing INSwapper/buffalo_l checkpoints: NON-COMMERCIAL RESEARCH / EVALUATION ONLY'}
    base.write_json(ROOT/'metrics.json',report)
    print(json.dumps(report,indent=2))


if __name__ == '__main__':
    run()
