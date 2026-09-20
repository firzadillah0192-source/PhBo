"""ORM models: metadata and file references only. No image binaries."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def new_id() -> str:
    """Public id helper.

    Used when a row's primary key is needed BEFORE the INSERT (e.g. to derive
    a filesystem path), because SQLAlchemy column defaults only fire at flush.
    """
    return _uuid()


def _now() -> datetime:
    return datetime.now(timezone.utc)


class JobState:
    """Explicit generation job states (per spec section 13)."""

    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

    ALL = (QUEUED, PROCESSING, COMPLETED, FAILED)


class ErrorCode:
    VALIDATION_FAILED = "VALIDATION_FAILED"
    UPLOAD_NOT_FOUND = "UPLOAD_NOT_FOUND"
    TEMPLATE_NOT_FOUND = "TEMPLATE_NOT_FOUND"
    JOB_NOT_FOUND = "JOB_NOT_FOUND"
    RESULT_NOT_FOUND = "RESULT_NOT_FOUND"
    AI_PROVIDER_NOT_CONNECTED = "AI_PROVIDER_NOT_CONNECTED"
    AI_PROVIDER_ERROR = "AI_PROVIDER_ERROR"
    AI_EMPTY_RESULT = "AI_EMPTY_RESULT"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class Upload(Base):
    __tablename__ = "uploads"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    # File reference only — the bytes live on disk.
    storage_path: Mapped[str] = mapped_column(String(512))
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    format: Mapped[str] = mapped_column(String(16))
    sha256: Mapped[str] = mapped_column(String(64))

    validation_status: Mapped[str] = mapped_column(String(16), default="VALID")
    validation_detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    jobs: Mapped[list["GenerationJob"]] = relationship(back_populates="upload")


class GenerationJob(Base):
    __tablename__ = "generation_jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    upload_id: Mapped[str] = mapped_column(ForeignKey("uploads.id"), index=True)
    template_id: Mapped[str] = mapped_column(String(128), index=True)

    state: Mapped[str] = mapped_column(String(16), default=JobState.QUEUED, index=True)

    # Failure evidence: explicit code + human message. Never hidden.
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    upload: Mapped[Upload] = relationship(back_populates="jobs")
    result: Mapped["Result | None"] = relationship(
        back_populates="job", uselist=False, cascade="all, delete-orphan"
    )


class Result(Base):
    __tablename__ = "results"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    job_id: Mapped[str] = mapped_column(
        ForeignKey("generation_jobs.id"), unique=True, index=True
    )
    template_id: Mapped[str] = mapped_column(String(128))

    # File reference only.
    storage_path: Mapped[str] = mapped_column(String(512))
    content_type: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))

    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)

    job: Mapped[GenerationJob] = relationship(back_populates="result")
