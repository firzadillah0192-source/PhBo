"""Small Redis-backed limiter for public claim endpoints."""

from __future__ import annotations

import hashlib
import threading
import time
from collections import defaultdict, deque

import redis
from fastapi import HTTPException, Request

from app.core.config import get_settings

_client: redis.Redis | None = None
_local_lock = threading.Lock()
_local_hits: dict[str, deque[float]] = defaultdict(deque)


def _redis_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(
            get_settings().redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=0.25,
            socket_timeout=0.25,
        )
    return _client


def _key(request: Request, bucket: str) -> str:
    address = request.client.host if request.client else "unknown"
    digest = hashlib.sha256(address.encode("utf-8")).hexdigest()[:24]
    return f"photobooth:public-rate:{bucket}:{digest}"


def enforce_public_rate_limit(request: Request, bucket: str, limit: int, window_seconds: int = 60) -> None:
    key = _key(request, bucket)
    try:
        client = _redis_client()
        count = int(client.incr(key))
        if count == 1:
            client.expire(key, window_seconds)
    except (redis.RedisError, OSError):
        now = time.monotonic()
        with _local_lock:
            hits = _local_hits[key]
            while hits and now - hits[0] >= window_seconds:
                hits.popleft()
            hits.append(now)
            count = len(hits)
    if count > limit:
        raise HTTPException(
            status_code=429,
            detail={"error_code": "RATE_LIMITED", "message": "Please try again shortly."},
            headers={"Retry-After": str(window_seconds)},
        )
