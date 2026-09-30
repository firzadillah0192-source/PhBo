# Backend image build

The backend image uses a digest-pinned Python 3.12 Debian base, exact Python
dependency versions, and exact Debian HEIF decoder package versions. The
`pillow-heif` extension is built from its BSD-3-Clause source distribution
against Debian's system `libheif`/`libde265`; no wheel-bundled codec stack is
used. Build-time compiler and development packages are removed from the final
runtime layer.

The earlier PyPI build failure occurred while pip was fetching package metadata
for `watchfiles` from the index. It was a network/index timeout during mutable
range resolution, not evidence of an incompatible application dependency set.
The lock pins the Python runtime dependencies and pip uses bounded retries and
a longer network timeout. The Debian base is digest-pinned and HEIF codec
packages are version-pinned. A clean no-cache build still requires reachable
PyPI and Debian package repositories.

Build from a clean checkout with:

```sh
docker compose build --no-cache photobooth-api photobooth-worker
```

The worker healthcheck reads only its PID 1 process metadata. Docker marks it
`healthy` while PID 1 is the live `python -m worker.main` process; it becomes
`unhealthy` after three failed checks when PID 1 is absent, not the worker,
uninspectable, or a zombie. See [WORKER_HEALTHCHECK.md](WORKER_HEALTHCHECK.md).

The image installs MediaPipe without its unused declared task/audio packages.
`pip check` therefore reports missing `jax`, `jaxlib`,
`opencv-contrib-python`, `sentencepiece`, and `sounddevice`; `pip check` exits
non-zero for those unmet wheel metadata requirements and that output is not
suppressed. The application uses MediaPipe Face Mesh with pinned
`opencv-python-headless`, and `test_runtime_smoke.py` executes the Face Mesh
graph. See the dependency review below.

The runtime includes a pinned HEIF decoder. `test_heif_runtime.py` decodes a
small synthetic HEIC fixture directly through `pillow-heif`; it verifies the
runtime decoder only. Upload endpoint normalization is outside this build
hardening change and is not implied by this decoder smoke test. See
[MOBILE_IMAGE_INGESTION.md](MOBILE_IMAGE_INGESTION.md) for the exact boundary.

## MediaPipe dependency review

The installed MediaPipe wheel declares five additional packages as
`Requires-Dist`; installing the wheel with `--no-deps` leaves them absent and
visible in `pip check`:

| Package | Used by this backend runtime? | Decision |
| --- | --- | --- |
| `jax` | No; JAX training/task paths are not imported | Do not install |
| `jaxlib` | No; JAX training/task paths are not imported | Do not install |
| `opencv-contrib-python` | No; image code uses `cv2` from pinned `opencv-python-headless` | Avoid a competing OpenCV wheel |
| `sentencepiece` | No; text/tokenizer tasks are not used | Do not install |
| `sounddevice` | No; audio capture is not used | Do not install |

These are unconditional wheel metadata dependencies, not declared optional
extras. This image intentionally carries the MediaPipe Face Mesh and headless
OpenCV paths required by Basic validation. The runtime smoke test initializes
and executes Face Mesh, and the Basic detector regression suite checks the
production detector path without adding those five packages.
