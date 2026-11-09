"""Customer guest session, password compatibility, and Google sign-in."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import (
    ACCOUNT_COOKIE,
    GUEST_COOKIE,
    clear_cookie,
    create_auth_session,
    delete_auth_session,
    hash_password,
    normalize_email,
    set_account_cookie,
    unsign_value,
    verify_password,
)
from app.auth_models import Account, AuthIdentity
from app.auth_schemas import AccountResponse, GoogleSignInRequest, LoginRequest, SignupRequest, UsageResponse
from app.dependencies import get_identity
from app.db import get_db
from app.models import ErrorCode, GenerationJob, Upload
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
    )


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
def account_me(identity=Depends(get_identity)) -> AccountResponse:
    return _account_response(identity.account)


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
