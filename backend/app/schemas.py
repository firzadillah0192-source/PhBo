"""Pydantic request/response schemas — the single source of API contract truth.

Frontend and backend share exactly these shapes (see docs/API_CONTRACT.md).
"""

from __future__ import annotations

from datetime import datetime

from typing import Literal

from pydantic import BaseModel, Field

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
class TemplateResponse(BaseModel):
    id: str
    name: str
    description: str
    preview_url: str | None = None
    width: int
    height: int


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
    upload_id: str = Field(min_length=1, description="ID returned by POST /api/uploads")
    template_id: str = Field(min_length=1, description="ID from GET /api/templates")
    mode: Literal["BASIC", "ADVANCED"] = Field(
        default="ADVANCED", description="Defaults to ADVANCED for existing clients"
    )


class GenerationCreateResponse(BaseModel):
    job_id: str
    state: str = Field(description="One of QUEUED / PROCESSING / COMPLETED / FAILED")
    upload_id: str
    template_id: str
    mode: Literal["BASIC", "ADVANCED"]
    created_at: datetime


# ---------------------------------------------------------------------------
# GET /api/generations/{job_id}
# ---------------------------------------------------------------------------
class GenerationStatusResponse(BaseModel):
    job_id: str
    state: str
    upload_id: str
    template_id: str
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
    template_id: str
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


__all__ = [
    "ErrorCode",
    "JobState",
    "HealthResponse",
    "ErrorResponse",
    "TemplateResponse",
    "TemplateListResponse",
    "UploadResponse",
    "GenerationCreateRequest",
    "GenerationCreateResponse",
    "GenerationStatusResponse",
    "ResultResponse",
]
