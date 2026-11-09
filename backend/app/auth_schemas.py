from __future__ import annotations

from pydantic import BaseModel, Field


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


class AdminLoginRequest(BaseModel):
    token: str = Field(min_length=1, max_length=512)
