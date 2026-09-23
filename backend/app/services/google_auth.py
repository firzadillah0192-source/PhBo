"""Google OpenID Connect ID-token verification boundary.

The browser sends a short-lived Google ID token. This module verifies it with
Google's published certificates through google-auth; the application then
creates its own server-side session and never stores the Google token.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.config import get_settings


@dataclass(frozen=True)
class GoogleClaims:
    subject: str
    email: str
    name: str | None = None
    avatar_url: str | None = None


def validate_google_claims(claims: dict[str, Any], *, client_id: str) -> GoogleClaims:
    issuer = claims.get("iss")
    if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        raise ValueError("invalid Google token issuer")
    if client_id:
        audience = claims.get("aud")
        audiences = audience if isinstance(audience, list) else [audience]
        if client_id not in audiences:
            raise ValueError("invalid Google token audience")
    subject = str(claims.get("sub") or "").strip()
    email = str(claims.get("email") or "").strip().lower()
    verified = claims.get("email_verified")
    if not subject or "@" not in email or verified not in (True, "true", "1"):
        raise ValueError("Google token has no verified identity")
    return GoogleClaims(
        subject=subject,
        email=email,
        name=str(claims.get("name") or "").strip() or None,
        avatar_url=str(claims.get("picture") or "").strip() or None,
    )


def verify_google_id_token(token: str) -> GoogleClaims:
    """Verify signature, issuer, audience and expiry using google-auth."""
    settings = get_settings()
    if not settings.google_client_id.strip():
        raise ValueError("Google sign-in is not configured")
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token
    except ImportError as exc:  # pragma: no cover - packaging/startup concern
        raise RuntimeError("Google identity verifier dependency is unavailable") from exc
    try:
        claims = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            settings.google_client_id.strip(),
        )
    except Exception as exc:  # google-auth raises several provider-specific errors
        raise ValueError("invalid Google ID token") from exc
    return validate_google_claims(claims, client_id=settings.google_client_id.strip())
