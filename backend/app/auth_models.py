"""Account, session, and quota metadata models.

These tables contain only authentication and usage metadata. Image bytes stay
in the existing filesystem storage.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models import _now, _uuid


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="active", server_default="active", index=True)
    ai_quota_total: Mapped[int] = mapped_column(Integer, default=5, server_default="5")
    ai_quota_used: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    ai_quota_reserved: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class GuestSession(Base):
    __tablename__ = "guest_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    ai_quota_total: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
    ai_quota_used: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    ai_quota_reserved: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    admin_user_id: Mapped[str | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True, index=True)
    admin_role: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class QuotaReservation(Base):
    """One AI unit reserved for a job; terminal state makes refunds idempotent."""

    __tablename__ = "quota_reservations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    job_id: Mapped[str] = mapped_column(ForeignKey("generation_jobs.id"), unique=True, index=True)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)
    guest_id: Mapped[str | None] = mapped_column(ForeignKey("guest_sessions.id"), nullable=True, index=True)
    amount: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    status: Mapped[str] = mapped_column(String(16), default="RESERVED", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuthIdentity(Base):
    """External provider identity; provider_subject is the stable key."""

    __tablename__ = "auth_identities"
    __table_args__ = (UniqueConstraint("provider", "provider_subject", name="uq_auth_identity_provider_subject"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    provider_subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AdminUser(Base):
    """Admin actor registry used for role separation and audit attribution."""

    __tablename__ = "admin_users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    role: Mapped[str] = mapped_column(String(32), default="operator", server_default="operator")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class CreditLedgerEntry(Base):
    """Immutable credit accounting event. Balance changes happen with it."""

    __tablename__ = "credit_ledger"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True, index=True)
    guest_id: Mapped[str | None] = mapped_column(ForeignKey("guest_sessions.id"), nullable=True, index=True)
    amount: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(64), index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    related_generation_id: Mapped[str | None] = mapped_column(ForeignKey("generation_jobs.id"), nullable=True, index=True)
    admin_actor_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    monthly_ai_credits: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    billing_period: Mapped[str] = mapped_column(String(32), default="month", server_default="month")
    price_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("subscription_plans.id"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", server_default="active", index=True)
    source: Mapped[str] = mapped_column(String(32), default="manual", server_default="manual")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    current_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    external_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    external_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class GenerationEvent(Base):
    __tablename__ = "generation_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    job_id: Mapped[str] = mapped_column(ForeignKey("generation_jobs.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    admin_actor_id: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(96), index=True)
    target_type: Mapped[str] = mapped_column(String(64), index=True)
    target_id: Mapped[str] = mapped_column(String(128), index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
