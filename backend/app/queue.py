"""Redis-backed generation queue.

Job state lives in PostgreSQL (durable, queryable). Redis carries the work
queue only. This keeps state authoritative in one place and avoids the
split-brain of duplicating job state across two stores.
"""

from __future__ import annotations

import redis

from app.core.config import get_settings

_client: redis.Redis | None = None

# How long BRPOP blocks waiting for a job before the worker loops.
DEQUEUE_TIMEOUT_SECONDS = 5

# The socket read timeout MUST be strictly greater than the BRPOP blocking
# timeout. If they are equal, an idle queue makes BRPOP hold the connection
# open for exactly as long as the socket timeout, so redis-py raises
# `TimeoutError: Timeout reading from socket` on every idle cycle instead of
# returning None. The buffer below keeps the two unambiguously separated.
SOCKET_TIMEOUT_BUFFER_SECONDS = 10
SOCKET_TIMEOUT_SECONDS = DEQUEUE_TIMEOUT_SECONDS + SOCKET_TIMEOUT_BUFFER_SECONDS


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        settings = get_settings()
        _client = redis.Redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=SOCKET_TIMEOUT_SECONDS,
            health_check_interval=30,
        )
    return _client


def enqueue(job_id: str) -> None:
    """Push a job id onto the generation queue."""
    get_redis().lpush(get_settings().queue_name, job_id)


def dequeue(timeout: int = DEQUEUE_TIMEOUT_SECONDS) -> str | None:
    """Blocking pop. Returns job_id, or None when the queue stayed empty.

    `timeout` must stay below SOCKET_TIMEOUT_SECONDS; see the note above.
    """
    result = get_redis().brpop([get_settings().queue_name], timeout=timeout)
    if not result:
        return None
    _queue, job_id = result
    return job_id


def queue_length() -> int:
    return int(get_redis().llen(get_settings().queue_name))


def ping() -> bool:
    try:
        return bool(get_redis().ping())
    except redis.RedisError:
        return False


def reset_client() -> None:
    """Drop the cached client (used by tests)."""
    global _client
    if _client is not None:
        try:
            _client.close()
        except Exception:  # noqa: BLE001 - best effort teardown
            pass
    _client = None
