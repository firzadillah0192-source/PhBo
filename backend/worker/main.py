"""Photobooth generation worker.

Long-running process: pops job ids from Redis and runs them through the
generation service. Designed to be restarted safely — job state lives in
PostgreSQL, so a crash mid-job leaves a PROCESSING row that the requeue
sweep below returns to the queue.

Run with:  python -m worker.main
"""

from __future__ import annotations

import signal
import sys
import time

# Allow `python worker/main.py` as well as `python -m worker.main`
if __package__ in (None, ""):
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))

from app.core.config import get_settings  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.models import GenerationJob, JobState  # noqa: E402
from app.queue import dequeue, enqueue, ping, queue_length  # noqa: E402
from app.services.generation import process_job  # noqa: E402

_shutdown = False


def _handle_signal(signum, _frame) -> None:
    global _shutdown
    _shutdown = True
    print(f"[worker] received signal {signum}, shutting down", flush=True)


def requeue_stuck_jobs() -> int:
    """Return PROCESSING/QUEUED jobs left behind by a previous crash."""
    requeued = 0
    db = SessionLocal()
    try:
        stuck = (
            db.query(GenerationJob)
            .filter(GenerationJob.state.in_([JobState.PROCESSING, JobState.QUEUED]))
            .all()
        )
        for job in stuck:
            job.state = JobState.QUEUED
            job.error_code = None
            job.error_message = None
            enqueue(job.id)
            requeued += 1
        db.commit()
    finally:
        db.close()
    if requeued:
        print(f"[worker] requeued {requeued} stuck job(s)", flush=True)
    return requeued


def main() -> int:
    settings = get_settings()
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    settings.ensure_runtime_dirs()
    init_db()

    print(
        f"[worker] starting: queue={settings.queue_name} redis={settings.redis_url} "
        f"provider={settings.ai_provider}",
        flush=True,
    )

    if not ping():
        print("[worker] WARNING: Redis not reachable at startup; will keep retrying", flush=True)

    requeue_stuck_jobs()

    idle_logged = False
    while not _shutdown:
        try:
            if not ping():
                print("[worker] Redis unavailable, retrying in 5s", flush=True)
                time.sleep(5)
                continue

            job_id = dequeue(timeout=5)
            if job_id is None:
                if not idle_logged:
                    print(f"[worker] idle (queue_len={queue_length()})", flush=True)
                    idle_logged = True
                continue
            idle_logged = False

            print(f"[worker] picked up job {job_id}", flush=True)
            state = process_job(job_id)
            print(f"[worker] job {job_id} -> {state}", flush=True)
        except Exception as exc:  # noqa: BLE001 - worker must never die on one job
            print(f"[worker] loop error: {type(exc).__name__}: {exc}", flush=True)
            time.sleep(2)

    print("[worker] stopped", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
