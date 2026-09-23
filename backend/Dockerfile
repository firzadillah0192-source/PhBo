# Photobooth AI — backend image (FastAPI API + generation worker).
# One image serves both roles; the worker overrides `command` in compose.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MPLCONFIGDIR=/tmp/matplotlib

WORKDIR /app

# curl is used by nothing at runtime; wget/urllib cover healthchecks.
# libjpeg/zlib are needed by Pillow wheels at runtime on slim.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libjpeg62-turbo zlib1g \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# MediaPipe Face Mesh is installed without optional OpenCV-contrib/JAX extras;
# the image already pins headless OpenCV and uses the bundled CPU model.
RUN pip install --no-cache-dir --no-deps mediapipe==0.10.21

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
