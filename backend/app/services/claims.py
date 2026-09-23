"""Secure result-claim creation and public delivery helpers."""

from __future__ import annotations

import hashlib
import ipaddress
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlsplit

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.auth import Identity
from app.core.config import get_settings
from app.models import Result, ResultClaim
from app.services import storage
from app.services.control_plane import record_generation_event


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def is_claim_expired(value: datetime) -> bool:
    return _utc(value) <= now_utc()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def public_claim_origin(request) -> str:
    settings = get_settings()
    base = settings.result_claim_public_base_url.strip().rstrip("/")
    if base:
        parsed = urlsplit(base)
        hostname = (parsed.hostname or "").lower()
        try:
            port = parsed.port
        except ValueError:
            port = -1
        invalid = (
            parsed.scheme.lower() != "https"
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
            or port not in (None, 443)
            or hostname in {"localhost", "host.docker.internal"}
            or hostname.endswith((".localhost", ".local", ".internal"))
        )
        try:
            invalid = invalid or not ipaddress.ip_address(hostname).is_global
        except ValueError:
            invalid = invalid or "." not in hostname
        if settings.environment.lower() in {"production", "prod"}:
            invalid = invalid or hostname != "phobo.zafirz.my.id"
        if invalid:
            raise HTTPException(
                status_code=503,
                detail={
                    "error_code": "CLAIM_PUBLIC_URL_MISCONFIGURED",
                    "message": "Secure photo-link delivery is temporarily unavailable.",
                },
            )
        rendered_host = f"[{hostname}]" if ":" in hostname else hostname
        return f"https://{rendered_host}"

    if settings.environment.lower() in {"production", "prod"}:
        raise HTTPException(
            status_code=503,
            detail={
                "error_code": "CLAIM_PUBLIC_URL_MISCONFIGURED",
                "message": "Secure photo-link delivery is temporarily unavailable.",
            },
        )

    if not base:
        proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
        host = request.headers.get("host", request.url.netloc)
        base = f"{proto}://{host}"
    return base.rstrip("/")


def public_claim_url(request, token: str, *, origin: str | None = None) -> str:
    safe_origin = origin or public_claim_origin(request)
    return f"{safe_origin.rstrip('/')}/r/{quote(token, safe='')}"


def _unavailable(message: str = "This photo is no longer available.") -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"error_code": "CLAIM_UNAVAILABLE", "message": message},
    )


def load_owned_result(db: Session, result_id: str, identity: Identity) -> Result:
    result = db.get(Result, result_id)
    if result is None:
        raise _unavailable()
    job = result.job
    if job.account_id is not None:
        owned = identity.account_id == job.account_id
    elif job.guest_id is not None:
        owned = identity.guest_id == job.guest_id
    else:
        owned = False
    if not owned:
        raise _unavailable()
    return result


def _valid_claim_for_result(db: Session, result_id: str) -> ResultClaim | None:
    return (
        db.query(ResultClaim)
        .filter(
            ResultClaim.result_id == result_id,
            ResultClaim.is_revoked.is_(False),
            ResultClaim.expires_at > now_utc(),
        )
        .order_by(ResultClaim.created_at.desc())
        .first()
    )


def create_or_reuse_claim(
    db: Session,
    result: Result,
    identity: Identity,
    *,
    reuse_token: str | None = None,
    refresh: bool = False,
    kiosk_session_id: str | None = None,
) -> tuple[ResultClaim, str]:
    # Serialize claim creation per result so concurrent UI retries cannot
    # leave multiple active public links in PostgreSQL.
    db.query(Result).filter(Result.id == result.id).with_for_update().one()
    existing = _valid_claim_for_result(db, result.id)
    if existing is not None:
        if not refresh and reuse_token and token_hash(reuse_token) == existing.token_hash:
            return existing, reuse_token
        if refresh:
            existing.is_revoked = True
            record_generation_event(
                db,
                result.job_id,
                "claim_revoked",
                "Previous public result claim replaced by explicit refresh",
                {"claim_id": existing.id},
            )
            db.flush()
        else:
            raise HTTPException(
                status_code=409,
                detail={
                    "error_code": "CLAIM_EXISTS",
                    "message": "A valid photo link already exists. Use the existing link or explicitly refresh it.",
                },
            )
    elif (
        db.query(ResultClaim)
        .filter(ResultClaim.result_id == result.id)
        .first()
        is not None
        and not refresh
    ):
        raise HTTPException(
            status_code=409,
            detail={
                "error_code": "CLAIM_REFRESH_REQUIRED",
                "message": "This photo link is no longer active. Explicitly create a new link to continue.",
            },
        )

    token = secrets.token_urlsafe(32)
    claim = ResultClaim(
        result_id=result.id,
        token_hash=token_hash(token),
        expires_at=now_utc().replace(microsecond=0)
        + timedelta(hours=get_settings().result_claim_ttl_hours),
        created_by_session_id=identity.session_id,
        created_by_kiosk_session_id=kiosk_session_id,
    )
    db.add(claim)
    db.flush()
    record_generation_event(
        db,
        result.job_id,
        "claim_created",
        "Secure result claim created",
        {"claim_id": claim.id, "expires_at": claim.expires_at.isoformat()},
    )
    db.commit()
    db.refresh(claim)
    return claim, token


def get_claim_by_token(db: Session, token: str) -> ResultClaim:
    if not token or len(token) < 32 or len(token) > 256:
        raise _unavailable()
    claim = db.query(ResultClaim).filter(ResultClaim.token_hash == token_hash(token)).one_or_none()
    if claim is None or claim.result is None:
        raise _unavailable()
    if claim.is_revoked:
        raise _unavailable()
    if is_claim_expired(claim.expires_at):
        record_generation_event(
            db,
            claim.result.job_id,
            "claim_expired",
            "Expired public result claim was requested",
            {"claim_id": claim.id},
        )
        db.commit()
        raise _unavailable()
    return claim


def result_bytes(claim: ResultClaim) -> bytes:
    try:
        return storage.read_file(claim.result.storage_path)
    except OSError as exc:
        raise _unavailable("We could not load this photo right now. Please try again.") from exc


def touch_claim(db: Session, claim: ResultClaim, *, event_type: str | None = None) -> None:
    now = now_utc()
    if claim.first_accessed_at is None:
        claim.first_accessed_at = now
    claim.last_accessed_at = now
    if event_type:
        record_generation_event(
            db,
            claim.result.job_id,
            event_type,
            "Public result claim accessed",
            {"claim_id": claim.id},
        )
    db.commit()


def register_download(db: Session, claim: ResultClaim) -> None:
    now = now_utc()
    first_accessed_at = claim.first_accessed_at or now
    db.query(ResultClaim).filter(ResultClaim.id == claim.id).update(
        {
            ResultClaim.download_count: ResultClaim.download_count + 1,
            ResultClaim.first_accessed_at: first_accessed_at,
            ResultClaim.last_accessed_at: now,
        },
        synchronize_session=False,
    )
    record_generation_event(
        db,
        claim.result.job_id,
        "result_downloaded",
        "Result downloaded through public claim",
        {"claim_id": claim.id},
    )
    db.commit()
