"""Shared ownership, expiry, and cleanup rules for temporary customer uploads."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.auth import Identity
from app.core.config import get_settings
from app.db import SessionLocal
from app.models import GenerationJob, JobState, Upload
from app.services import storage


def upload_belongs_to_identity(upload: Upload, identity: Identity) -> bool:
    """Fail closed for legacy uploads without an owner."""
    if identity.account_id is not None:
        return upload.account_id == identity.account_id
    if identity.guest_id is not None:
        return upload.account_id is None and upload.guest_id == identity.guest_id
    return False


def upload_expires_at(upload: Upload) -> datetime:
    created_at = upload.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at + timedelta(hours=get_settings().upload_retention_hours)


def upload_is_expired(upload: Upload, *, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return upload_expires_at(upload) <= now


def upload_has_active_job(db: Session, upload: Upload) -> bool:
    return db.query(GenerationJob.id).filter(
        GenerationJob.upload_id == upload.id,
        GenerationJob.state.in_((JobState.QUEUED, JobState.PROCESSING)),
    ).first() is not None


def upload_file_is_available(upload: Upload) -> bool:
    from pathlib import Path

    return _is_controlled_upload_path(upload.storage_path) and Path(upload.storage_path).is_file()


def _is_controlled_upload_path(path: str) -> bool:
    from pathlib import Path

    settings = get_settings()
    try:
        Path(path).resolve().relative_to(settings.uploads_dir.resolve())
        return True
    except (ValueError, OSError):
        return False


def cleanup_expired_uploads(*, db: Session | None = None, now: datetime | None = None) -> dict[str, int]:
    """Delete expired upload bytes while preserving rows referenced by jobs.

    Job rows keep their foreign key for history. Upload rows without jobs are
    removed as well. Paths are validated to remain under uploads_dir, and are
    never included in logs or returned values.
    """
    owns_session = db is None
    session = db or SessionLocal()
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    cutoff = now - timedelta(hours=get_settings().upload_retention_hours)
    counts = {
        "files_removed": 0,
        "rows_removed": 0,
        "metadata_scrubbed": 0,
        "active_jobs_skipped": 0,
        "unsafe_paths_skipped": 0,
    }
    try:
        candidates = (
            session.query(Upload)
            .filter(Upload.created_at <= cutoff, Upload.storage_path != "")
            .order_by(Upload.created_at.asc())
            .all()
        )
        for upload in candidates:
            if not upload_is_expired(upload, now=now):
                continue
            active_job = session.query(GenerationJob.id).filter(
                GenerationJob.upload_id == upload.id,
                GenerationJob.state.in_((JobState.QUEUED, JobState.PROCESSING)),
            ).first()
            if active_job:
                counts["active_jobs_skipped"] += 1
                continue
            if _is_controlled_upload_path(upload.storage_path):
                if storage.delete_path(upload.storage_path):
                    counts["files_removed"] += 1
            else:
                counts["unsafe_paths_skipped"] += 1
            has_jobs = session.query(GenerationJob.id).filter(GenerationJob.upload_id == upload.id).first()
            if not has_jobs:
                session.delete(upload)
                counts["rows_removed"] += 1
            else:
                # Keep the foreign-key row for generation history, but remove
                # the customer path and identifying upload metadata.
                upload.storage_path = ""
                upload.filename = ""
                upload.content_type = "application/octet-stream"
                upload.size_bytes = 0
                upload.width = 0
                upload.height = 0
                upload.format = ""
                upload.sha256 = ""
                upload.validation_status = "EXPIRED"
                upload.validation_detail = None
                counts["metadata_scrubbed"] += 1
        session.commit()
        return counts
    except Exception:
        session.rollback()
        raise
    finally:
        if owns_session:
            session.close()
