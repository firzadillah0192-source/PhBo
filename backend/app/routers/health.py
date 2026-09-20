"""GET /api/health

Reports real dependency status. Never claims 'ok' when a dependency is down or
when no AI provider is connected — the frontend needs the honest signal so it
can warn the user before they upload a photo.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ai.factory import get_provider
from app.core.config import get_settings
from app.db import get_db
from app.queue import ping as redis_ping
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/api/health", response_model=HealthResponse, summary="Service and dependency health")
def health(db: Session = Depends(get_db)) -> HealthResponse:
    settings = get_settings()
    provider = get_provider()

    checks: dict[str, str] = {}

    # Database
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001 - report, don't crash health
        checks["database"] = f"error: {type(exc).__name__}"

    # Redis
    checks["redis"] = "ok" if redis_ping() else "error: unreachable"

    # AI provider
    ai_connected = provider.is_available()
    checks["ai_provider"] = (
        f"ok ({provider.name})" if ai_connected else f"not_connected ({provider.name})"
    )

    all_ok = checks["database"] == "ok" and checks["redis"] == "ok"

    return HealthResponse(
        status="ok" if all_ok else "degraded",
        app=settings.app_name,
        environment=settings.environment,
        checks=checks,
        ai_provider=provider.name,
        ai_provider_connected=ai_connected,
    )
