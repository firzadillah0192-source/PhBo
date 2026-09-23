"""Secure QR claims and public mobile result delivery."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import Response as RawResponse
from sqlalchemy.orm import Session

from app.auth import Identity, ensure_kiosk_session
from app.db import get_db
from app.dependencies import get_identity
from app.models import ResultClaim
from app.schemas import PublicResultResponse, ResultClaimCreateRequest, ResultClaimResponse
from app.services.claims import (
    create_or_reuse_claim,
    get_claim_by_token,
    load_owned_result,
    public_claim_origin,
    public_claim_url,
    register_download,
    result_bytes,
    touch_claim,
)
from app.services.rate_limit import enforce_public_rate_limit

router = APIRouter(tags=["result-claims"])


@router.post("/api/kiosk/session")
def start_kiosk_session(
    request: Request,
    response: Response,
    new_run: bool = Query(default=False),
):
    ensure_kiosk_session(request, response, rotate=new_run)
    from app.core.config import get_settings
    settings = get_settings()
    return {
        "active": True,
        "reset_after_seconds": settings.kiosk_reset_seconds,
        "claim_ttl_hours": settings.result_claim_ttl_hours,
    }


@router.post("/api/results/{result_id}/claim", response_model=ResultClaimResponse)
def create_result_claim(
    result_id: str,
    request: Request,
    response: Response,
    payload: ResultClaimCreateRequest | None = None,
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
) -> ResultClaimResponse:
    result = load_owned_result(db, result_id, identity)
    origin = public_claim_origin(request)
    kiosk_session_id = ensure_kiosk_session(request, response) if payload and payload.kiosk else None
    claim, token = create_or_reuse_claim(
        db,
        result,
        identity,
        reuse_token=payload.reuse_token if payload else None,
        refresh=payload.refresh if payload else False,
        kiosk_session_id=kiosk_session_id,
    )
    url = public_claim_url(request, token, origin=origin)
    return ResultClaimResponse(claim_url=url, qr_payload=url, expires_at=claim.expires_at)


def _public_result(claim: ResultClaim, token: str) -> PublicResultResponse:
    return PublicResultResponse(
        image_url=f"/api/public/results/{token}/image",
        download_url=f"/api/public/results/{token}/download",
        expires_at=claim.expires_at,
        created_at=claim.result.created_at,
        content_type=claim.result.content_type,
        width=claim.result.width,
        height=claim.result.height,
        download_count=claim.download_count,
    )


@router.get("/api/public/results/{token}", response_model=PublicResultResponse)
def public_result(token: str, request: Request, db: Session = Depends(get_db)) -> PublicResultResponse:
    enforce_public_rate_limit(request, "claim", 120)
    claim = get_claim_by_token(db, token)
    touch_claim(db, claim, event_type="claim_opened")
    return _public_result(claim, token)


@router.get("/api/public/results/{token}/image")
def public_result_image(token: str, request: Request, db: Session = Depends(get_db)) -> RawResponse:
    enforce_public_rate_limit(request, "image", 180)
    claim = get_claim_by_token(db, token)
    data = result_bytes(claim)
    touch_claim(db, claim)
    return RawResponse(content=data, media_type=claim.result.content_type, headers={"Cache-Control": "private, no-store"})


@router.get("/api/public/results/{token}/download")
def public_result_download(token: str, request: Request, db: Session = Depends(get_db)) -> RawResponse:
    enforce_public_rate_limit(request, "download", 60)
    claim = get_claim_by_token(db, token)
    data = result_bytes(claim)
    register_download(db, claim)
    extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(claim.result.content_type, "bin")
    return RawResponse(
        content=data,
        media_type=claim.result.content_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'attachment; filename="photobooth-result.{extension}"',
        },
    )
