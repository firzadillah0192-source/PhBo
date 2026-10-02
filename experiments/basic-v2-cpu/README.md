# BASIC V2 CPU Face-Swap POC

Isolated, local-only evaluation. This directory is not imported by production
generation and does not change `BASIC_IDENTITY_BACKEND=v1` or generation
routing. No external AI API, GPU, restoration model, or deployment is used.

## Model terms and source

The official InsightFace model-zoo notice states that its public pretrained
models are for non-commercial research purposes only. That notice covers both
the `inswapper_128.onnx` checkpoint and the `buffalo_l` supporting model pack.
This permits this bounded, non-production research evaluation only; it does
not clear either checkpoint for commercial Photobooth use. The InsightFace
Python code license is separate from these checkpoint terms.

- Swapper: `inswapper_128.onnx`,
  <https://github.com/deepinsight/insightface/releases/download/model-zoo/inswapper_128.onnx>
- Face analysis pack: `buffalo_l.zip`,
  <https://github.com/deepinsight/insightface/releases/download/model-zoo/buffalo_l.zip>
- Terms: <https://github.com/deepinsight/insightface/blob/master/model_zoo/README.md>
- Swapper documentation: <https://github.com/deepinsight/insightface/blob/master/examples/in_swapper/README.md>

Do not use the weights for production, redistribute them, or commit them.
The exact local filenames, byte sizes, and SHA-256 values belong in
`outputs/model_manifest.json` after download.

## Environment snapshot

Audited host: 4 logical CPUs, Intel Core i7-7700 @ 3.60 GHz, 10,183,868 kB
RAM, Python 3.12.3. Active worker/API containers use Python 3.12.14,
OpenCV-headless 4.10.0.84, MediaPipe 0.10.21, Pillow 12.3.0 and NumPy 1.26.4;
neither container has ONNX Runtime or InsightFace installed. This POC therefore
uses its own `.venv` and the CPU-only `onnxruntime` package.

The available host filesystem had 27 GB free at audit time. The running worker
was using about 339 MiB and the API about 143 MiB before the experiment.

## Controlled inputs

The fixture source is the default `--user` input in
`scripts/basic_photometric_regression.py`, and its frozen V1 result is
`testimage/basic-soft-contour-regression/F-soft-contour-user-identity/final.png`.
The runtime sci-fi template SHA-256 matched the repo template:
`b60def2bba8ddb489b93a6880489432bfc74be2f02b4c03900a3b371c78dcdf1`.
Input image copies go only under ignored `inputs/`; generated images, model
files, debug crops, venv and benchmarks go under ignored `models/`, `outputs/`
and `cache/`.

## Setup and run

Create the isolated environment and install dependencies only after confirming
the package index is reachable:

```sh
python3 -m venv experiments/basic-v2-cpu/.venv
experiments/basic-v2-cpu/.venv/bin/pip install --no-cache-dir -r experiments/basic-v2-cpu/requirements.txt
```

Download the two official checkpoints directly into `models/`, record their
checksums, and extract `buffalo_l.zip` locally. Do not let InsightFace perform
an automatic model download. Run the experiment offline with only
`CPUExecutionProvider` enabled. The script should abort on missing/duplicate
faces and must not fall back to V1.

No image bytes, embeddings, or debug crops are sent to a network service.

## Compositor-only identity-preservation iteration

`compositor_iteration.py` reuses the frozen user photo, approved template,
local ArcFace analysis checkpoints, and the existing `A_raw_faceswap.png`.
It does not rerun face swap inference. Run `initial` to produce C1-C3 and
inspect the outputs; run `c4` only after that inspection to produce the
balanced candidate and the full-image/aligned-face review sheets. Existing V1,
A/B/C, benchmark, and model manifest files are checksum-guarded and never
overwritten. New outputs remain under the ignored `outputs/` directory.

```sh
experiments/basic-v2-cpu/.venv/bin/python experiments/basic-v2-cpu/compositor_iteration.py initial
experiments/basic-v2-cpu/.venv/bin/python experiments/basic-v2-cpu/compositor_iteration.py c4
```

The first phase writes `outputs/compositor-variant-metrics.json` with C1-C3;
the second appends C4 and creates `basic-v2-human-review.png` and
`basic-v2-face-crops-review.png`. Human recognizability remains a manual gate.

## Detail-retention ablation (C5-C8)

`compositor_detail_iteration.py` continues from the same frozen POC inputs and
raw A. It does not use the recent customer production upload or rerun face
swap. All existing checkpoints are checksum-verified against the original
manifest before evaluation; network connections are blocked in the process.
The old artifacts and Basic source files are checksum-guarded.

```sh
experiments/basic-v2-cpu/.venv/bin/python experiments/basic-v2-cpu/test_compositor_detail_iteration.py
experiments/basic-v2-cpu/.venv/bin/python experiments/basic-v2-cpu/compositor_detail_iteration.py initial
# Inspect C5-C7 before choosing the balanced candidate.
experiments/basic-v2-cpu/.venv/bin/python experiments/basic-v2-cpu/compositor_detail_iteration.py balanced
```

The runner refuses to overwrite an existing round. Results are under ignored
`outputs/detail-round-2/`. C5 removes harmonization as a control. C6 adds only
a bounded smooth luminance field. C7 confines bounded color/light correction
to the feather. C8 uses the existing C4 cheek/jaw support and preserves raw A
exactly in its alpha-1 core, with correction only near its boundary. It does
not sharpen, restore, beautify, replace hair, or expand into the neck/scene.

Each candidate records one first compositor call and three warm calls; these
are compositor timings, not new face-swap inference benchmarks. CPU scoring,
model initialization and contact-sheet generation are recorded separately or
excluded explicitly. See `outputs/detail-round-2/REPORT.md` for findings and
the pending human gate. Checkpoint terms remain non-commercial research only.
