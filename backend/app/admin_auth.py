"""Server-side admin session, role and CSRF helpers."""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from urllib.parse import urlsplit

from fastapi import Depends, Header, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.auth import ADMIN_COOKIE, _is_active, clear_cookie, create_auth_session, delete_auth_session, set_admin_cookie, unsign_value
from app.auth_models import AdminUser, AuthSession
from app.core.config import get_settings
from app.db import get_db
from app.models import ErrorCode, _now

ADMIN_ROLES = {"superadmin", "operator", "content_manager"}


@dataclass(frozen=True)
class AdminPrincipal:
    actor_id: str
    role: str

    @property
    def is_superadmin(self) -> bool:
        return self.role == "superadmin"


def _default_role() -> str:
    role = get_settings().admin_default_role.strip().lower()
    return role if role in ADMIN_ROLES else "superadmin"


def _ensure_token_admin(db: Session) -> AdminUser:
    actor = db.get(AdminUser, "token-admin")
    if actor is None:
        actor = AdminUser(id="token-admin", name="Configured admin token", role=_default_role(), is_active=True)
        db.add(actor)
        db.flush()
    return actor


def admin_login(response: Response, credential: str, db: Session) -> None:
    configured = get_settings().admin_token.strip()
    if not configured:
        raise HTTPException(status_code=404, detail="Admin API is disabled")
    if not credential or not secrets.compare_digest(credential, configured):
        raise HTTPException(status_code=401, detail={"error_code": ErrorCode.INVALID_CREDENTIALS, "message": "Invalid admin credentials."})
    actor = _ensure_token_admin(db)
    token = create_auth_session(db, is_admin=True, admin_user_id=actor.id, admin_role=actor.role)
    set_admin_cookie(response, token)


def require_admin_session(
    request: Request,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    db: Session = Depends(get_db),
) -> AdminPrincipal:
    """Require an active HttpOnly admin session; header is transitional-only."""
    signed = unsign_value(request.cookies.get(ADMIN_COOKIE))
    if signed:
        session = db.get(AuthSession, hashlib.sha256(signed.encode("utf-8")).hexdigest())
        if session and session.is_admin and _is_active(session.expires_at):
            role = (session.admin_role or "superadmin").lower()
            actor = db.get(AdminUser, session.admin_user_id) if session.admin_user_id else None
            if role in ADMIN_ROLES and (actor is None or actor.is_active):
                return AdminPrincipal(actor_id=session.admin_user_id or "admin", role=role)

    configured = get_settings().admin_token.strip()
    if configured and x_admin_token and secrets.compare_digest(x_admin_token, configured):
        return AdminPrincipal(actor_id="token-admin", role="superadmin")
    raise HTTPException(status_code=401, detail={"error_code": ErrorCode.AUTHENTICATION_REQUIRED, "message": "Admin authentication required."})


def require_admin_roles(*roles: str):
    allowed = {role.lower() for role in roles}

    def dependency(principal: AdminPrincipal = Depends(require_admin_session)) -> AdminPrincipal:
        if principal.role not in allowed and principal.role != "superadmin":
            raise HTTPException(status_code=403, detail={"error_code": "ADMIN_FORBIDDEN", "message": "Your admin role cannot perform this action."})
        return principal

    return dependency


def require_admin_csrf(request: Request) -> None:
    """Same-origin check for browser state changes; absent origin is allowed for API tools."""
    origin = request.headers.get("origin")
    if not origin:
        return
    settings = get_settings()
    # The API normally sits behind the web container and may be reached via a
    # TLS-terminating reverse proxy. Compare against forwarded host/protocol,
    # while accepting either scheme for the same public host when an upstream
    # proxy has not preserved X-Forwarded-Proto.
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "")
    forwarded_proto = (request.headers.get("x-forwarded-proto") or request.url.scheme).split(",", 1)[0].strip()
    same_host_origins = {f"{scheme}://{forwarded_host}" for scheme in ("http", "https") if forwarded_host}
    same_origin = f"{forwarded_proto}://{forwarded_host}" if forwarded_host else ""
    origin_host = urlsplit(origin).netloc
    if origin != same_origin and origin not in same_host_origins and origin not in set(settings.cors_origins) and origin_host != forwarded_host:
        raise HTTPException(status_code=403, detail={"error_code": "CSRF_BLOCKED", "message": "Cross-site admin mutation blocked."})


def admin_logout(request: Request, response: Response, db: Session) -> None:
    delete_auth_session(db, unsign_value(request.cookies.get(ADMIN_COOKIE)))
    clear_cookie(response, ADMIN_COOKIE)
