"""Admin-only usage, generation and provider-operations visibility."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.admin_auth import AdminPrincipal, require_admin_csrf, require_admin_roles, require_admin_session
from app.auth_models import (
    Account, AdminAuditLog, AuthIdentity, AuthSession, CreditLedgerEntry,
    GenerationEvent, QuotaReservation, Subscription, SubscriptionPlan,
)
from app.db import get_db
from app.models import GenerationJob, GenerationMode, GenerationProviderRun, JobState, Result, ResultClaim
from app.services.claims import is_claim_expired
from app.usage_schemas import (
    GenerationUsageItem, GenerationUsagePage, ProviderAccountDistributionItem,
    ProviderOverviewResponse, ProviderRunResponse, UsageOverviewResponse,
    UserUsageItem, UserUsagePage,
)

router = APIRouter(
    prefix="/api/admin/usage",
    tags=["admin-usage"],
    dependencies=[Depends(require_admin_session), Depends(require_admin_csrf)],
)
OPERATOR = Depends(require_admin_roles("operator"))
STRATEGY_MESSAGE = (
    "Routing strategy is managed externally by 9Router / unavailable from application context."
)


def _not_found(kind: str, value: str) -> None:
    raise HTTPException(
        status_code=404,
        detail={"error_code": f"{kind.upper()}_NOT_FOUND", "message": f"{kind} '{value}' not found"},
    )


def _json(value: str | None) -> dict | None:
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _active_subscription(db: Session, account_id: str):
    return (
        db.query(Subscription, SubscriptionPlan)
        .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
        .filter(Subscription.user_id == account_id, Subscription.status == "active")
        .order_by(Subscription.created_at.desc())
        .first()
    )


def _sum_ledger(db: Session, account_id: str, *, positive: bool = False, entry_type: str | None = None) -> int:
    query = db.query(func.coalesce(func.sum(CreditLedgerEntry.amount), 0)).filter(
        CreditLedgerEntry.user_id == account_id
    )
    if positive:
        query = query.filter(CreditLedgerEntry.amount > 0)
    if entry_type:
        query = query.filter(CreditLedgerEntry.type == entry_type)
    return int(query.scalar() or 0)


def _refunded_credits(db: Session, account_id: str | None = None) -> int:
    query = db.query(func.coalesce(func.sum(QuotaReservation.amount), 0)).filter(
        QuotaReservation.status == "REFUNDED"
    )
    if account_id:
        query = query.filter(QuotaReservation.account_id == account_id)
    return int(query.scalar() or 0)


def _user_item(db: Session, account: Account) -> UserUsageItem:
    identity = (
        db.query(AuthIdentity)
        .filter(AuthIdentity.account_id == account.id)
        .order_by(AuthIdentity.created_at.asc())
        .first()
    )
    subscription = _active_subscription(db, account.id)
    success_advanced = db.query(func.count(GenerationJob.id)).filter(
        GenerationJob.account_id == account.id,
        GenerationJob.mode == GenerationMode.ADVANCED,
        GenerationJob.state == JobState.COMPLETED,
    ).scalar() or 0
    failed_advanced = db.query(func.count(GenerationJob.id)).filter(
        GenerationJob.account_id == account.id,
        GenerationJob.mode == GenerationMode.ADVANCED,
        GenerationJob.state == JobState.FAILED,
    ).scalar() or 0
    basic = db.query(func.count(GenerationJob.id)).filter(
        GenerationJob.account_id == account.id,
        GenerationJob.mode == GenerationMode.BASIC,
    ).scalar() or 0
    last_generation = db.query(func.max(GenerationJob.created_at)).filter(
        GenerationJob.account_id == account.id
    ).scalar()
    last_activity = max(
        (value for value in (account.last_activity_at, last_generation) if value is not None),
        default=None,
    )
    return UserUsageItem(
        account_id=account.id,
        email=account.email,
        display_name=account.display_name,
        account_status=account.status,
        signup_date=account.created_at,
        auth_provider=identity.provider if identity else "password",
        plan=subscription[1].code if subscription else None,
        subscription_status=subscription[0].status if subscription else None,
        total_ai_credits_granted=_sum_ledger(db, account.id, positive=True),
        total_ai_credits_spent=abs(_sum_ledger(db, account.id, entry_type="generation_spend")),
        total_ai_credits_refunded=_refunded_credits(db, account.id),
        current_remaining_credits=max(
            0, account.ai_quota_total - account.ai_quota_used - account.ai_quota_reserved
        ),
        successful_advanced_generations=int(success_advanced),
        failed_advanced_generations=int(failed_advanced),
        total_basic_generations=int(basic),
        last_activity_at=last_activity,
    )


def _latest_run(db: Session, job_id: str) -> GenerationProviderRun | None:
    return (
        db.query(GenerationProviderRun)
        .filter(GenerationProviderRun.generation_job_id == job_id)
        .order_by(GenerationProviderRun.created_at.desc())
        .first()
    )


def _credit_state(db: Session, job_id: str) -> str:
    reservation = db.query(QuotaReservation).filter(QuotaReservation.job_id == job_id).one_or_none()
    if reservation is None:
        return "not_applicable"
    return {
        "RESERVED": "reserved", "CONSUMED": "spent", "REFUNDED": "refunded"
    }.get(reservation.status, reservation.status.lower())


def _run_item(run: GenerationProviderRun) -> ProviderRunResponse:
    return ProviderRunResponse(
        id=run.id,
        generation_job_id=run.generation_job_id,
        provider_name=run.provider_name,
        provider_model=run.provider_model,
        requested_model=run.requested_model,
        provider_reported_model=run.provider_reported_model,
        provider_request_id=run.provider_request_id,
        router_request_id=run.router_request_id,
        upstream_request_id=run.upstream_request_id,
        provider_account_label=run.provider_account_label,
        provider_account_id=run.provider_account_id,
        provider_strategy_hint=run.provider_strategy_hint,
        routing_strategy=run.routing_strategy,
        provider_usage=_json(run.provider_usage_raw_json),
        usage_available=run.usage_available,
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        input_text_tokens=run.input_text_tokens,
        input_image_tokens=run.input_image_tokens,
        output_image_tokens=run.output_image_tokens,
        total_tokens=run.total_tokens,
        billable_units=run.billable_units,
        provider_reported_cost=run.provider_reported_cost,
        upstream_status=run.upstream_status,
        upstream_error_code=run.upstream_error_code,
        upstream_error_message=run.upstream_error_message,
        retry_count=run.retry_count,
        attempt_count=run.attempt_count,
        failover_count=run.failover_count,
        request_started_at=run.request_started_at,
        request_completed_at=run.request_completed_at,
        total_duration_ms=run.total_duration_ms,
        router_duration_ms=run.router_duration_ms,
        application_duration_ms=run.application_duration_ms,
        created_at=run.created_at,
    )


def _generation_item(db: Session, job: GenerationJob) -> GenerationUsageItem:
    account = db.get(Account, job.account_id) if job.account_id else None
    run = _latest_run(db, job.id)
    duration_ms = run.total_duration_ms if run else None
    if duration_ms is None and job.started_at and job.finished_at:
        duration_ms = max(0, int((job.finished_at - job.started_at).total_seconds() * 1000))
    upstream_account = None
    if run:
        upstream_account = run.provider_account_label or run.provider_account_id
    return GenerationUsageItem(
        job_id=job.id,
        account_id=job.account_id,
        user_email=account.email if account else None,
        guest_id=job.guest_id,
        mode=job.mode,
        experience_id=job.experience_id,
        template_id=job.template_id or None,
        status=job.state,
        credit_state=_credit_state(db, job.id),
        provider=run.provider_name if run else job.provider,
        model=run.provider_model if run else job.model,
        upstream_account=upstream_account,
        requested_model=run.requested_model if run else job.model,
        provider_reported_model=run.provider_reported_model if run else run.provider_model if run else None,
        router_request_id=run.router_request_id if run else None,
        upstream_request_id=run.upstream_request_id if run else run.provider_request_id if run else None,
        routing_strategy=run.routing_strategy if run else None,
        attempt_count=run.attempt_count if run else None,
        retry_count=run.retry_count if run else None,
        failover_count=run.failover_count if run else None,
        total_tokens=run.total_tokens if run else None,
        router_duration_ms=run.router_duration_ms if run else None,
        application_duration_ms=run.application_duration_ms if run else None,
        usage_available=bool(run and run.provider_usage_raw_json),
        duration_ms=duration_ms,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


def _provider_facts(db: Session) -> tuple[list[GenerationProviderRun], list[tuple[str | None, str | None]]]:
    runs = db.query(GenerationProviderRun).all()
    accounts = sorted(
        {(row.provider_account_label, row.provider_account_id) for row in runs
         if row.provider_account_label or row.provider_account_id},
        key=lambda value: ((value[0] or ""), (value[1] or "")),
    )
    return runs, accounts


@router.get("/overview", response_model=UsageOverviewResponse)
def usage_overview(db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    active_since = datetime.now(timezone.utc) - timedelta(days=30)
    advanced = db.query(func.count(GenerationJob.id)).filter(
        GenerationJob.mode == GenerationMode.ADVANCED
    ).scalar() or 0
    usage_jobs = db.query(func.count(func.distinct(GenerationProviderRun.generation_job_id))).filter(
        GenerationProviderRun.provider_usage_raw_json.isnot(None)
    ).scalar() or 0
    account_jobs = db.query(func.count(func.distinct(GenerationProviderRun.generation_job_id))).filter(
        or_(
            GenerationProviderRun.provider_account_id.isnot(None),
            GenerationProviderRun.provider_account_label.isnot(None),
        )
    ).scalar() or 0
    provider_counts = db.query(
        GenerationProviderRun.provider_name, func.count(GenerationProviderRun.id)
    ).group_by(GenerationProviderRun.provider_name).order_by(func.count(GenerationProviderRun.id).desc()).all()
    return UsageOverviewResponse(
        total_users=db.query(func.count(Account.id)).scalar() or 0,
        active_users=db.query(func.count(Account.id)).filter(
            or_(Account.last_activity_at >= active_since, Account.created_at >= active_since)
        ).scalar() or 0,
        successful_generations=db.query(func.count(GenerationJob.id)).filter(
            GenerationJob.state == JobState.COMPLETED
        ).scalar() or 0,
        failed_generations=db.query(func.count(GenerationJob.id)).filter(
            GenerationJob.state == JobState.FAILED
        ).scalar() or 0,
        credits_spent=abs(int(db.query(func.coalesce(func.sum(CreditLedgerEntry.amount), 0)).filter(
            CreditLedgerEntry.type == "generation_spend"
        ).scalar() or 0)),
        credits_refunded=_refunded_credits(db),
        advanced_jobs=int(advanced),
        provider_usage_jobs=int(usage_jobs),
        provider_account_jobs=int(account_jobs),
        usage_coverage_percent=round((usage_jobs / advanced * 100), 1) if advanced else 0.0,
        provider_account_coverage_percent=round((account_jobs / advanced * 100), 1) if advanced else 0.0,
        provider_distribution=[{"provider": name, "jobs": count} for name, count in provider_counts],
    )


@router.get("/users", response_model=UserUsagePage)
def usage_users(
    q: str | None = None,
    status: str | None = None,
    plan: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sort: str = Query(default="signup_date"),
    direction: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _principal: AdminPrincipal = OPERATOR,
):
    query = db.query(Account)
    if q:
        term = f"%{q.strip().lower()}%"
        query = query.filter(or_(
            func.lower(Account.email).like(term),
            func.lower(func.coalesce(Account.display_name, "")).like(term),
            func.lower(Account.id).like(term),
        ))
    if status:
        query = query.filter(Account.status == status)
    if date_from:
        query = query.filter(Account.created_at >= date_from)
    if date_to:
        query = query.filter(Account.created_at <= date_to)
    if plan:
        query = query.filter(Account.id.in_(
            db.query(Subscription.user_id)
            .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
            .filter(Subscription.status == "active", SubscriptionPlan.code == plan)
        ))
    columns = {
        "signup_date": Account.created_at,
        "email": Account.email,
        "status": Account.status,
        "last_activity": Account.last_activity_at,
        "credits_remaining": Account.ai_quota_total - Account.ai_quota_used - Account.ai_quota_reserved,
    }
    column = columns.get(sort, Account.created_at)
    query = query.order_by(column.asc() if direction == "asc" else column.desc())
    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return UserUsagePage(
        users=[_user_item(db, row) for row in rows],
        page=page,
        page_size=page_size,
        total=total,
        pages=max(1, math.ceil(total / page_size)),
    )


@router.get("/users/{account_id}")
def usage_user_detail(account_id: str, db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    account = db.get(Account, account_id)
    if account is None:
        _not_found("account", account_id)
    identities = db.query(AuthIdentity).filter(AuthIdentity.account_id == account_id).all()
    subscription = _active_subscription(db, account_id)
    recent = db.query(GenerationJob).filter(
        GenerationJob.account_id == account_id
    ).order_by(GenerationJob.created_at.desc()).limit(10).all()
    return {
        "user": _user_item(db, account).model_dump(),
        "identities": [
            {"provider": row.provider, "email": row.email, "created_at": row.created_at, "last_login_at": row.last_login_at}
            for row in identities
        ],
        "subscription": {
            "id": subscription[0].id,
            "plan": subscription[1].code,
            "status": subscription[0].status,
            "starts_at": subscription[0].starts_at,
            "current_period_end": subscription[0].current_period_end,
        } if subscription else None,
        "recent_generations": [_generation_item(db, row).model_dump() for row in recent],
    }


@router.get("/users/{account_id}/generations", response_model=GenerationUsagePage)
def usage_user_generations(
    account_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _principal: AdminPrincipal = OPERATOR,
):
    if db.get(Account, account_id) is None:
        _not_found("account", account_id)
    query = db.query(GenerationJob).filter(
        GenerationJob.account_id == account_id
    ).order_by(GenerationJob.created_at.desc())
    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return GenerationUsagePage(
        generations=[_generation_item(db, row) for row in rows],
        page=page, page_size=page_size, total=total,
        pages=max(1, math.ceil(total / page_size)),
    )


@router.get("/users/{account_id}/credits")
def usage_user_credits(
    account_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _principal: AdminPrincipal = OPERATOR,
):
    account = db.get(Account, account_id)
    if account is None:
        _not_found("account", account_id)
    query = db.query(CreditLedgerEntry).filter(
        CreditLedgerEntry.user_id == account_id
    ).order_by(CreditLedgerEntry.created_at.desc())
    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "summary": _user_item(db, account).model_dump(),
        "entries": [{
            "id": row.id, "amount": row.amount, "type": row.type, "reason": row.reason,
            "related_generation_id": row.related_generation_id,
            "admin_actor_id": row.admin_actor_id, "created_at": row.created_at,
        } for row in rows],
        "page": page, "page_size": page_size, "total": total,
    }


@router.get("/generations", response_model=GenerationUsagePage)
def usage_generations(
    user: str | None = None,
    mode: str | None = Query(default=None, pattern="^(BASIC|ADVANCED)$"),
    status: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    provider_account_ref: str | None = None,
    routing_strategy: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    _principal: AdminPrincipal = OPERATOR,
):
    query = db.query(GenerationJob)
    if user:
        term = f"%{user.strip().lower()}%"
        account_ids = db.query(Account.id).filter(or_(
            func.lower(Account.email).like(term), func.lower(Account.id).like(term)
        ))
        query = query.filter(GenerationJob.account_id.in_(account_ids))
    if mode:
        query = query.filter(GenerationJob.mode == mode)
    if status:
        query = query.filter(GenerationJob.state == status.upper())
    if date_from:
        query = query.filter(GenerationJob.created_at >= date_from)
    if date_to:
        query = query.filter(GenerationJob.created_at <= date_to)
    if provider or model:
        run_jobs = db.query(GenerationProviderRun.generation_job_id)
        if provider:
            run_jobs = run_jobs.filter(GenerationProviderRun.provider_name == provider)
        if model:
            run_jobs = run_jobs.filter(GenerationProviderRun.provider_model == model)
        query = query.filter(GenerationJob.id.in_(run_jobs))
    if provider_account_ref or routing_strategy:
        run_jobs = db.query(GenerationProviderRun.generation_job_id)
        if provider_account_ref:
            run_jobs = run_jobs.filter(GenerationProviderRun.provider_account_id == provider_account_ref)
        if routing_strategy:
            run_jobs = run_jobs.filter(GenerationProviderRun.routing_strategy == routing_strategy)
        query = query.filter(GenerationJob.id.in_(run_jobs))
    query = query.order_by(GenerationJob.created_at.desc())
    total = query.count()
    rows = query.offset((page - 1) * page_size).limit(page_size).all()
    return GenerationUsagePage(
        generations=[_generation_item(db, row) for row in rows],
        page=page, page_size=page_size, total=total,
        pages=max(1, math.ceil(total / page_size)),
    )


@router.get("/generations/{job_id}")
def usage_generation_detail(job_id: str, db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    job = db.get(GenerationJob, job_id)
    if job is None:
        _not_found("generation", job_id)
    runs = db.query(GenerationProviderRun).filter(
        GenerationProviderRun.generation_job_id == job_id
    ).order_by(GenerationProviderRun.created_at.asc()).all()
    events = db.query(GenerationEvent).filter(
        GenerationEvent.job_id == job_id
    ).order_by(GenerationEvent.created_at.asc()).all()
    ledger = db.query(CreditLedgerEntry).filter(
        CreditLedgerEntry.related_generation_id == job_id
    ).order_by(CreditLedgerEntry.created_at.asc()).all()
    claims = (
        db.query(ResultClaim)
        .join(Result, Result.id == ResultClaim.result_id)
        .filter(Result.job_id == job_id)
        .order_by(ResultClaim.created_at.desc())
        .all()
    )
    return {
        "generation": _generation_item(db, job).model_dump(),
        "error_code": job.error_code,
        "error_message": job.error_message,
        "provider_runs": [_run_item(run).model_dump() for run in runs],
        "events": [{
            "type": row.event_type, "detail": row.detail,
            "metadata": _json(row.metadata_json), "created_at": row.created_at,
        } for row in events],
        "credit_history": [{
            "id": row.id, "type": row.type, "amount": row.amount,
            "reason": row.reason, "created_at": row.created_at,
        } for row in ledger],
        "claims": [{
            "claim_id": claim.id,
            "created_at": claim.created_at,
            "expires_at": claim.expires_at,
            "first_accessed_at": claim.first_accessed_at,
            "last_accessed_at": claim.last_accessed_at,
            "download_count": claim.download_count,
            "is_revoked": claim.is_revoked,
            "expired": is_claim_expired(claim.expires_at),
        } for claim in claims],
    }


@router.get("/providers/overview", response_model=ProviderOverviewResponse)
def providers_overview(db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    runs, accounts = _provider_facts(db)
    advanced = db.query(GenerationJob).filter(GenerationJob.mode == GenerationMode.ADVANCED)
    hints = sorted({row.provider_strategy_hint for row in runs if row.provider_strategy_hint})
    if len(accounts) > 1:
        evidence = "multiple_upstream_accounts_observed"
    elif len(accounts) == 1:
        evidence = "single_upstream_account_observed"
    else:
        evidence = "upstream_account_unavailable"
    durations = [row.router_duration_ms for row in runs if row.router_duration_ms is not None]
    input_tokens = [row.input_tokens for row in runs if row.input_tokens is not None]
    output_tokens = [row.output_tokens for row in runs if row.output_tokens is not None]
    total_tokens = [row.total_tokens for row in runs if row.total_tokens is not None]
    attempts = [row.attempt_count for row in runs if row.attempt_count is not None]
    return ProviderOverviewResponse(
        total_advanced_jobs=advanced.count(),
        completed=advanced.filter(GenerationJob.state == JobState.COMPLETED).count(),
        failed=advanced.filter(GenerationJob.state == JobState.FAILED).count(),
        refunded=db.query(func.count(QuotaReservation.id)).join(
            GenerationJob, GenerationJob.id == QuotaReservation.job_id
        ).filter(
            GenerationJob.mode == GenerationMode.ADVANCED,
            QuotaReservation.status == "REFUNDED",
        ).scalar() or 0,
        average_duration_ms=round(sum(durations) / len(durations), 1) if durations else None,
        jobs_with_provider_usage=len({row.generation_job_id for row in runs if row.provider_usage_raw_json}),
        jobs_with_provider_account_info=len({
            row.generation_job_id for row in runs
            if row.provider_account_id or row.provider_account_label
        }),
        configured_strategy=None,
        observed_strategy_hints=hints,
        routing_strategy_known=False,
        can_prove_round_robin=False,
        account_distribution_evidence=evidence,
        strategy_message=STRATEGY_MESSAGE,
        total_input_tokens=sum(input_tokens) if input_tokens else None,
        total_output_tokens=sum(output_tokens) if output_tokens else None,
        total_tokens=sum(total_tokens) if total_tokens else None,
        average_attempts=round(sum(attempts) / len(attempts), 2) if attempts else None,
        provider_cost_available=any(row.provider_reported_cost is not None for row in runs),
    )


@router.get("/providers/accounts", response_model=list[ProviderAccountDistributionItem])
def provider_accounts(db: Session = Depends(get_db), _principal: AdminPrincipal = OPERATOR):
    rows = db.query(GenerationProviderRun).filter(or_(
        GenerationProviderRun.provider_account_id.isnot(None),
        GenerationProviderRun.provider_account_label.isnot(None),
    )).all()
    groups = defaultdict(list)
    for row in rows:
        groups[(row.provider_account_label, row.provider_account_id)].append(row)
    result = []
    for (label, account_id), runs in groups.items():
        result.append(ProviderAccountDistributionItem(
            provider_account_label=label,
            provider_account_id=account_id,
            jobs_count=len(runs),
            success_count=sum(row.upstream_status == "SUCCEEDED" for row in runs),
            failed_count=sum(row.upstream_status != "SUCCEEDED" for row in runs),
            last_used_at=max(row.created_at for row in runs),
            total_tokens=(sum(row.total_tokens for row in runs if row.total_tokens is not None)
                          if any(row.total_tokens is not None for row in runs) else None),
            average_duration_ms=(round(sum(row.total_duration_ms for row in runs if row.total_duration_ms is not None)
                                      / len([row for row in runs if row.total_duration_ms is not None]), 1)
                                 if any(row.total_duration_ms is not None for row in runs) else None),
        ))
    return sorted(result, key=lambda item: item.jobs_count, reverse=True)
