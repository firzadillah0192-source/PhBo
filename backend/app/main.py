"""Photobooth AI — FastAPI application entry point.

Run with:  uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.db import init_db
from app.routers import account, admin, admin_operations, admin_usage, claims, experiences, generations, health, results, templates, uploads

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("photobooth.api")


def _safe_log_path(path: str) -> str:
    if path.startswith("/api/public/results/"):
        return "/api/public/results/[REDACTED]"
    if path.startswith("/r/"):
        return "/r/[REDACTED]"
    return path


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    settings.ensure_runtime_dirs()
    init_db()
    logger.info(
        "startup: env=%s runtime_dir=%s templates_dir=%s ai_provider=%s",
        settings.environment,
        settings.runtime_dir,
        settings.templates_dir,
        settings.ai_provider,
    )
    yield
    logger.info("shutdown")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description=(
            "Web-first AI photobooth. Upload -> validate -> choose template -> "
            "generate -> processing -> preview -> download."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(account.router)
    app.include_router(admin.auth_router)
    app.include_router(templates.router)
    app.include_router(experiences.router)
    app.include_router(admin.router)
    app.include_router(admin_operations.router)
    app.include_router(admin_usage.router)
    app.include_router(uploads.router)
    app.include_router(generations.router)
    app.include_router(results.router)
    app.include_router(claims.router)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        # Never hide an error behind a fallback success response.
        logger.exception("unhandled error on %s %s", request.method, _safe_log_path(request.url.path))
        return JSONResponse(
            status_code=500,
            content={
                "error_code": "INTERNAL_ERROR",
                "message": "The request could not be completed. Please try again.",
            },
        )

    return app


app = create_app()
