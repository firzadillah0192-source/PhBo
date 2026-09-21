"""Authentication dependency for the protected admin API."""
from __future__ import annotations

import secrets

from fastapi import Header, HTTPException

from app.core.config import get_settings


def require_admin_token(x_admin_token: str | None = Header(default=None, alias="X-Admin-Token")) -> str:
    configured = get_settings().admin_token.strip()
    if not configured:
        raise HTTPException(status_code=404, detail="Admin API is disabled")
    if not x_admin_token or not secrets.compare_digest(x_admin_token, configured):
        raise HTTPException(status_code=401, detail="Invalid admin token")
    return "admin"
