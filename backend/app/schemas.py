"""Pydantic request/response schemas — the single source of API contract truth.

Frontend and backend share exactly these shapes (see docs/API_CONTRACT.md).
"""

from __future__ import annotations

from datetime import datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import ErrorCode, JobState


# ---------------------------------------------------------------------------
# Shared
# ---------------------------------------------------------------------------
class HealthResponse(BaseModel):
    status: str = Field(description="'ok' if API up, 'degraded' if a dependency is down")
    app: str
    environment: str
    checks: dict[str, str] = Field(
        default_factory=dict, description="per-dependency status: database, redis, ai_provider"
    )
    ai_provider: str = Field(description="configured provider name, or 'none'")
    ai_provider_connected: bool = Field(
        description="False means generation will fail with AI_PROVIDER_NOT_CONNECTED"
    )


class ErrorResponse(BaseModel):
    error_code: str
    message: str
    detail: str | None = None


# ---------------------------------------------------------------------------
# GET /api/templates
# ---------------------------------------------------------------------------
class ExperienceResponse(BaseModel):
    id: str
    name: str
    description: str
    category: str
    thumbnail: str | None = None
    enabled: bool
    sort_order: int = 0
    availability: str


class ExperienceListResponse(BaseModel):
    experiences: list[ExperienceResponse]
    count: int


class TemplateResponse(BaseModel):
    id: str
    name: str
    description: str
    preview_url: str | None = None
    width: int
    height: int
    basic_available: bool = False
    enabled: bool = True
    sort_order: int = 0


class TemplateListResponse(BaseModel):
    templates: list[TemplateResponse]
    count: int


# ---------------------------------------------------------------------------
# POST /api/uploads
# ---------------------------------------------------------------------------
class UploadResponse(BaseModel):
    upload_id: str
    filename: str
    content_type: str
    size_bytes: int
    width: int
    height: int
    format: str
    sha256: str
    validation_status: str = Field(description="'VALID'")
    preview_url: str
    created_at: datetime


# ---------------------------------------------------------------------------
# POST /api/generations
# ---------------------------------------------------------------------------
class GenerationCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    upload_id: str = Field(min_length=1, description="ID returned by POST /api/uploads")
    mode: Literal["BASIC", "ADVANCED"]
    template_id: str | None = Field(default=None, min_length=1)
    experience_id: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def validate_mode_inputs(self):
        if self.mode == "BASIC" and not self.template_id:
            raise ValueError("template_id is required for BASIC mode")
        if self.mode == "ADVANCED" and not self.experience_id:
            raise ValueError("experience_id is required for ADVANCED mode")
        if self.mode == "BASIC" and self.experience_id:
            raise ValueError("experience_id is not accepted for BASIC mode")
        if self.mode == "ADVANCED" and self.template_id:
            raise ValueError("template_id is not accepted for ADVANCED mode")
        return self


class GenerationCreateResponse(BaseModel):
    job_id: str
    state: str = Field(description="One of QUEUED / PROCESSING / COMPLETED / FAILED")
    upload_id: str
    template_id: str | None
    experience_id: str | None
    mode: Literal["BASIC", "ADVANCED"]
    created_at: datetime


# ---------------------------------------------------------------------------
# GET /api/generations/{job_id}
# ---------------------------------------------------------------------------
class GenerationStatusResponse(BaseModel):
    job_id: str
    state: str
    upload_id: str
    template_id: str | None
    experience_id: str | None
    mode: Literal["BASIC", "ADVANCED"]
    provider: str | None = None
    model: str | None = None
    error_code: str | None = Field(
        default=None,
        description=(
            "Set when state=FAILED. Includes AI_PROVIDER_NOT_CONNECTED when no "
            "real provider is connected."
        ),
    )
    error_message: str | None = None
    result_id: str | None = Field(default=None, description="Present when state=COMPLETED")
    result_url: str | None = None
    download_url: str | None = None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


# ---------------------------------------------------------------------------
# GET /api/results/{result_id}
# ---------------------------------------------------------------------------
class ResultResponse(BaseModel):
    result_id: str
    job_id: str
    template_id: str | None
    content_type: str
    size_bytes: int
    width: int
    height: int
    sha256: str
    provider: str | None = None
    model: str | None = None
    result_url: str
    download_url: str
    created_at: datetime


class ResultClaimCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reuse_token: str | None = Field(default=None, min_length=32, max_length=256)
    refresh: bool = False
    kiosk: bool = False


class ResultClaimResponse(BaseModel):
    claim_url: str
    qr_payload: str
    expires_at: datetime


class PublicResultResponse(BaseModel):
    image_url: str
    download_url: str
    expires_at: datetime
    created_at: datetime
    content_type: str
    width: int
    height: int
    download_count: int = 0


# ---------------------------------------------------------------------------
# Admin catalog API (all protected routes require an admin session cookie)
# ---------------------------------------------------------------------------
class AdminExperienceResponse(BaseModel):
    id: str
    name: str
    description: str
    thumbnail_path: str | None = None
    internal_prompt: str
    provider: str
    model: str
    reference_mode: str
    output_format: str
    status: Literal["draft", "published", "disabled"]
    category: str
    preview_missing: bool
    preview_status: Literal["MISSING", "GENERATING", "READY", "FAILED"]
    preview_error: str | None = None
    enabled: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime
    updated_by: str


class AdminExperienceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=128)
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    internal_prompt: str = Field(min_length=1)
    provider: str = "9router"
    model: str = "cx/gpt-image-2.5"
    reference_mode: str = "SINGLE_USER_IMAGE"
    output_format: str = "PNG"
    status: Literal["draft", "published", "disabled"] = "draft"
    category: str = Field(default="Design", min_length=1, max_length=64)
    enabled: bool = True
    sort_order: int = 0


class AdminExperiencePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    internal_prompt: str | None = Field(default=None, min_length=1)
    status: Literal["draft", "published", "disabled"] | None = None
    category: str | None = Field(default=None, min_length=1, max_length=64)
    enabled: bool | None = None
    sort_order: int | None = None


class AdminTemplateResponse(BaseModel):
    id: str
    name: str
    description: str
    image_path: str
    marketing_preview_path: str | None = None
    metadata_path: str | None = None
    preview_missing: bool
    processing_asset_present: bool
    marketing_preview_url: str | None = None
    enabled: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime
    updated_by: str


class AdminTemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=128)
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    enabled: bool = True
    sort_order: int = 0


class AdminTemplatePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    enabled: bool | None = None
    sort_order: int | None = None


class AdminConfirmRequest(BaseModel):
    confirm: bool = False


class PreviewSourceResponse(BaseModel):
    id: str
    source_type: str
    has_asset: bool
    content_type: str | None = None
    updated_at: datetime
    updated_by: str


class PreviewJobResponse(BaseModel):
    id: str
    experience_id: str
    source_id: str
    purpose: Literal["admin_preview_generation"]
    state: Literal["QUEUED", "PROCESSING", "COMPLETED", "FAILED"]
    provider: str | None = None
    model: str | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class PreviewBatchRequest(BaseModel):
    confirm: bool = False
    source_id: str = "portrait-default"


class PreviewBatchResponse(BaseModel):
    queued: int
    skipped_ready: int
    jobs: list[PreviewJobResponse]


__all__ = [
    "ErrorCode",
    "JobState",
    "HealthResponse",
    "ErrorResponse",
    "ExperienceResponse",
    "ExperienceListResponse",
    "TemplateResponse",
    "TemplateListResponse",
    "UploadResponse",
    "GenerationCreateRequest",
    "GenerationCreateResponse",
    "GenerationStatusResponse",
    "ResultResponse",
    "AdminExperienceResponse", "AdminExperienceCreate", "AdminExperiencePatch",
    "AdminTemplateResponse", "AdminTemplateCreate", "AdminTemplatePatch",
    "AdminConfirmRequest", "PreviewSourceResponse", "PreviewJobResponse",
    "PreviewBatchRequest", "PreviewBatchResponse",
]
