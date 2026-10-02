"""ORM models: metadata and file references only. No image binaries."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
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
    CLASSIC = "CLASSIC"
    BASIC = "BASIC"
    ADVANCED = "ADVANCED"

    ALL = (CLASSIC, BASIC, ADVANCED)


class ExperienceStatus:
    """Customer publication lifecycle for Admin-managed AI experiences."""

    DRAFT = "draft"
    PUBLISHED = "published"
    DISABLED = "disabled"

    ALL = (DRAFT, PUBLISHED, DISABLED)


class PreviewStatus:
    MISSING = "MISSING"
    GENERATING = "GENERATING"
    READY = "READY"
    FAILED = "FAILED"

    ALL = (MISSING, GENERATING, READY, FAILED)


class PreviewJobPurpose:
    ADMIN_PREVIEW_GENERATION = "admin_preview_generation"


class PreviewJobState:
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

    ALL = (QUEUED, PROCESSING, COMPLETED, FAILED)


class ErrorCode:
    VALIDATION_FAILED = "VALIDATION_FAILED"
    UNSUPPORTED_IMAGE_FORMAT = "UNSUPPORTED_IMAGE_FORMAT"
    IMAGE_DECODE_FAILED = "IMAGE_DECODE_FAILED"
    IMAGE_NORMALIZATION_FAILED = "IMAGE_NORMALIZATION_FAILED"
    FACE_VALIDATION_FAILED = "FACE_VALIDATION_FAILED"
    UPLOAD_NOT_FOUND = "UPLOAD_NOT_FOUND"
    UPLOAD_EXPIRED = "UPLOAD_EXPIRED"
    UPLOAD_STORAGE_FAILED = "UPLOAD_STORAGE_FAILED"
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
    EXPERIENCE_NOT_FOUND = "EXPERIENCE_NOT_FOUND"
    BASIC_ENGINE_ERROR = "BASIC_ENGINE_ERROR"
    BASIC_IDENTITY_PROVIDER_NOT_CONFIGURED = "BASIC_IDENTITY_PROVIDER_NOT_CONFIGURED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    AI_QUOTA_EXHAUSTED = "AI_QUOTA_EXHAUSTED"
    QUEUE_UNAVAILABLE = "QUEUE_UNAVAILABLE"
    AUTHENTICATION_REQUIRED = "AUTHENTICATION_REQUIRED"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    ACCOUNT_EXISTS = "ACCOUNT_EXISTS"


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
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)
    guest_id: Mapped[str | None] = mapped_column(ForeignKey("guest_sessions.id"), nullable=True, index=True)

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
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)
    guest_id: Mapped[str | None] = mapped_column(ForeignKey("guest_sessions.id"), nullable=True, index=True)
    template_id: Mapped[str] = mapped_column(String(128), index=True)
    experience_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    layout_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    capture_upload_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    frame_style_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    ornament_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
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


class ResultClaim(Base):
    """Opaque, expiring public delivery grant for a generated result."""

    __tablename__ = "result_claims"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_result_claims_token_hash"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    result_id: Mapped[str] = mapped_column(ForeignKey("results.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    first_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    download_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", index=True)
    created_by_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    created_by_kiosk_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    result: Mapped[Result] = relationship()


class GenerationProviderRun(Base):
    """One application-visible execution attempt against an upstream provider.

    Nullable operational signals are never inferred when 9Router omits them.
    """

    __tablename__ = "generation_provider_runs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    generation_job_id: Mapped[str] = mapped_column(ForeignKey("generation_jobs.id"), index=True)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)
    provider_name: Mapped[str] = mapped_column(String(64), index=True)
    # provider_model is retained as the backwards-compatible displayed model.
    provider_model: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    requested_model: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    provider_reported_model: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    provider_request_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    router_request_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    upstream_request_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_account_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_account_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_strategy_hint: Mapped[str | None] = mapped_column(String(255), nullable=True)
    routing_strategy: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_usage_raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage_available: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_text_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_image_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_image_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    billable_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider_reported_cost: Mapped[float | None] = mapped_column(Float, nullable=True)
    upstream_status: Mapped[str] = mapped_column(String(32), index=True)
    upstream_error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    upstream_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    attempt_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failover_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    request_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    router_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    application_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class ManagedExperience(Base):
    """Admin-managed Advanced preset metadata and private prompt."""

    __tablename__ = "admin_experiences"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    thumbnail_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    preview_status: Mapped[str] = mapped_column(
        String(16), default=PreviewStatus.MISSING,
        server_default=PreviewStatus.MISSING, index=True,
    )
    preview_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_prompt: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(128))
    reference_mode: Mapped[str] = mapped_column(String(64), default="SINGLE_USER_IMAGE")
    output_format: Mapped[str] = mapped_column(String(16), default="PNG")
    compatible_frame_style_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    compatible_ornament_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    max_ornaments: Mapped[int] = mapped_column(Integer, default=3, server_default="3")
    # `enabled` is retained as a legacy/internal switch. Customer visibility
    # is governed exclusively by the explicit publication status below.
    status: Mapped[str] = mapped_column(
        String(16), default=ExperienceStatus.DRAFT,
        server_default=ExperienceStatus.DRAFT, index=True,
    )
    category: Mapped[str] = mapped_column(
        String(64), default="Design", server_default="Design", index=True,
    )
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
    marketing_preview_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    metadata_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    updated_by: Mapped[str] = mapped_column(String(128), default="admin")


class ClassicLayout(Base):
    __tablename__ = "classic_layouts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    slug: Mapped[str] = mapped_column(String(128), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    canvas_width: Mapped[int] = mapped_column(Integer)
    canvas_height: Mapped[int] = mapped_column(Integer)
    shot_count: Mapped[int] = mapped_column(Integer)
    layout_config_json: Mapped[str] = mapped_column(Text)
    frame_asset_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class AdvancedFrameStyle(Base):
    __tablename__ = "advanced_frame_styles"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    slug: Mapped[str] = mapped_column(String(128), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    prompt_fragment: Mapped[str] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class AdvancedOrnament(Base):
    __tablename__ = "advanced_ornaments"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    slug: Mapped[str] = mapped_column(String(128), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    prompt_fragment: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class PreviewSource(Base):
    """Admin-owned canonical input for internal marketing preview generation."""

    __tablename__ = "preview_sources"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    source_type: Mapped[str] = mapped_column(String(32), default="portrait")
    storage_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    updated_by: Mapped[str] = mapped_column(String(128), default="admin")


class PreviewGenerationJob(Base):
    """Internal Admin preview job; deliberately has no customer/quota owner."""

    __tablename__ = "preview_generation_jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    experience_id: Mapped[str] = mapped_column(String(128), index=True)
    source_id: Mapped[str] = mapped_column(String(128), index=True)
    purpose: Mapped[str] = mapped_column(String(64), default=PreviewJobPurpose.ADMIN_PREVIEW_GENERATION)
    state: Mapped[str] = mapped_column(String(16), default=PreviewJobState.QUEUED, index=True)
    provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    output_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by: Mapped[str] = mapped_column(String(128), default="admin")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
