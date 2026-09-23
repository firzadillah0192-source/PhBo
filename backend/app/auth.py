"""Signed browser cookies and server-side customer/admin sessions."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.auth_models import Account, AuthSession, GuestSession
from app.core.config import get_settings
from app.models import ErrorCode

GUEST_COOKIE = "photobooth_guest"
ACCOUNT_COOKIE = "photobooth_session"
ADMIN_COOKIE = "photobooth_admin"
KIOSK_COOKIE = "photobooth_kiosk_session"
_PROCESS_SECRET = secrets.token_bytes(32)


@dataclass(frozen=True)
class Identity:
    account: Account | None = None
    guest: GuestSession | None = None
    session_id: str | None = None

    @property
    def authenticated(self) -> bool:
        return self.account is not None

    @property
    def account_id(self) -> str | None:
        return self.account.id if self.account else None

    @property
    def guest_id(self) -> str | None:
        return self.guest.id if self.guest else None


def _secret() -> bytes:
    configured = get_settings().session_secret_key.strip()
    # Development/test can operate without a checked-in secret. Production
    # should always set SESSION_SECRET_KEY so sessions survive restarts.
    return configured.encode("utf-8") if configured else _PROCESS_SECRET


def sign_value(value: str) -> str:
    signature = hmac.new(_secret(), value.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{value}.{signature}"


def unsign_value(value: str | None) -> str | None:
    if not value or "." not in value:
        return None
    raw, signature = value.rsplit(".", 1)
    expected = hmac.new(_secret(), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    return raw


def _set_cookie(response: Response, name: str, value: str, *, max_age: int | None = None) -> None:
    settings = get_settings()
    response.set_cookie(
        name,
        sign_value(value),
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure or settings.environment.lower() in {"production", "prod"},
        samesite="lax",
        path="/",
    )


def clear_cookie(response: Response, name: str) -> None:
    response.delete_cookie(name, path="/")


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _is_active(expires_at: datetime) -> bool:
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at > datetime.now(timezone.utc)


def _new_guest(db: Session) -> GuestSession:
    guest = GuestSession(id=secrets.token_hex(32))
    db.add(guest)
    db.flush()
    return guest


def current_identity(request: Request, response: Response, db: Session) -> Identity:
    """Resolve an account session, otherwise create/reuse a guest session."""

    signed_account = unsign_value(request.cookies.get(ACCOUNT_COOKIE))
    if signed_account:
        session = db.get(AuthSession, _hash_token(signed_account))
        if session and session.account_id and _is_active(session.expires_at):
            account = db.get(Account, session.account_id)
            if account and account.status != "suspended":
                return Identity(account=account, session_id=session.id)
        clear_cookie(response, ACCOUNT_COOKIE)

    signed_guest = unsign_value(request.cookies.get(GUEST_COOKIE))
    guest = db.get(GuestSession, signed_guest) if signed_guest else None
    if guest is None:
        guest = _new_guest(db)
        db.commit()
        _set_cookie(response, GUEST_COOKIE, guest.id, max_age=60 * 60 * 24 * 365)
    return Identity(guest=guest, session_id=guest.id)


def create_auth_session(db: Session, *, account_id: str | None = None, is_admin: bool = False, admin_user_id: str | None = None, admin_role: str | None = None) -> str:
    raw_token = secrets.token_urlsafe(48)
    now = datetime.now(timezone.utc)
    settings = get_settings()
    session = AuthSession(
        id=_hash_token(raw_token),
        account_id=account_id,
        is_admin=is_admin,
        admin_user_id=admin_user_id,
        admin_role=admin_role,
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=settings.session_days),
    )
    db.add(session)
    db.commit()
    return raw_token


def set_account_cookie(response: Response, raw_token: str) -> None:
    _set_cookie(response, ACCOUNT_COOKIE, raw_token, max_age=60 * 60 * 24 * get_settings().session_days)


def set_admin_cookie(response: Response, raw_token: str) -> None:
    _set_cookie(response, ADMIN_COOKIE, raw_token, max_age=60 * 60 * 24 * get_settings().session_days)


def ensure_kiosk_session(
    request: Request, response: Response, *, rotate: bool = False
) -> str:
    """Return a server-generated kiosk session hash and set it when absent."""
    raw = unsign_value(request.cookies.get(KIOSK_COOKIE))
    if rotate or not raw or len(raw) < 32:
        raw = secrets.token_urlsafe(32)
        _set_cookie(response, KIOSK_COOKIE, raw, max_age=60 * 60 * 12)
    return _hash_token(raw)


def delete_auth_session(db: Session, raw_token: str | None) -> None:
    if raw_token:
        session = db.get(AuthSession, _hash_token(raw_token))
        if session:
            db.delete(session)
            db.commit()


def require_account(identity: Identity) -> Account:
    if identity.account is None:
        raise HTTPException(
            status_code=401,
            detail={
                "error_code": ErrorCode.AUTHENTICATION_REQUIRED,
                "message": "Sign in to use this account action.",
            },
        )
    return identity.account


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    encode = lambda value: base64.urlsafe_b64encode(value).decode("ascii")
    return f"scrypt$16384$8$1${encode(salt)}${encode(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        _scheme, n, r, p, salt_text, digest_text = encoded.split("$")
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def normalize_email(email: str) -> str:
    return email.strip().lower()
