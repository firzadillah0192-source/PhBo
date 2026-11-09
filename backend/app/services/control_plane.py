"""Shared accounting, audit and operational timeline primitives."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.auth_models import Account, AdminAuditLog, CreditLedgerEntry, GenerationEvent, SubscriptionPlan
from app.models import _uuid


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _json(value: dict[str, Any] | None) -> str | None:
    return json.dumps(value, separators=(",", ":"), sort_keys=True) if value else None


def record_audit(
    db: Session,
    *,
    actor_id: str,
    action: str,
    target_type: str,
    target_id: str,
    reason: str = "",
    metadata: dict[str, Any] | None = None,
) -> AdminAuditLog:
    row = AdminAuditLog(
        admin_actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        reason=reason,
        metadata_json=_json(metadata),
    )
    db.add(row)
    db.flush()
    return row


def record_generation_event(
    db: Session,
    job_id: str,
    event_type: str,
    detail: str = "",
    metadata: dict[str, Any] | None = None,
) -> GenerationEvent:
    row = GenerationEvent(
        job_id=job_id,
        event_type=event_type,
        detail=detail,
        metadata_json=_json(metadata),
    )
    db.add(row)
    db.flush()
    return row


def record_ledger(
    db: Session,
    *,
    amount: int,
    entry_type: str,
    reason: str,
    idempotency_key: str,
    user_id: str | None = None,
    guest_id: str | None = None,
    related_generation_id: str | None = None,
    admin_actor_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> CreditLedgerEntry:
    existing = db.query(CreditLedgerEntry).filter(CreditLedgerEntry.idempotency_key == idempotency_key).one_or_none()
    if existing is not None:
        return existing
    row = CreditLedgerEntry(
        user_id=user_id,
        guest_id=guest_id,
        amount=amount,
        type=entry_type,
        reason=reason,
        related_generation_id=related_generation_id,
        admin_actor_id=admin_actor_id,
        idempotency_key=idempotency_key,
        metadata_json=_json(metadata),
    )
    db.add(row)
    db.flush()
    return row


def ensure_signup_grant(db: Session, account: Account, *, source: str) -> CreditLedgerEntry:
    return record_ledger(
        db,
        user_id=account.id,
        amount=5,
        entry_type="signup_bonus",
        reason="Initial account signup allocation",
        idempotency_key=f"signup_bonus:{source}:{account.id}",
        metadata={"source": source},
    )


class CreditAdjustmentError(ValueError):
    pass


def adjust_account_credits(
    db: Session,
    *,
    account_id: str,
    amount: int,
    reason: str,
    actor_id: str,
    idempotency_key: str,
) -> tuple[Account, CreditLedgerEntry, bool]:
    if amount == 0:
        raise CreditAdjustmentError("amount must not be zero")
    account = db.query(Account).filter(Account.id == account_id).with_for_update().one_or_none()
    if account is None:
        raise CreditAdjustmentError("user not found")
    existing = db.query(CreditLedgerEntry).filter(CreditLedgerEntry.idempotency_key == idempotency_key).one_or_none()
    if existing is not None:
        if existing.user_id != account_id or existing.amount != amount:
            raise CreditAdjustmentError("idempotency key already used for another adjustment")
        return account, existing, False
    if amount < 0 and account.ai_quota_total - account.ai_quota_used - account.ai_quota_reserved < abs(amount):
        raise CreditAdjustmentError("available AI credits are insufficient")
    account.ai_quota_total += amount
    account.updated_at = now_utc()
    ledger = record_ledger(
        db,
        user_id=account.id,
        amount=amount,
        entry_type="admin_grant" if amount > 0 else "admin_adjustment",
        reason=reason,
        idempotency_key=idempotency_key,
        admin_actor_id=actor_id,
    )
    return account, ledger, True


def grant_subscription_credits(
    db: Session,
    *,
    account: Account,
    plan: SubscriptionPlan,
    subscription_id: str,
    period_key: str,
) -> CreditLedgerEntry | None:
    if plan.monthly_ai_credits <= 0:
        return None
    amount = plan.monthly_ai_credits
    key = f"subscription_grant:{subscription_id}:{period_key}"
    existing = db.query(CreditLedgerEntry).filter(CreditLedgerEntry.idempotency_key == key).one_or_none()
    if existing is not None:
        return existing
    account.ai_quota_total += amount
    account.updated_at = now_utc()
    return record_ledger(
        db,
        user_id=account.id,
        amount=amount,
        entry_type="subscription_grant",
        reason=f"Manual subscription allocation for {plan.code}",
        idempotency_key=key,
        metadata={"plan_id": plan.id, "period_key": period_key},
    )
