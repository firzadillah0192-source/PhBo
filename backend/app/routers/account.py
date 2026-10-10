"""Customer guest session, password compatibility, and Google sign-in."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, or_

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import (
    ACCOUNT_COOKIE,
    _hash_token,
    GUEST_COOKIE,
    clear_cookie,
    create_auth_session,
    delete_auth_session,
    hash_password,
    normalize_email,
    require_account,
    set_account_cookie,
    unsign_value,
    verify_password,
)
from app.auth_models import (
    Account,
    AuthIdentity,
    AuthSession,
    CreditLedgerEntry,
    Subscription,
    SubscriptionPlan,
)
from app.auth_schemas import (
    AccountCenterResponse,
    AccountCreationResponse,
    AccountProfilePatch,
    AccountResponse,
    AccountSessionResponse,
    AccountPlanResponse,
    AccountCenterUsage,
    GoogleSignInRequest,
    LoginRequest,
    SignupRequest,
    UsageResponse,
)
from app.dependencies import get_identity
from app.db import get_db
from app.models import ErrorCode, GenerationJob, ManagedExperience, ManagedTemplate, Result, Upload
from app.services.control_plane import ensure_signup_grant
from app.services.google_auth import verify_google_id_token
from app.services.quota import usage_for

router = APIRouter(prefix="/api/account", tags=["account"])


def _account_response(account: Account | None, provider: str | None = None) -> AccountResponse:
    return AccountResponse(
        authenticated=account is not None,
        email=account.email if account else None,
        display_name=account.display_name if account else None,
        avatar_url=account.avatar_url if account else None,
        provider=provider,
        created_at=account.created_at if account else None,
    )


def _provider_for_account(db: Session, account_id: str) -> str:
    identity = (
        db.query(AuthIdentity)
        .filter(AuthIdentity.account_id == account_id)
        .order_by(AuthIdentity.created_at.asc())
        .first()
    )
    return identity.provider if identity else "password"


def _validate_email(email: str) -> str:
    normalized = normalize_email(email)
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
        raise HTTPException(status_code=422, detail={"error_code": ErrorCode.VALIDATION_FAILED, "message": "Enter a valid email address."})
    return normalized


def _transfer_guest_ownership(db: Session, request: Request, account: Account) -> None:
    guest_id = unsign_value(request.cookies.get(GUEST_COOKIE))
    if not guest_id:
        return
    db.query(Upload).filter(Upload.guest_id == guest_id).update(
        {Upload.account_id: account.id, Upload.guest_id: None}, synchronize_session=False
    )
    db.query(GenerationJob).filter(GenerationJob.guest_id == guest_id).update(
        {GenerationJob.account_id: account.id, GenerationJob.guest_id: None}, synchronize_session=False
    )


def _start_account_session(response: Response, db: Session, account: Account) -> None:
    account.last_login_at = datetime.now(timezone.utc)
    account.last_activity_at = account.last_login_at
    token = create_auth_session(db, account_id=account.id)
    set_account_cookie(response, token)


@router.get("/usage", response_model=UsageResponse)
def account_usage(identity=Depends(get_identity)) -> UsageResponse:
    usage = usage_for(identity)
    return UsageResponse(
        authenticated=usage.authenticated,
        quota_type=usage.quota_type,
        ai_total=usage.ai_total,
        ai_used=usage.ai_used,
        ai_reserved=usage.ai_reserved,
        ai_remaining=usage.ai_remaining,
    )


@router.get("/me", response_model=AccountResponse)
def account_me(identity=Depends(get_identity), db: Session = Depends(get_db)) -> AccountResponse:
    provider = _provider_for_account(db, identity.account.id) if identity.account else None
    return _account_response(identity.account, provider)


@router.patch("/profile", response_model=AccountResponse)
def update_profile(
    payload: AccountProfilePatch,
    identity=Depends(get_identity),
    db: Session = Depends(get_db),
) -> AccountResponse:
    account = require_account(identity)
    account.display_name = payload.display_name
    account.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(account)
    return _account_response(account, _provider_for_account(db, account.id))


@router.post("/signup", response_model=AccountResponse, status_code=201)
def signup(payload: SignupRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> AccountResponse:
    email = _validate_email(payload.email)
    if db.query(Account).filter(Account.email == email).first() is not None:
        raise HTTPException(status_code=409, detail={"error_code": ErrorCode.ACCOUNT_EXISTS, "message": "An account with this email already exists."})
    account = Account(email=email, password_hash=hash_password(payload.password), status="active")
    db.add(account)
    try:
        db.flush()
        ensure_signup_grant(db, account, source="password")
        _transfer_guest_ownership(db, request, account)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail={"error_code": ErrorCode.ACCOUNT_EXISTS, "message": "An account with this email already exists."}) from exc
    _start_account_session(response, db, account)
    return _account_response(account, "password")


@router.post("/google", response_model=AccountResponse)
def google_sign_in(payload: GoogleSignInRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> AccountResponse:
    try:
        claims = verify_google_id_token(payload.id_token)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail={"error_code": "GOOGLE_AUTH_UNAVAILABLE", "message": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=401, detail={"error_code": "GOOGLE_TOKEN_INVALID", "message": "Google sign-in could not be verified."}) from exc

    identity = db.query(AuthIdentity).filter(
        AuthIdentity.provider == "google",
        AuthIdentity.provider_subject == claims.subject,
    ).one_or_none()
    created = False
    if identity is None:
        # Email is profile metadata, never the provider identity key. Linking an
        # already verified local account avoids duplicate user records.
        account = db.query(Account).filter(Account.email == claims.email).one_or_none()
        if account is None:
            account = Account(
                email=claims.email,
                password_hash=hash_password("google-unusable-" + secrets.token_urlsafe(32)),
                display_name=claims.name,
                avatar_url=claims.avatar_url,
                status="active",
            )
            db.add(account)
            db.flush()
            ensure_signup_grant(db, account, source="google")
            created = True
        identity = AuthIdentity(
            account_id=account.id,
            provider="google",
            provider_subject=claims.subject,
            email=claims.email,
        )
        db.add(identity)
    else:
        account = db.get(Account, identity.account_id)
        if account is None:
            raise HTTPException(status_code=409, detail={"error_code": "AUTH_IDENTITY_ORPHANED", "message": "Google identity is not linked to an account."})
    if account.status == "suspended":
        raise HTTPException(status_code=403, detail={"error_code": "ACCOUNT_SUSPENDED", "message": "This account is suspended."})
    identity.email = claims.email
    identity.last_login_at = datetime.now(timezone.utc)
    if claims.name:
        account.display_name = claims.name
    if claims.avatar_url:
        account.avatar_url = claims.avatar_url
    _transfer_guest_ownership(db, request, account)
    db.commit()
    _start_account_session(response, db, account)
    clear_cookie(response, GUEST_COOKIE)
    return _account_response(account, "google")


@router.post("/login", response_model=AccountResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)) -> AccountResponse:
    account = db.query(Account).filter(Account.email == normalize_email(payload.email)).first()
    if account is None or not verify_password(payload.password, account.password_hash):
        raise HTTPException(status_code=401, detail={"error_code": ErrorCode.INVALID_CREDENTIALS, "message": "Email or password is incorrect."})
    if account.status == "suspended":
        raise HTTPException(status_code=403, detail={"error_code": "ACCOUNT_SUSPENDED", "message": "This account is suspended."})
    _start_account_session(response, db, account)
    return _account_response(account, "password")


@router.post("/logout", response_model=AccountResponse)
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> AccountResponse:
    delete_auth_session(db, unsign_value(request.cookies.get(ACCOUNT_COOKIE)))
    clear_cookie(response, ACCOUNT_COOKIE)
    return AccountResponse(authenticated=False)



def _account_plan(plan: SubscriptionPlan | None, subscription: Subscription | None = None) -> dict:
    if plan is None:
        return {
            "id": "free",
            "code": "free",
            "name": "Free",
            "description": "Try the product",
            "monthly_ai_credits": None,
            "billing_period": None,
            "is_active": True,
            "status": "active",
            "current_period_start": None,
            "current_period_end": None,
            "cancel_at_period_end": False,
        }
    return {
        "id": plan.id,
        "code": plan.code,
        "name": plan.name,
        "description": plan.description or "",
        "monthly_ai_credits": plan.monthly_ai_credits if plan.monthly_ai_credits > 0 else None,
        "billing_period": plan.billing_period,
        "is_active": plan.is_active,
        "status": subscription.status if subscription else None,
        "current_period_start": subscription.current_period_start if subscription else None,
        "current_period_end": subscription.current_period_end if subscription else None,
        "cancel_at_period_end": subscription.cancel_at_period_end if subscription else False,
    }


def _account_creation(db: Session, job: GenerationJob) -> AccountCreationResponse:
    experience = db.get(ManagedExperience, job.experience_id) if job.experience_id else None
    template = db.get(ManagedTemplate, job.template_id) if job.template_id else None
    title = (experience.name if experience else None) or (template.name if template else None) or job.experience_id or job.template_id or "Photobooth creation"
    result = job.result
    file_available = bool(result and Path(result.storage_path).is_file())
    image_url = f"/api/results/{result.id}/image" if result and file_available else None
    download_url = f"/api/results/{result.id}/download" if result and file_available else None
    return AccountCreationResponse(
        result_id=result.id if result else None,
        id=result.id if result else job.id,
        job_id=job.id,
        mode=job.mode,
        title=title,
        status=job.state,
        experience_id=job.experience_id,
        template_id=job.template_id or None,
        image_url=image_url,
        download_url=download_url,
        created_at=job.created_at,
        expired=bool(job.state == "COMPLETED" and result and not file_available),
    )


def _session_active(expires_at: datetime) -> bool:
    value = expires_at.replace(tzinfo=timezone.utc) if expires_at.tzinfo is None else expires_at
    return value > datetime.now(timezone.utc)


@router.get("/center", response_model=AccountCenterResponse)
def account_center(
    request: Request,
    identity=Depends(get_identity),
    db: Session = Depends(get_db),
) -> AccountCenterResponse:
    account = require_account(identity)
    provider = _provider_for_account(db, account.id)
    active_pair = (
        db.query(Subscription, SubscriptionPlan)
        .join(SubscriptionPlan, SubscriptionPlan.id == Subscription.plan_id)
        .filter(Subscription.user_id == account.id, Subscription.status == "active")
        .order_by(Subscription.created_at.desc())
        .first()
    )
    subscription, plan = active_pair if active_pair else (None, None)
    period_start = subscription.current_period_start if subscription else account.created_at
    used_this_period = abs(int(db.query(func.coalesce(func.sum(CreditLedgerEntry.amount), 0)).filter(
        CreditLedgerEntry.user_id == account.id,
        CreditLedgerEntry.type == "generation_spend",
        CreditLedgerEntry.created_at >= period_start,
    ).scalar() or 0))
    usage = usage_for(identity)
    current_raw = unsign_value(request.cookies.get(ACCOUNT_COOKIE))
    current_session_id = _hash_token(current_raw) if current_raw else None
    sessions = [
        AccountSessionResponse(
            id=row.id,
            created_at=row.created_at,
            last_seen_at=row.last_seen_at,
            expires_at=row.expires_at,
            active=_session_active(row.expires_at),
            is_current=row.id == current_session_id,
        )
        for row in db.query(AuthSession)
        .filter(AuthSession.account_id == account.id, AuthSession.is_admin.is_(False))
        .order_by(AuthSession.created_at.desc())
        .limit(20)
        .all()
    ]
    jobs = (
        db.query(GenerationJob)
        .outerjoin(Result, Result.job_id == GenerationJob.id)
        .filter(GenerationJob.account_id == account.id)
        .filter(or_(Result.id.is_(None), Result.deleted_at.is_(None)))
        .order_by(GenerationJob.created_at.desc())
        .limit(100)
        .all()
    )
    plans = [
        _account_plan(row)
        for row in db.query(SubscriptionPlan)
        .filter(SubscriptionPlan.is_active.is_(True))
        .order_by(SubscriptionPlan.created_at.asc())
        .all()
    ]
    return AccountCenterResponse(
        account=_account_response(account, provider),
        usage=AccountCenterUsage(
            authenticated=usage.authenticated,
            quota_type=usage.quota_type,
            ai_total=usage.ai_total,
            ai_used=usage.ai_used,
            ai_reserved=usage.ai_reserved,
            ai_remaining=usage.ai_remaining,
            used_this_period=used_this_period,
        ),
        current_plan=AccountPlanResponse(**_account_plan(plan, subscription)),
        plans=[AccountPlanResponse(**item) for item in plans],
        creations=[_account_creation(db, job) for job in jobs],
        sessions=sessions,
        billing={
            "enabled": False,
            "message": "Billing will become available when paid plans launch.",
            "payment_method_available": False,
            "invoices_available": False,
        },
        privacy={
            "creation_deletion_available": True,
            "retention_configured": False,
            "retention_message": "Generated result photos can be deleted from My Creations. Automatic retention is not configured.",
            "export_available": False,
            "deletion_available": False,
        },
    )


@router.post("/sessions/revoke-all")
def revoke_all_sessions(
    response: Response,
    identity=Depends(get_identity),
    db: Session = Depends(get_db),
) -> dict:
    account = require_account(identity)
    revoked = db.query(AuthSession).filter(
        AuthSession.account_id == account.id,
        AuthSession.is_admin.is_(False),
    ).delete(synchronize_session=False)
    db.commit()
    clear_cookie(response, ACCOUNT_COOKIE)
    return {"revoked_sessions": revoked}


@router.post("/sessions/{session_id}/revoke")
def revoke_session(
    session_id: str,
    request: Request,
    response: Response,
    identity=Depends(get_identity),
    db: Session = Depends(get_db),
) -> dict:
    account = require_account(identity)
    row = db.query(AuthSession).filter(
        AuthSession.id == session_id,
        AuthSession.account_id == account.id,
        AuthSession.is_admin.is_(False),
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail={"error_code": "SESSION_NOT_FOUND", "message": "That session is no longer active."})
    current_raw = unsign_value(request.cookies.get(ACCOUNT_COOKIE))
    is_current = bool(current_raw and _hash_token(current_raw) == row.id)
    db.delete(row)
    db.commit()
    if is_current:
        clear_cookie(response, ACCOUNT_COOKIE)
    return {"revoked": True, "current": is_current}
