"""Generation job processor.

Shared by the worker process and (in tests) invoked directly. Implements the
state machine QUEUED -> PROCESSING -> COMPLETED | FAILED with honest error
codes. Never fabricates a result image.
"""

from __future__ import annotations

import io
import traceback
from datetime import datetime, timezone

from PIL import Image
from sqlalchemy.orm import Session

from app.ai.base import AIProviderError, GenerationOptions
from app.ai.factory import get_provider
from app.core.config import get_settings
from app.db import SessionLocal
from app.models import ErrorCode, GenerationJob, JobState, Result
from app.services import storage
from app.templates_registry import TemplateNotFound, get_registry


def _now() -> datetime:
    return datetime.now(timezone.utc)


def process_job(job_id: str, *, db: Session | None = None) -> str:
    """Run one generation job. Returns the resulting state.

    All failure modes are caught and persisted with an explicit error_code so
    the frontend always learns the truth instead of hanging or guessing.
    """
    own_session = db is None
    session = db or SessionLocal()
    try:
        job = session.get(GenerationJob, job_id)
        if job is None:
            print(f"[worker] job {job_id} not found in database", flush=True)
            return JobState.FAILED

        if job.state == JobState.COMPLETED:
            return job.state

        job.state = JobState.PROCESSING
        job.started_at = _now()
        job.error_code = None
        job.error_message = None
        session.commit()

        try:
            _run_generation(session, job)
        except TemplateNotFound as exc:
            _fail(session, job, ErrorCode.TEMPLATE_NOT_FOUND, str(exc))
        except AIProviderError as exc:
            # Surfaces AI_PROVIDER_NOT_CONNECTED / AI_PROVIDER_ERROR / AI_EMPTY_RESULT
            _fail(session, job, exc.code, exc.message, detail=exc.detail)
        except FileNotFoundError as exc:
            _fail(session, job, ErrorCode.UPLOAD_NOT_FOUND, f"Upload file missing: {exc}")
        except Exception as exc:  # noqa: BLE001 - must never leave a job stuck
            tb = traceback.format_exc()
            print(f"[worker] unexpected failure for job {job_id}:\n{tb}", flush=True)
            _fail(
                session,
                job,
                ErrorCode.INTERNAL_ERROR,
                f"{type(exc).__name__}: {exc}",
                detail=tb[-2000:],
            )

        session.refresh(job)
        return job.state
    finally:
        if own_session:
            session.close()


def _run_generation(session: Session, job: GenerationJob) -> None:
    """Happy path: load upload -> provider.generate -> persist result."""
    settings = get_settings()

    upload = job.upload
    if upload is None:
        raise FileNotFoundError(f"upload row missing for job {job.id}")

    template = get_registry().get(job.template_id)

    user_image = storage.read_file(upload.storage_path)

    provider = get_provider()

    # Fail fast and honestly before spending provider time.
    if not provider.is_available():
        from app.ai.base import ProviderNotConnectedError

        raise ProviderNotConnectedError(
            "AI_PROVIDER_NOT_CONNECTED: provider "
            f"'{provider.name}' is configured but has no usable credentials. "
            "Set NINEROUTER_API_KEY (and NINEROUTER_BASE_URL) in the environment."
        )

    job.provider = provider.name
    job.model = getattr(provider, "_model", None)
    session.commit()

    ai_result = provider.generate(
        user_image,
        template,
        GenerationOptions(width=template.width, height=template.height),
    )

    if not ai_result.image_bytes:
        from app.ai.base import ProviderEmptyResultError

        raise ProviderEmptyResultError("AI_EMPTY_RESULT: provider returned zero bytes.")

    # Verify the provider actually returned a decodable image before we claim
    # success. A non-image blob must never become a COMPLETED job.
    with Image.open(io.BytesIO(ai_result.image_bytes)) as out_img:
        out_img.load()
        out_w, out_h = out_img.size

    result_id = _new_id()
    result_path = storage.save_result(
        result_id=result_id,
        data=ai_result.image_bytes,
        content_type=ai_result.content_type,
    )

    result = Result(
        id=result_id,
        job_id=job.id,
        template_id=template.id,
        storage_path=str(result_path),
        content_type=ai_result.content_type,
        size_bytes=len(ai_result.image_bytes),
        width=out_w,
        height=out_h,
        sha256=_sha(ai_result.image_bytes),
        provider=ai_result.provider,
        model=ai_result.model,
    )
    session.add(result)

    job.state = JobState.COMPLETED
    job.finished_at = _now()
    job.error_code = None
    job.error_message = None
    session.commit()

    print(
        f"[worker] job {job.id} COMPLETED result={result_id} "
        f"{out_w}x{out_h} {len(ai_result.image_bytes)}B "
        f"provider={ai_result.provider} model={ai_result.model} "
        f"runtime_dir={settings.runtime_dir}",
        flush=True,
    )


def _fail(
    session: Session,
    job: GenerationJob,
    code: str,
    message: str,
    *,
    detail: str | None = None,
) -> None:
    job.state = JobState.FAILED
    job.error_code = code
    job.error_message = message if not detail else f"{message} | {detail[:800]}"
    job.finished_at = _now()
    session.commit()
    print(
        f"[worker] job {job.id} FAILED code={code} message={message} detail={detail}",
        flush=True,
    )


def _new_id() -> str:
    import uuid

    return uuid.uuid4().hex


def _sha(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()
