"""Regression test for the Redis queue timeout invariant.

DEFECT (found in Sprint 1 validation)
    app/queue.py built its client with socket_timeout=5 while the worker
    blocked in BRPOP with timeout=5. On an idle queue BRPOP holds the socket
    open for exactly the socket timeout, so redis-py raised
    `TimeoutError: Timeout reading from socket` on EVERY idle cycle instead of
    returning None. The worker still ran, but logged a continuous error loop
    and slept 2s each time, masking real failures.

FIX
    socket_timeout is now derived from the BRPOP timeout plus a buffer, so it
    is always strictly greater. These tests pin that relationship so the two
    values cannot silently converge again.
"""

from __future__ import annotations

import app.queue as queue_mod


def test_socket_timeout_strictly_exceeds_dequeue_timeout():
    """The core invariant. Equality is what caused the defect."""
    assert queue_mod.SOCKET_TIMEOUT_SECONDS > queue_mod.DEQUEUE_TIMEOUT_SECONDS


def test_socket_timeout_has_a_meaningful_buffer():
    """Guard against a 1s margin that could still race under load."""
    assert queue_mod.SOCKET_TIMEOUT_BUFFER_SECONDS >= 5


def test_socket_timeout_is_derived_not_hardcoded():
    """Changing the BRPOP timeout must move the socket timeout with it."""
    assert queue_mod.SOCKET_TIMEOUT_SECONDS == (
        queue_mod.DEQUEUE_TIMEOUT_SECONDS + queue_mod.SOCKET_TIMEOUT_BUFFER_SECONDS
    )


def test_client_is_built_with_the_safe_socket_timeout(monkeypatch):
    """The client the worker actually uses must carry the corrected timeout."""
    captured = {}

    class _FakeRedis:
        @staticmethod
        def from_url(url, **kwargs):
            captured.update(kwargs)
            return object()

    monkeypatch.setattr(queue_mod, "redis", type("R", (), {"Redis": _FakeRedis}))
    monkeypatch.setattr(queue_mod, "_client", None)

    queue_mod.get_redis()

    assert captured["socket_timeout"] == queue_mod.SOCKET_TIMEOUT_SECONDS
    assert captured["socket_timeout"] > queue_mod.DEQUEUE_TIMEOUT_SECONDS
    assert captured["socket_connect_timeout"] == 5

    queue_mod.reset_client()


def test_dequeue_default_timeout_is_within_socket_timeout(monkeypatch):
    """The worker's actual call path must not exceed the socket timeout."""
    calls = {}

    class _FakeClient:
        def brpop(self, keys, timeout=None):
            calls["timeout"] = timeout
            return None

    monkeypatch.setattr(queue_mod, "get_redis", lambda: _FakeClient())

    assert queue_mod.dequeue() is None
    assert calls["timeout"] == queue_mod.DEQUEUE_TIMEOUT_SECONDS
    assert calls["timeout"] < queue_mod.SOCKET_TIMEOUT_SECONDS


def test_dequeue_returns_job_id_when_available(monkeypatch):
    class _FakeClient:
        def brpop(self, keys, timeout=None):
            return ("photobooth:generation-queue", "job-123")

    monkeypatch.setattr(queue_mod, "get_redis", lambda: _FakeClient())
    assert queue_mod.dequeue() == "job-123"
