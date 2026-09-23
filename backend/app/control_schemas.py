from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class UserListItem(BaseModel):
    id: str
    name: str | None = None
    email: str
    avatar_url: str | None = None
    auth_provider: str | None = None
    status: str
    subscription_plan: str | None = None
    ai_remaining: int
    ai_total: int
    ai_used: int
    total_generations: int
    last_activity_at: datetime | None = None
    created_at: datetime


class UserListResponse(BaseModel):
    users: list[UserListItem]
    page: int
    page_size: int
    total: int
    pages: int


class CreditActionRequest(BaseModel):
    amount: int = Field(ge=-100000, le=100000)
    @field_validator("amount")
    @classmethod
    def amount_must_not_be_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("amount must not be zero")
        return value
    reason: str = Field(min_length=3, max_length=1000)
    confirm: bool = False
    idempotency_key: str | None = Field(default=None, max_length=255)


class UserStatusRequest(BaseModel):
    status: Literal["active", "suspended"]
    reason: str = Field(min_length=3, max_length=1000)
    confirm: bool = False


class SubscriptionPlanCreate(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=64)
    code: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]*$", max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    monthly_ai_credits: int = Field(default=0, ge=0, le=100000)
    billing_period: str = Field(default="month", min_length=1, max_length=32)
    price_amount: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=8)
    is_active: bool = True


class SubscriptionPlanPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    monthly_ai_credits: int | None = Field(default=None, ge=0, le=100000)
    billing_period: str | None = Field(default=None, min_length=1, max_length=32)
    price_amount: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, max_length=8)
    is_active: bool | None = None


class ResultClaimRevokeRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)
    confirm: bool = False


class SubscriptionActionRequest(BaseModel):
    action: Literal["assign", "activate", "cancel", "expire"]
    plan_id: str | None = None
    reason: str = Field(min_length=3, max_length=1000)
    confirm: bool = False


class AdminUserCreate(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=64)
    name: str = Field(min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=320)
    role: Literal["superadmin", "operator", "content_manager"] = "operator"
    is_active: bool = True


class AdminUserPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=320)
    role: Literal["superadmin", "operator", "content_manager"] | None = None
    is_active: bool | None = None


class AdminUserResponse(BaseModel):
    id: str
    name: str
    email: str | None
    role: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class AuditResponse(BaseModel):
    id: str
    admin_actor_id: str
    action: str
    target_type: str
    target_id: str
    reason: str
    metadata: dict | None = None
    created_at: datetime


class GenerationAdminItem(BaseModel):
    job_id: str
    user_id: str | None
    user_email: str | None
    guest_id: str | None
    mode: str
    experience_id: str | None
    template_id: str | None
    state: str
    credit_state: str
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    duration_seconds: float | None


class GenerationListResponse(BaseModel):
    jobs: list[GenerationAdminItem]
    page: int
    page_size: int
    total: int
    pages: int


class OverviewResponse(BaseModel):
    total_users: int
    new_users_today: int
    active_users: int
    advanced_generations_today: int
    successful_generations: int
    failed_generations: int
    queued_jobs: int
    processing_jobs: int
    ai_credits_consumed: int
    active_subscriptions: int
    total_experiences: int = 0
    published_experiences: int = 0
    draft_experiences: int = 0
    disabled_experiences: int = 0
    missing_experience_previews: int = 0


class SettingsResponse(BaseModel):
    environment: str
    ai_provider: str
    google_configured: bool
    upload_max_bytes: int
    upload_min_dimension: int
    upload_max_dimension: int
    admin_default_role: str
