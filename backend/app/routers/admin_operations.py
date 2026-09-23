"""Operational Admin control-plane APIs.

All routes are session-protected server-side. Token-header access remains only
as a transitional superadmin mechanism in the existing admin auth dependency.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.admin_auth import AdminPrincipal, require_admin_csrf, require_admin_roles, require_admin_session
from app.auth_models import (
    Account, AdminAuditLog, AdminUser, AuthIdentity, AuthSession, CreditLedgerEntry,
    GenerationEvent, QuotaReservation, Subscription, SubscriptionPlan,
)
from app.control_schemas import (
    AdminUserCreate, AdminUserPatch, AdminUserResponse, AuditResponse, CreditActionRequest,
    GenerationAdminItem, GenerationListResponse, OverviewResponse, SettingsResponse,
    SubscriptionActionRequest, SubscriptionPlanCreate, SubscriptionPlanPatch, ResultClaimRevokeRequest,
    UserListItem, UserListResponse, UserStatusRequest,
)
from app.core.config import get_settings
from app.db import get_db
from app.models import ExperienceStatus, GenerationJob, JobState, ManagedExperience, Result, ResultClaim
from app.services.claims import is_claim_expired
from app.services.control_plane import (
    CreditAdjustmentError, adjust_account_credits, grant_subscription_credits,
    now_utc, record_audit, record_generation_event,
)

router = APIRouter(
    prefix="/api/admin",
    tags=["admin-operations"],
    dependencies=[Depends(require_admin_session), Depends(require_admin_csrf)],
)

OPERATOR = Depends(require_admin_roles("operator"))
CONTENT = Depends(require_admin_roles("content_manager"))
SUPERADMIN = Depends(require_admin_roles("superadmin"))


def _not_found(kind: str, item_id: str) -> None:
    raise HTTPException(status_code=404, detail={"error_code": f"{kind.upper()}_NOT_FOUND", "message": f"{kind} '{item_id}' not found"})


def _require_confirm(confirm: bool) -> None:
    if not confirm:
        raise HTTPException(status_code=400, detail={"error_code": "CONFIRMATION_REQUIRED", "message": "This action requires explicit confirmation."})


def _json(value: str | None) -> dict | None:
    if not value:
        return None
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _active_subscription(db: Session, user_id: str) -> tuple[Subscription, SubscriptionPlan] | None:
    row = (
        db.query(Subscription, SubscriptionPlan)
        .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
        .filter(Subscription.user_id == user_id, Subscription.status == "active")
        .order_by(Subscription.created_at.desc())
        .first()
    )
    return row


def _user_item(db: Session, account: Account) -> UserListItem:
    identity = db.query(AuthIdentity).filter(AuthIdentity.account_id == account.id).order_by(AuthIdentity.created_at.asc()).first()
    sub = _active_subscription(db, account.id)
    total_generations = db.query(func.count(GenerationJob.id)).filter(GenerationJob.account_id == account.id).scalar() or 0
    last_generation = db.query(func.max(GenerationJob.created_at)).filter(GenerationJob.account_id == account.id).scalar()
    last_activity = max((value for value in (account.last_activity_at, last_generation) if value is not None), default=None)
    return UserListItem(
        id=account.id,
        name=account.display_name,
        email=account.email,
        avatar_url=account.avatar_url,
        auth_provider=identity.provider if identity else "password",
        status=account.status,
        subscription_plan=sub[1].code if sub else None,
        ai_remaining=max(0, account.ai_quota_total - account.ai_quota_used - account.ai_quota_reserved),
        ai_total=account.ai_quota_total,
        ai_used=account.ai_quota_used,
        total_generations=int(total_generations),
        last_activity_at=last_activity,
        created_at=account.created_at,
    )


def _subscription_dict(db: Session, row: Subscription | None) -> dict | None:
    if row is None:
        return None
    plan = db.get(SubscriptionPlan, row.plan_id)
    return {
        "id": row.id,
        "user_id": row.user_id,
        "plan_id": row.plan_id,
        "plan_code": plan.code if plan else None,
        "plan_name": plan.name if plan else None,
        "monthly_ai_credits": plan.monthly_ai_credits if plan else 0,
        "status": row.status,
        "source": row.source,
        "starts_at": row.starts_at,
        "current_period_start": row.current_period_start,
        "current_period_end": row.current_period_end,
        "cancel_at_period_end": row.cancel_at_period_end,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _generation_item(db: Session, job: GenerationJob) -> GenerationAdminItem:
    account = db.get(Account, job.account_id) if job.account_id else None
    reservation = db.query(QuotaReservation).filter(QuotaReservation.job_id == job.id).one_or_none()
    if reservation is None:
        credit_state = "not_applicable"
    elif reservation.status == "RESERVED":
        credit_state = "reserved"
    elif reservation.status == "CONSUMED":
        credit_state = "spent"
    else:
        credit_state = "refunded"
    duration = None
    if job.started_at and job.finished_at:
        duration = max(0.0, (job.finished_at - job.started_at).total_seconds())
    return GenerationAdminItem(
        job_id=job.id,
        user_id=job.account_id,
        user_email=account.email if account else None,
        guest_id=job.guest_id,
        mode=job.mode,
        experience_id=job.experience_id,
        template_id=job.template_id or None,
        state=job.state,
        credit_state=credit_state,
        created_at=job.created_at,
        updated_at=job.updated_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        duration_seconds=duration,
    )


def _audit_item(row: AdminAuditLog) -> AuditResponse:
    return AuditResponse(
        id=row.id,
        admin_actor_id=row.admin_actor_id,
        action=row.action,
        target_type=row.target_type,
        target_id=row.target_id,
        reason=row.reason,
        metadata=_json(row.metadata_json),
        created_at=row.created_at,
    )


@router.get("/overview", response_model=OverviewResponse)
def overview(db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    now = now_utc()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    active_since = now - timedelta(days=30)
    experiences = db.query(ManagedExperience).all()
    return OverviewResponse(
        total_users=db.query(func.count(Account.id)).scalar() or 0,
        new_users_today=db.query(func.count(Account.id)).filter(Account.created_at >= today).scalar() or 0,
        active_users=db.query(func.count(Account.id)).filter(or_(Account.last_activity_at >= active_since, Account.created_at >= active_since)).scalar() or 0,
        advanced_generations_today=db.query(func.count(GenerationJob.id)).filter(GenerationJob.mode == "ADVANCED", GenerationJob.created_at >= today).scalar() or 0,
        successful_generations=db.query(func.count(GenerationJob.id)).filter(GenerationJob.state == JobState.COMPLETED).scalar() or 0,
        failed_generations=db.query(func.count(GenerationJob.id)).filter(GenerationJob.state == JobState.FAILED).scalar() or 0,
        queued_jobs=db.query(func.count(GenerationJob.id)).filter(GenerationJob.state == JobState.QUEUED).scalar() or 0,
        processing_jobs=db.query(func.count(GenerationJob.id)).filter(GenerationJob.state == JobState.PROCESSING).scalar() or 0,
        ai_credits_consumed=abs(db.query(func.coalesce(func.sum(CreditLedgerEntry.amount), 0)).filter(CreditLedgerEntry.type == "generation_spend").scalar() or 0),
        active_subscriptions=db.query(func.count(Subscription.id)).filter(Subscription.status == "active").scalar() or 0,
        total_experiences=len(experiences),
        published_experiences=sum(row.status == ExperienceStatus.PUBLISHED for row in experiences),
        draft_experiences=sum(row.status == ExperienceStatus.DRAFT for row in experiences),
        disabled_experiences=sum(row.status == ExperienceStatus.DISABLED for row in experiences),
        missing_experience_previews=sum(
            not bool(row.thumbnail_path and Path(row.thumbnail_path).is_file())
            for row in experiences
        ),
    )


@router.get("/users", response_model=UserListResponse)
def users(
    search: str | None = None,
    status: str | None = Query(default=None, pattern="^(active|suspended)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    sort: str = Query(default="created_at"),
    direction: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    _principal: AdminPrincipal = OPERATOR,
):
    query = db.query(Account)
    if search:
        term = f"%{search.strip().lower()}%"
        query = query.filter(or_(func.lower(Account.email).like(term), func.lower(func.coalesce(Account.display_name, "")).like(term)))
    if status:
        query = query.filter(Account.status == status)
    sort_columns = {"created_at": Account.created_at, "last_activity": Account.last_activity_at, "email": Account.email, "credits": Account.ai_quota_total}
    column = sort_columns.get(sort, Account.created_at)
    query = query.order_by(column.asc() if direction == "asc" else column.desc())
    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return UserListResponse(users=[_user_item(db, row) for row in rows], page=page, page_size=page_size, total=total, pages=max(1, math.ceil(total / page_size)))


@router.get("/users/{user_id}")
def user_detail(user_id: str, db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    account = db.get(Account, user_id)
    if account is None:
        _not_found("user", user_id)
    identities = db.query(AuthIdentity).filter(AuthIdentity.account_id == user_id).all()
    active = _active_subscription(db, user_id)
    return {
        "user": _user_item(db, account).model_dump(),
        "identities": [{"provider": item.provider, "provider_subject": item.provider_subject, "email": item.email, "created_at": item.created_at, "last_login_at": item.last_login_at} for item in identities],
        "subscription": _subscription_dict(db, active[0] if active else None),
    }


@router.get("/users/{user_id}/credits")
def user_credits(user_id: str, page: int = Query(default=1, ge=1), page_size: int = Query(default=50, ge=1, le=200), db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    account = db.get(Account, user_id)
    if account is None:
        _not_found("user", user_id)
    query = db.query(CreditLedgerEntry).filter(CreditLedgerEntry.user_id == user_id).order_by(CreditLedgerEntry.created_at.desc())
    total = query.count()
    entries = query.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "balance": {"total": account.ai_quota_total, "used": account.ai_quota_used, "reserved": account.ai_quota_reserved, "remaining": max(0, account.ai_quota_total - account.ai_quota_used - account.ai_quota_reserved)},
        "entries": [{"id": row.id, "amount": row.amount, "type": row.type, "reason": row.reason, "related_generation_id": row.related_generation_id, "admin_actor_id": row.admin_actor_id, "idempotency_key": row.idempotency_key, "created_at": row.created_at} for row in entries],
        "page": page, "page_size": page_size, "total": total,
    }


@router.get("/users/{user_id}/generations")
def user_generations(user_id: str, db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    if db.get(Account, user_id) is None:
        _not_found("user", user_id)
    return [_generation_item(db, job).model_dump() for job in db.query(GenerationJob).filter(GenerationJob.account_id == user_id).order_by(GenerationJob.created_at.desc()).limit(100).all()]


@router.get("/users/{user_id}/sessions")
def user_sessions(user_id: str, db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    if db.get(Account, user_id) is None:
        _not_found("user", user_id)
    return [{"id": row.id[-12:], "created_at": row.created_at, "last_seen_at": row.last_seen_at, "expires_at": row.expires_at, "active": row.expires_at > now_utc()} for row in db.query(AuthSession).filter(AuthSession.account_id == user_id, AuthSession.is_admin.is_(False)).order_by(AuthSession.created_at.desc()).all()]


@router.get("/users/{user_id}/audit")
def user_audit(user_id: str, db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    if db.get(Account, user_id) is None:
        _not_found("user", user_id)
    return [_audit_item(row).model_dump() for row in db.query(AdminAuditLog).filter(AdminAuditLog.target_id == user_id).order_by(AdminAuditLog.created_at.desc()).limit(100).all()]


@router.patch("/users/{user_id}/status")
def user_status(user_id: str, payload: UserStatusRequest, db: Session = Depends(get_db), principal: AdminPrincipal = OPERATOR):
    _require_confirm(payload.confirm)
    account = db.get(Account, user_id)
    if account is None:
        _not_found("user", user_id)
    account.status = payload.status
    account.updated_at = now_utc()
    revoked = 0
    if payload.status == "suspended":
        revoked = db.query(AuthSession).filter(AuthSession.account_id == user_id, AuthSession.is_admin.is_(False)).delete(synchronize_session=False)
    record_audit(db, actor_id=principal.actor_id, action="user_suspended" if payload.status == "suspended" else "user_unsuspended", target_type="user", target_id=user_id, reason=payload.reason, metadata={"revoked_sessions": revoked})
    db.commit()
    return {"status": account.status, "revoked_sessions": revoked}


@router.post("/users/{user_id}/sessions/revoke")
def revoke_sessions(user_id: str, payload: UserStatusRequest, db: Session = Depends(get_db), principal: AdminPrincipal = OPERATOR):
    _require_confirm(payload.confirm)
    if db.get(Account, user_id) is None:
        _not_found("user", user_id)
    revoked = db.query(AuthSession).filter(AuthSession.account_id == user_id, AuthSession.is_admin.is_(False)).delete(synchronize_session=False)
    record_audit(db, actor_id=principal.actor_id, action="sessions_revoked", target_type="user", target_id=user_id, reason=payload.reason, metadata={"count": revoked})
    db.commit()
    return {"revoked_sessions": revoked}


@router.post("/users/{user_id}/credits")
def adjust_credits(user_id: str, payload: CreditActionRequest, db: Session = Depends(get_db), principal: AdminPrincipal = OPERATOR):
    _require_confirm(payload.confirm)
    key = payload.idempotency_key or f"admin_adjustment:{principal.actor_id}:{user_id}:{now_utc().timestamp()}"
    try:
        account, ledger, changed = adjust_account_credits(db, account_id=user_id, amount=payload.amount, reason=payload.reason, actor_id=principal.actor_id, idempotency_key=key)
    except CreditAdjustmentError as exc:
        if str(exc) == "user not found":
            _not_found("user", user_id)
        raise HTTPException(status_code=422, detail={"error_code": "CREDIT_ADJUSTMENT_REJECTED", "message": str(exc)}) from exc
    if changed:
        record_audit(db, actor_id=principal.actor_id, action="credit_granted" if payload.amount > 0 else "credit_deducted", target_type="user", target_id=user_id, reason=payload.reason, metadata={"amount": payload.amount, "ledger_id": ledger.id})
        db.commit()
    return {"changed": changed, "ledger_id": ledger.id, "balance": {"total": account.ai_quota_total, "used": account.ai_quota_used, "reserved": account.ai_quota_reserved, "remaining": max(0, account.ai_quota_total - account.ai_quota_used - account.ai_quota_reserved)}}


@router.get("/credits/ledger")
def ledger(page: int = Query(default=1, ge=1), page_size: int = Query(default=50, ge=1, le=200), entry_type: str | None = None, db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    query = db.query(CreditLedgerEntry).order_by(CreditLedgerEntry.created_at.desc())
    if entry_type:
        query = query.filter(CreditLedgerEntry.type == entry_type)
    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return {"entries": [{"id": row.id, "user_id": row.user_id, "guest_id": row.guest_id, "amount": row.amount, "type": row.type, "reason": row.reason, "related_generation_id": row.related_generation_id, "admin_actor_id": row.admin_actor_id, "created_at": row.created_at} for row in rows], "page": page, "page_size": page_size, "total": total}


@router.get("/plans")
def plans(db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    return [{"id": row.id, "code": row.code, "name": row.name, "description": row.description, "monthly_ai_credits": row.monthly_ai_credits, "billing_period": row.billing_period, "price_amount": row.price_amount, "currency": row.currency, "is_active": row.is_active, "created_at": row.created_at, "updated_at": row.updated_at} for row in db.query(SubscriptionPlan).order_by(SubscriptionPlan.created_at.asc()).all()]


@router.post("/plans", status_code=201)
def create_plan(payload: SubscriptionPlanCreate, db: Session = Depends(get_db), principal: AdminPrincipal = SUPERADMIN):
    if db.get(SubscriptionPlan, payload.id) or db.query(SubscriptionPlan).filter(SubscriptionPlan.code == payload.code).first():
        raise HTTPException(status_code=409, detail={"error_code": "PLAN_EXISTS", "message": "Plan id or code already exists."})
    row = SubscriptionPlan(**payload.model_dump())
    db.add(row)
    record_audit(db, actor_id=principal.actor_id, action="plan_created", target_type="plan", target_id=row.id, metadata={"code": row.code})
    db.commit()
    db.refresh(row)
    return row


@router.patch("/plans/{plan_id}")
def patch_plan(plan_id: str, payload: SubscriptionPlanPatch, db: Session = Depends(get_db), principal: AdminPrincipal = SUPERADMIN):
    row = db.get(SubscriptionPlan, plan_id)
    if row is None:
        _not_found("plan", plan_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    row.updated_at = now_utc()
    record_audit(db, actor_id=principal.actor_id, action="plan_changed", target_type="plan", target_id=row.id, metadata=payload.model_dump(exclude_unset=True))
    db.commit()
    return row


@router.get("/subscriptions")
def subscriptions(db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    rows = db.query(Subscription).order_by(Subscription.updated_at.desc()).limit(200).all()
    return [{**(_subscription_dict(db, row) or {}), "user_email": db.get(Account, row.user_id).email if db.get(Account, row.user_id) else None} for row in rows]


@router.post("/users/{user_id}/subscription")
def subscription_action(user_id: str, payload: SubscriptionActionRequest, db: Session = Depends(get_db), principal: AdminPrincipal = OPERATOR):
    _require_confirm(payload.confirm)
    account = db.get(Account, user_id)
    if account is None:
        _not_found("user", user_id)
    current = _active_subscription(db, user_id)
    if payload.action in {"assign", "activate"}:
        if not payload.plan_id:
            raise HTTPException(status_code=422, detail={"error_code": "PLAN_REQUIRED", "message": "plan_id is required for assignment."})
        plan = db.get(SubscriptionPlan, payload.plan_id)
        if plan is None:
            _not_found("plan", payload.plan_id)
        if current and current[0].plan_id == plan.id:
            subscription = current[0]
        else:
            if current:
                current[0].status = "expired"
            start = now_utc()
            subscription = Subscription(user_id=user_id, plan_id=plan.id, status="active", source="manual", starts_at=start, current_period_start=start, current_period_end=start + timedelta(days=30))
            db.add(subscription)
            db.flush()
        grant_subscription_credits(db, account=account, plan=plan, subscription_id=subscription.id, period_key=subscription.current_period_start.date().isoformat())
    else:
        if not current:
            raise HTTPException(status_code=404, detail={"error_code": "SUBSCRIPTION_NOT_FOUND", "message": "No active subscription found."})
        subscription = current[0]
        subscription.status = "cancelled" if payload.action == "cancel" else "expired"
        subscription.cancel_at_period_end = payload.action == "cancel"
        plan = db.get(SubscriptionPlan, subscription.plan_id)
    record_audit(db, actor_id=principal.actor_id, action=f"subscription_{payload.action}", target_type="subscription", target_id=subscription.id, reason=payload.reason, metadata={"user_id": user_id, "plan_id": subscription.plan_id})
    db.commit()
    return _subscription_dict(db, subscription)


@router.get("/generations", response_model=GenerationListResponse)
def generations(
    state: str | None = Query(default=None),
    mode: str | None = Query(default=None, pattern="^(BASIC|ADVANCED)$"),
    user_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _principal: AdminPrincipal = OPERATOR,
):
    query = db.query(GenerationJob).order_by(GenerationJob.created_at.desc())
    if state:
        query = query.filter(GenerationJob.state == state.upper())
    if mode:
        query = query.filter(GenerationJob.mode == mode)
    if user_id:
        query = query.filter(GenerationJob.account_id == user_id)
    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return GenerationListResponse(jobs=[_generation_item(db, row) for row in rows], page=page, page_size=page_size, total=total, pages=max(1, math.ceil(total / page_size)))


@router.get("/generations/{job_id}")
def generation_detail(job_id: str, db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    job = db.get(GenerationJob, job_id)
    if job is None:
        _not_found("generation", job_id)
    events = db.query(GenerationEvent).filter(GenerationEvent.job_id == job_id).order_by(GenerationEvent.created_at.asc()).all()
    claims = (
        db.query(ResultClaim)
        .join(Result, Result.id == ResultClaim.result_id)
        .filter(Result.job_id == job_id)
        .order_by(ResultClaim.created_at.desc())
        .all()
    )
    claim_items = [
        {
            "claim_id": claim.id,
            "created_at": claim.created_at,
            "expires_at": claim.expires_at,
            "first_accessed_at": claim.first_accessed_at,
            "last_accessed_at": claim.last_accessed_at,
            "download_count": claim.download_count,
            "is_revoked": claim.is_revoked,
            "expired": is_claim_expired(claim.expires_at),
        }
        for claim in claims
    ]
    return {
        "job": _generation_item(db, job).model_dump(),
        "error_code": job.error_code,
        "error_message": job.error_message,
        "claims": claim_items,
        "events": [{"type": event.event_type, "detail": event.detail, "metadata": _json(event.metadata_json), "created_at": event.created_at} for event in events],
    }


@router.post("/result-claims/{claim_id}/revoke")
def revoke_result_claim(
    claim_id: str,
    payload: ResultClaimRevokeRequest,
    db: Session = Depends(get_db),
    principal: AdminPrincipal = OPERATOR,
):
    _require_confirm(payload.confirm)
    claim = db.get(ResultClaim, claim_id)
    if claim is None:
        _not_found("result claim", claim_id)
    if not claim.is_revoked:
        claim.is_revoked = True
        record_generation_event(
            db,
            claim.result.job_id,
            "claim_revoked",
            payload.reason,
            {"claim_id": claim.id},
        )
        record_audit(
            db,
            actor_id=principal.actor_id,
            action="result_claim_revoked",
            target_type="result_claim",
            target_id=claim.id,
            reason=payload.reason,
        )
        db.commit()
    return {"claim_id": claim.id, "revoked": claim.is_revoked}


@router.get("/audit", response_model=list[AuditResponse])
def audit(limit: int = Query(default=100, ge=1, le=500), action: str | None = None, db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    query = db.query(AdminAuditLog).order_by(AdminAuditLog.created_at.desc())
    if action:
        query = query.filter(AdminAuditLog.action == action)
    return [_audit_item(row) for row in query.limit(limit).all()]


@router.get("/admin-users", response_model=list[AdminUserResponse])
def admin_users(db: Session = Depends(get_db), _principal: AdminPrincipal = SUPERADMIN):
    return [AdminUserResponse.model_validate(row, from_attributes=True) for row in db.query(AdminUser).order_by(AdminUser.created_at.asc()).all()]


@router.post("/admin-users", response_model=AdminUserResponse, status_code=201)
def create_admin_user(payload: AdminUserCreate, db: Session = Depends(get_db), principal: AdminPrincipal = SUPERADMIN):
    if db.get(AdminUser, payload.id):
        raise HTTPException(status_code=409, detail={"error_code": "ADMIN_USER_EXISTS", "message": "Admin user already exists."})
    row = AdminUser(**payload.model_dump())
    db.add(row)
    record_audit(db, actor_id=principal.actor_id, action="admin_role_added", target_type="admin_user", target_id=row.id, metadata={"role": row.role})
    db.commit()
    db.refresh(row)
    return AdminUserResponse.model_validate(row, from_attributes=True)


@router.patch("/admin-users/{admin_user_id}", response_model=AdminUserResponse)
def patch_admin_user(admin_user_id: str, payload: AdminUserPatch, db: Session = Depends(get_db), principal: AdminPrincipal = SUPERADMIN):
    row = db.get(AdminUser, admin_user_id)
    if row is None:
        _not_found("admin user", admin_user_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    row.updated_at = now_utc()
    record_audit(db, actor_id=principal.actor_id, action="admin_role_changed", target_type="admin_user", target_id=row.id, metadata=payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(row)
    return AdminUserResponse.model_validate(row, from_attributes=True)


@router.get("/settings", response_model=SettingsResponse)
def settings(_principal: AdminPrincipal = OPERATOR):
    config = get_settings()
    return SettingsResponse(
        environment=config.environment,
        ai_provider=config.ai_provider,
        google_configured=bool(config.google_client_id.strip()),
        upload_max_bytes=config.upload_max_bytes,
        upload_min_dimension=config.upload_min_dimension,
        upload_max_dimension=config.upload_max_dimension,
        admin_default_role=config.admin_default_role,
    )
