"""Atomic AI quota reservation with auditable, idempotent settlement."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.auth import Identity
from app.auth_models import Account, GuestSession, QuotaReservation
from app.services.control_plane import record_generation_event, record_ledger


class QuotaExhausted(Exception):
    """No available AI unit remained when the database update ran."""


@dataclass(frozen=True)
class Usage:
    authenticated: bool
    quota_type: str
    ai_total: int
    ai_used: int
    ai_reserved: int

    @property
    def ai_remaining(self) -> int:
        return max(0, self.ai_total - self.ai_used - self.ai_reserved)


def usage_for(identity: Identity) -> Usage:
    owner = identity.account or identity.guest
    if owner is None:
        raise RuntimeError("identity has no account or guest session")
    return Usage(
        authenticated=identity.authenticated,
        quota_type="account" if identity.authenticated else "guest",
        ai_total=owner.ai_quota_total,
        ai_used=owner.ai_quota_used,
        ai_reserved=owner.ai_quota_reserved,
    )


def _reserve_update(db: Session, identity: Identity) -> QuotaReservation:
    """Run one conditional UPDATE; predicate and increment are atomic."""
    if identity.account is not None:
        owner_id = identity.account.id
        statement = (
            update(Account)
            .where(
                Account.id == owner_id,
                Account.ai_quota_total > Account.ai_quota_used + Account.ai_quota_reserved,
            )
            .values(ai_quota_reserved=Account.ai_quota_reserved + 1)
        )
        result = db.execute(statement)
        reservation = QuotaReservation(account_id=owner_id, amount=1)
    elif identity.guest is not None:
        owner_id = identity.guest.id
        statement = (
            update(GuestSession)
            .where(
                GuestSession.id == owner_id,
                GuestSession.ai_quota_total > GuestSession.ai_quota_used + GuestSession.ai_quota_reserved,
            )
            .values(ai_quota_reserved=GuestSession.ai_quota_reserved + 1)
        )
        result = db.execute(statement)
        reservation = QuotaReservation(guest_id=owner_id, amount=1)
    else:
        raise QuotaExhausted
    if result.rowcount != 1:
        raise QuotaExhausted
    return reservation


def reserve_for_job(db: Session, identity: Identity, job_id: str) -> QuotaReservation:
    reservation = _reserve_update(db, identity)
    reservation.job_id = job_id
    db.add(reservation)
    db.flush()
    record_ledger(
        db,
        user_id=reservation.account_id,
        guest_id=reservation.guest_id,
        amount=0,
        entry_type="generation_reservation",
        reason="Advanced generation credit reserved",
        idempotency_key=f"generation_reservation:{job_id}",
        related_generation_id=job_id,
    )
    record_generation_event(db, job_id, "credit_reserved", "One Advanced AI credit reserved")
    return reservation


def settle_for_job(db: Session, job_id: str, *, successful: bool) -> bool:
    """Settle once; subsequent calls are no-ops and cannot double-refund."""
    reservation = (
        db.query(QuotaReservation)
        .filter(QuotaReservation.job_id == job_id)
        .with_for_update()
        .one_or_none()
    )
    if reservation is None or reservation.status != "RESERVED":
        return False

    now = datetime.now(timezone.utc)
    if reservation.account_id:
        owner = db.get(Account, reservation.account_id)
    else:
        owner = db.get(GuestSession, reservation.guest_id) if reservation.guest_id else None
    if owner is not None:
        db.refresh(owner)
        owner.ai_quota_reserved = max(0, owner.ai_quota_reserved - reservation.amount)
        if successful:
            owner.ai_quota_used += reservation.amount

    reservation.status = "CONSUMED" if successful else "REFUNDED"
    reservation.settled_at = now
    record_ledger(
        db,
        user_id=reservation.account_id,
        guest_id=reservation.guest_id,
        amount=-reservation.amount if successful else 0,
        entry_type="generation_spend" if successful else "generation_refund",
        reason="Advanced generation completed" if successful else "Advanced generation failed; reservation returned",
        idempotency_key=f"generation_spend:{job_id}" if successful else f"generation_refund:{job_id}",
        related_generation_id=job_id,
    )
    record_generation_event(
        db,
        job_id,
        "credit_finalized" if successful else "credit_refunded",
        "Credit consumed" if successful else "Credit reservation refunded",
    )
    return True
