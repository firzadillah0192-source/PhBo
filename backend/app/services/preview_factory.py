"""Admin-only marketing preview generation.

This service intentionally does not use customer uploads, customer generation
jobs, or the quota service. It reuses the configured AI provider and the
experience definition to request a prompt-only original artwork preview, while
storing the result as a durable catalog asset.
"""

from __future__ import annotations

import io
import traceback
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.base import AIProviderError, GenerationOptions, ProviderEmptyResultError
from app.ai.factory import get_provider
from app.catalog import experience_definition
from app.core.config import get_settings
from app.db import SessionLocal
from app.models import (
    ManagedExperience,
    PreviewGenerationJob,
    PreviewJobPurpose,
    PreviewJobState,
    PreviewSource,
    PreviewStatus,
    new_id,
)
from app.queue import enqueue_preview
from app.services.admin_assets import save_admin_image

DEFAULT_PREVIEW_SOURCE_ID = "portrait-default"
PROMPT_ONLY_SOURCE_ID = "prompt-only"
PREVIEW_SOURCE_TYPES = ("portrait", "full_body", "room", "object", "food")
ORIGINAL_PREVIEW_GUARD = (
    "Create a wholly original, commercially safe marketing artwork using the supplied internal canonical demo portrait "
    "as the only subject reference and applying the private experience direction below. "
    "The source is a fictional adult created for internal product marketing, not a customer upload. "
    "Do not use or imitate copyrighted characters, franchise worlds, logos, brand identities, protected symbols, "
    "or any named living artist's signature style. Do not reproduce a real person's likeness beyond the supplied internal source. "
    "Avoid readable text and logos unless the experience direction explicitly requires an editorial layout; keep any text generic and original."
)


class PreviewFactoryError(Exception):
    """A safe, operator-facing preview factory validation error."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def source_asset_path(source_id: str) -> Path:
    return get_settings().templates_dir / "_preview_sources" / f"{source_id}.png"


def thumbnail_asset_path(experience_id: str) -> Path:
    return get_settings().templates_dir / "_experience_thumbnails" / f"{experience_id}.png"


def ensure_default_source(db: Session) -> PreviewSource:
    source = db.get(PreviewSource, DEFAULT_PREVIEW_SOURCE_ID)
    target = source_asset_path(DEFAULT_PREVIEW_SOURCE_ID)
    changed = False
    if source is None:
        source = PreviewSource(
            id=DEFAULT_PREVIEW_SOURCE_ID,
            source_type="portrait",
            updated_by="system",
        )
        db.add(source)
        changed = True
    # Bootstrap the approved repository-seeded portrait into the metadata row
    # on a fresh runtime volume. Admin uploads still replace this same durable
    # asset through the protected source endpoint.
    if target.is_file() and source.storage_path != str(target):
        source.storage_path = str(target)
        source.content_type = "image/png"
        source.active = True
        source.updated_by = source.updated_by or "system"
        source.updated_at = _now()
        changed = True
    if changed:
        db.commit()
        db.refresh(source)
    return source


def list_sources(db: Session) -> list[PreviewSource]:
    ensure_default_source(db)
    return list(db.scalars(select(PreviewSource).order_by(PreviewSource.id)))


def source_has_asset(source: PreviewSource) -> bool:
    return bool(source.active and source.storage_path and Path(source.storage_path).is_file())


def source_response(source: PreviewSource) -> dict:
    return {
        "id": source.id,
        "source_type": source.source_type,
        "has_asset": source_has_asset(source),
        "content_type": source.content_type,
        "updated_at": source.updated_at,
        "updated_by": source.updated_by,
    }


def save_source_asset(
    db: Session,
    source_id: str,
    data: bytes,
    content_type: str | None,
    actor_id: str,
) -> PreviewSource:
    if source_id != DEFAULT_PREVIEW_SOURCE_ID:
        raise PreviewFactoryError("Only the portrait canonical source is enabled right now.")
    source = db.get(PreviewSource, source_id) or PreviewSource(
        id=source_id, source_type="portrait"
    )
    if source.source_type not in PREVIEW_SOURCE_TYPES:
        raise PreviewFactoryError("Unsupported preview source type.")
    target = source_asset_path(source_id)
    try:
        save_admin_image(data, content_type=content_type, target=target)
    except Exception as exc:  # noqa: BLE001 - convert to safe API validation
        raise PreviewFactoryError(str(exc)) from exc
    source.storage_path = str(target)
    source.content_type = "image/png"
    source.active = True
    source.updated_by = actor_id
    source.updated_at = _now()
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


def _job_response(job: PreviewGenerationJob) -> dict:
    return {
        "id": job.id,
        "experience_id": job.experience_id,
        "source_id": job.source_id,
        "purpose": job.purpose,
        "state": job.state,
        "provider": job.provider,
        "model": job.model,
        "error_message": job.error_message,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


def job_response(job: PreviewGenerationJob) -> dict:
    return _job_response(job)


def queue_preview_job(
    db: Session,
    *,
    experience_id: str,
    source_id: str = DEFAULT_PREVIEW_SOURCE_ID,
    actor_id: str = "admin",
) -> PreviewGenerationJob:
    experience = db.get(ManagedExperience, experience_id)
    if experience is None:
        raise PreviewFactoryError(f"Experience '{experience_id}' not found.")
    source = ensure_default_source(db) if source_id == DEFAULT_PREVIEW_SOURCE_ID else (
        db.get(PreviewSource, source_id) if source_id != PROMPT_ONLY_SOURCE_ID else None
    )
    if source_id != PROMPT_ONLY_SOURCE_ID and (source is None or not source_has_asset(source)):
        raise PreviewFactoryError(
            "Upload an approved canonical preview source before generating previews."
        )
    active_job = db.scalar(
        select(PreviewGenerationJob).where(
            PreviewGenerationJob.experience_id == experience_id,
            PreviewGenerationJob.state.in_([PreviewJobState.QUEUED, PreviewJobState.PROCESSING]),
        ).limit(1)
    )
    if active_job is not None:
        return active_job

    experience.preview_status = PreviewStatus.GENERATING
    experience.preview_error = None
    experience.updated_at = _now()
    experience.updated_by = actor_id
    job = PreviewGenerationJob(
        id=new_id(),
        experience_id=experience_id,
        source_id=source_id,
        purpose=PreviewJobPurpose.ADMIN_PREVIEW_GENERATION,
        state=PreviewJobState.QUEUED,
        requested_by=actor_id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    try:
        enqueue_preview(job.id)
    except Exception as exc:  # queue failure is visible and retryable in Admin
        job.state = PreviewJobState.FAILED
        job.error_message = f"Preview queue unavailable: {exc}"
        experience.preview_status = PreviewStatus.FAILED
        experience.preview_error = job.error_message
        experience.updated_at = _now()
        db.commit()
        raise PreviewFactoryError("The preview queue is unavailable. Try again shortly.") from exc
    return job


def missing_experiences(db: Session) -> tuple[list[ManagedExperience], int]:
    rows = list(db.scalars(select(ManagedExperience).order_by(ManagedExperience.sort_order, ManagedExperience.id)))
    missing: list[ManagedExperience] = []
    skipped_ready = 0
    for row in rows:
        ready = row.preview_status == PreviewStatus.READY and bool(
            row.thumbnail_path and Path(row.thumbnail_path).is_file()
        )
        if ready:
            skipped_ready += 1
        elif row.preview_status == PreviewStatus.GENERATING:
            continue
        else:
            if row.preview_status == PreviewStatus.READY:
                row.preview_status = PreviewStatus.MISSING
            missing.append(row)
    return missing, skipped_ready


def process_preview_job(job_id: str, *, db: Session | None = None) -> str:
    """Process one internal preview job; safe to retry and idempotent when done."""
    own_session = db is None
    session = db or SessionLocal()
    try:
        job = session.get(PreviewGenerationJob, job_id)
        if job is None:
            return PreviewJobState.FAILED
        if job.purpose != PreviewJobPurpose.ADMIN_PREVIEW_GENERATION:
            return PreviewJobState.FAILED
        if job.state in (PreviewJobState.COMPLETED, PreviewJobState.FAILED):
            return job.state

        experience = session.get(ManagedExperience, job.experience_id)
        source = session.get(PreviewSource, job.source_id) if job.source_id != PROMPT_ONLY_SOURCE_ID else None
        if experience is None or (
            job.source_id != PROMPT_ONLY_SOURCE_ID and (source is None or not source_has_asset(source))
        ):
            return _fail_preview(session, job, experience, "Canonical preview source is missing.")

        job.state = PreviewJobState.PROCESSING
        job.started_at = _now()
        job.error_message = None
        experience.preview_status = PreviewStatus.GENERATING
        session.commit()

        provider = get_provider()
        if not provider.is_available():
            from app.ai.base import ProviderNotConnectedError

            raise ProviderNotConnectedError("AI_PROVIDER_NOT_CONNECTED: preview provider is not connected.")

        definition = experience_definition(session, experience.id)
        image_bytes = Path(source.storage_path).read_bytes() if source is not None else None
        prompt = (
            f"{ORIGINAL_PREVIEW_GUARD}\n\n"
            f"Experience name: {definition.name}\n"
            f"Experience description: {definition.description}\n"
            f"Private experience direction: {definition.prompt}"
        )
        ai_result = provider.generate(
            image_bytes,
            None,
            GenerationOptions(
                width=1024,
                height=1024,
                extra={
                    "experience": definition,
                    "prompt_override": prompt,
                    "purpose": PreviewJobPurpose.ADMIN_PREVIEW_GENERATION,
                },
            ),
        )
        if not ai_result.image_bytes:
            raise ProviderEmptyResultError("AI_EMPTY_RESULT: preview provider returned no image.")
        with Image.open(io.BytesIO(ai_result.image_bytes)) as image:
            image.load()
        target = thumbnail_asset_path(experience.id)
        save_admin_image(ai_result.image_bytes, content_type=ai_result.content_type, target=target)

        job.provider = ai_result.provider
        job.model = ai_result.model
        job.output_path = str(target)
        job.state = PreviewJobState.COMPLETED
        job.finished_at = _now()
        experience.thumbnail_path = str(target)
        experience.preview_status = PreviewStatus.READY
        experience.preview_error = None
        experience.updated_at = _now()
        session.commit()
        return job.state
    except AIProviderError as exc:
        return _fail_preview(session, job, session.get(ManagedExperience, job.experience_id) if job else None, exc.message)
    except Exception as exc:  # noqa: BLE001 - one failed preview must not kill the worker
        print(f"[preview-worker] job {job_id} failed:\n{traceback.format_exc()}", flush=True)
        return _fail_preview(session, job, session.get(ManagedExperience, job.experience_id) if job else None, f"{type(exc).__name__}: {exc}")
    finally:
        if own_session:
            session.close()


def _fail_preview(
    session: Session,
    job: PreviewGenerationJob | None,
    experience: ManagedExperience | None,
    message: str,
) -> str:
    if job is None:
        return PreviewJobState.FAILED
    job.state = PreviewJobState.FAILED
    job.error_message = message[:2000]
    job.finished_at = _now()
    if experience is not None:
        experience.preview_status = PreviewStatus.FAILED
        experience.preview_error = job.error_message
        experience.updated_at = _now()
    session.commit()
    return job.state
