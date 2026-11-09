"""Shared browser request and private-resource protections."""

from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from starlette.datastructures import MutableHeaders

from app.core.config import get_settings


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
}


def _origin(url: str) -> str | None:
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return None
        if parsed.username or parsed.password:
            return None
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        return f"{parsed.scheme}://{parsed.hostname.lower()}:{port}"
    except ValueError:
        return None


def require_same_origin(request: Request) -> None:
    """Check all browser mutations, including login and multipart uploads.

    CLI clients without browser provenance headers remain supported. An
    explicit untrusted Origin/Referer is rejected even without a cookie.
    """
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    trusted = {_origin(str(request.base_url))}
    trusted.update(_origin(value) for value in get_settings().cors_origins)
    trusted.discard(None)
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    source = origin if origin is not None else referer
    if source is not None:
        if _origin(source) in trusted:
            return
    elif request.headers.get("sec-fetch-site") not in {"cross-site", "same-site"}:
        return
    raise HTTPException(
        status_code=403,
        detail={"error_code": "CSRF_BLOCKED", "message": "Untrusted browser request origin."},
    )


def owns_record(record, identity) -> bool:
    """Legacy unowned rows are private; account ownership takes precedence."""
    if record.account_id is not None:
        return identity.account_id is not None and record.account_id == identity.account_id
    return record.guest_id is not None and identity.guest_id is not None and record.guest_id == identity.guest_id


class SecurityHeadersMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.update(SECURITY_HEADERS)
                if scope["path"].startswith("/api/"):
                    headers["Cache-Control"] = "no-store"
                    headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
            await send(message)

        await self.app(scope, receive, send_with_headers)
