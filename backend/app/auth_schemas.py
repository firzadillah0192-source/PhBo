from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class UsageResponse(BaseModel):
    authenticated: bool
    quota_type: str
    ai_total: int
    ai_used: int
    ai_reserved: int
    ai_remaining: int


class SignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=256)


class LoginRequest(SignupRequest):
    pass


class GoogleSignInRequest(BaseModel):
    id_token: str = Field(min_length=20, max_length=16384)


class AccountResponse(BaseModel):
    authenticated: bool
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    provider: str | None = None
    created_at: datetime | None = None


class AccountProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, max_length=255)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class AccountCenterUsage(UsageResponse):
    used_this_period: int = 0


class AccountPlanResponse(BaseModel):
    id: str
    code: str
    name: str
    description: str = ""
    monthly_ai_credits: int | None = None
    billing_period: str | None = None
    is_active: bool = True
    status: str | None = None
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    cancel_at_period_end: bool = False


class AccountCreationResponse(BaseModel):
    result_id: str | None = None
    id: str
    job_id: str
    mode: str
    title: str
    status: str
    experience_id: str | None = None
    template_id: str | None = None
    image_url: str | None = None
    download_url: str | None = None
    created_at: datetime
    expired: bool = False


class AccountSessionResponse(BaseModel):
    id: str
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    active: bool
    is_current: bool = False


class AccountBillingResponse(BaseModel):
    enabled: bool = False
    message: str
    payment_method_available: bool = False
    invoices_available: bool = False


class AccountPrivacyResponse(BaseModel):
    creation_deletion_available: bool = False
    retention_configured: bool = False
    retention_message: str
    export_available: bool = False
    deletion_available: bool = False


class AccountCenterResponse(BaseModel):
    account: AccountResponse
    usage: AccountCenterUsage
    current_plan: AccountPlanResponse
    plans: list[AccountPlanResponse]
    creations: list[AccountCreationResponse]
    sessions: list[AccountSessionResponse]
    billing: AccountBillingResponse
    privacy: AccountPrivacyResponse


class AdminLoginRequest(BaseModel):
    token: str = Field(min_length=1, max_length=512)
