# Photobooth AI — backend image (FastAPI API + generation worker).
# One image serves both roles; the worker overrides `command` in compose.

FROM python:3.12-slim-trixie@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_RETRIES=10 \
    PIP_DEFAULT_TIMEOUT=120 \
    MPLCONFIGDIR=/tmp/matplotlib

WORKDIR /app

# curl is used by nothing at runtime; wget/urllib cover healthchecks.
# libjpeg/zlib are needed by Pillow wheels. pillow-heif is built from source
# against Debian's libheif/libde265 decoder to avoid bundling unused codecs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gcc pkg-config \
        libheif-dev=1.19.8-1+deb13u1 \
        libde265-dev=1.0.15-1+deb13u2 \
        libheif1=1.19.8-1+deb13u1 \
        libheif-plugin-dav1d=1.19.8-1+deb13u1 \
        libheif-plugin-libde265=1.19.8-1+deb13u1 \
        libde265-0=1.0.15-1+deb13u2 \
        libjpeg62-turbo=1:2.1.5-4 \
        zlib1g=1:1.3.dfsg+really1.3.1-1+b1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN python -m pip install --no-cache-dir setuptools==80.9.0 wheel==0.45.1 \
    && python -m pip install --no-cache-dir --no-build-isolation \
        --no-binary=pillow-heif -r requirements.txt \
    && python -m pip uninstall -y setuptools wheel

# Remove compile-time packages; the runtime keeps only the HEIC decoder libs.
RUN apt-get purge -y --auto-remove gcc pkg-config libheif-dev libde265-dev \
    && rm -rf /var/lib/apt/lists/*

# MediaPipe Face Mesh is installed without task/audio packages unused by this
# application; the image already pins headless OpenCV and uses the bundled CPU model.
RUN python -m pip install --no-cache-dir --only-binary=:all: --no-deps mediapipe==0.10.21

COPY app ./app
COPY worker ./worker

# Non-root runtime user (spec section 7: stay contained, avoid host damage).
RUN groupadd --system photobooth \
    && useradd --system --gid photobooth --home-dir /srv/photobooth photobooth \
    && mkdir -p /srv/photobooth/uploads /srv/photobooth/results /srv/photobooth/tmp \
                /srv/photobooth/cache /srv/photobooth/backups /srv/photobooth/templates \
    && chown -R photobooth:photobooth /srv/photobooth

USER photobooth

EXPOSE 8000

# Default role: API. The worker service overrides this with `python -m worker.main`.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
