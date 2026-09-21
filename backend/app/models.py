"""ORM models: metadata and file references only. No image binaries."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
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


class GenerationMode:
    BASIC = "BASIC"
    ADVANCED = "ADVANCED"

    ALL = (BASIC, ADVANCED)


class ErrorCode:
    VALIDATION_FAILED = "VALIDATION_FAILED"
    UPLOAD_NOT_FOUND = "UPLOAD_NOT_FOUND"
    TEMPLATE_NOT_FOUND = "TEMPLATE_NOT_FOUND"
    JOB_NOT_FOUND = "JOB_NOT_FOUND"
    RESULT_NOT_FOUND = "RESULT_NOT_FOUND"
    AI_PROVIDER_NOT_CONNECTED = "AI_PROVIDER_NOT_CONNECTED"
    AI_PROVIDER_ERROR = "AI_PROVIDER_ERROR"
    AI_EMPTY_RESULT = "AI_EMPTY_RESULT"
    BASIC_ENGINE_NOT_CONNECTED = "BASIC_ENGINE_NOT_CONNECTED"
    BASIC_FACE_NOT_FOUND = "BASIC_FACE_NOT_FOUND"
    BASIC_MULTIPLE_FACES = "BASIC_MULTIPLE_FACES"
    BASIC_LANDMARKS_UNAVAILABLE = "BASIC_LANDMARKS_UNAVAILABLE"
    BASIC_TEMPLATE_METADATA_MISSING = "BASIC_TEMPLATE_METADATA_MISSING"
    BASIC_ENGINE_ERROR = "BASIC_ENGINE_ERROR"
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
    experience_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    # Existing jobs predate modes; they used the AI path.
    mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default=GenerationMode.ADVANCED,
        server_default=GenerationMode.ADVANCED,
    )

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


class ManagedExperience(Base):
    """Admin-managed Advanced preset metadata and private prompt."""

    __tablename__ = "admin_experiences"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    thumbnail_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    internal_prompt: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(128))
    reference_mode: Mapped[str] = mapped_column(String(64), default="SINGLE_USER_IMAGE")
    output_format: Mapped[str] = mapped_column(String(16), default="PNG")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    updated_by: Mapped[str] = mapped_column(String(128), default="admin")


class ManagedTemplate(Base):
    """Admin-managed Basic template metadata and filesystem references."""

    __tablename__ = "admin_templates"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    image_path: Mapped[str] = mapped_column(String(512))
    metadata_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    updated_by: Mapped[str] = mapped_column(String(128), default="admin")
