"""POST /api/uploads and GET /api/uploads/{upload_id}/preview

Photo upload + validation (workflow steps 1-2). Validation is real: the file
is decoded with Pillow before it is accepted. Invalid uploads return HTTP 422
with an explicit error_code, never a success response.
"""

from __future__ import annotations

import logging
from pathlib import PurePath
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_identity
from app.auth import Identity
from app.models import ErrorCode, Upload, new_id
from app.schemas import UploadResponse
from app.services import storage
from app.services.image_validation import (
    ImageValidationError,
    decode_image_bytes,
    normalize_decoded_image,
    validate_canonical_image,
    validate_decoded_dimensions,
)
from app.services.diagnostics import log_image_event, user_agent_category
from app.services.uploads import (
    upload_belongs_to_identity,
    upload_expires_at,
    upload_file_is_available,
    upload_has_active_job,
    upload_is_expired,
)

router = APIRouter(tags=["uploads"])
logger = logging.getLogger("photobooth.upload")


@router.post(
    "/api/uploads",
    response_model=UploadResponse,
    status_code=201,
    summary="Upload and validate a user photo",
    responses={
        422: {"description": "VALIDATION_FAILED - not a decodable image, wrong type or size"},
        400: {"description": "No file provided"},
    },
)
async def create_upload(
    request: Request,
    file: UploadFile = File(..., description="JPEG, PNG, WEBP, HEIC or HEIF photo"),
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
) -> UploadResponse:
    upload_id = new_id()
    ua_category = user_agent_category(request.headers.get("user-agent", ""))
    extension = PurePath(file.filename or "").suffix.lower()[:16]
    declared_type = (file.content_type or "").strip().lower()[:80] or None

    if file.filename is None or file.filename == "":
        log_image_event(logger, "upload_failed", upload_id=upload_id, failure_code="IMAGE_DECODE_FAILED", user_agent_category=ua_category)
        raise HTTPException(
            status_code=400,
            detail={"error_code": ErrorCode.VALIDATION_FAILED, "message": "No file provided."},
        )

    data = await file.read()
    log_image_event(
        logger,
        "upload_received",
        upload_id=upload_id,
        content_type=declared_type,
        filename_extension=extension,
        bytes_received=len(data),
        user_agent_category=ua_category,
    )

    try:
        decoded = decode_image_bytes(data, content_type=file.content_type)
        log_image_event(
            logger,
            "decode_success",
            upload_id=upload_id,
            detected_format=decoded.detected_format,
            user_agent_category=ua_category,
        )
        width, height = validate_decoded_dimensions(decoded)
        canonical_data = normalize_decoded_image(decoded)
        log_image_event(
            logger,
            "normalize_success",
            upload_id=upload_id,
            content_type="image/jpeg",
            width=width,
            height=height,
            user_agent_category=ua_category,
        )
        validated = validate_canonical_image(canonical_data)
        log_image_event(
            logger,
            "validation_success",
            upload_id=upload_id,
            detected_format=decoded.detected_format,
            normalized_content_type="image/jpeg",
            width=validated.width,
            height=validated.height,
            user_agent_category=ua_category,
        )
    except ImageValidationError as exc:
        log_image_event(
            logger,
            "upload_failed",
            upload_id=upload_id,
            failure_code=exc.code,
            user_agent_category=ua_category,
        )
        raise HTTPException(
            status_code=422,
            detail={
                "error_code": exc.code,
                "message": exc.message,
            },
        ) from exc

    try:
        path = storage.save_upload(
            upload_id=upload_id,
            data=canonical_data,
            content_type="image/jpeg",
            fmt="JPEG",
        )
    except OSError:
        log_image_event(logger, "upload_failed", upload_id=upload_id, failure_code=ErrorCode.UPLOAD_STORAGE_FAILED, user_agent_category=ua_category)
        raise HTTPException(
            status_code=503,
            detail={"error_code": ErrorCode.UPLOAD_STORAGE_FAILED, "message": "We could not temporarily store this photo. Please try again."},
        ) from None

    upload = Upload(
        id=upload_id,
        storage_path=str(path),
        filename=file.filename,
        content_type="image/jpeg",
        size_bytes=validated.size_bytes,
        width=validated.width,
        height=validated.height,
        format=validated.format,
        sha256=validated.sha256,
        account_id=identity.account_id,
        guest_id=identity.guest_id,
        validation_status="VALID",
        validation_detail=None,
    )
    db.add(upload)
    if identity.account is not None:
        identity.account.last_activity_at = datetime.now(timezone.utc)
    try:
        db.commit()
        db.refresh(upload)
    except Exception:
        db.rollback()
        try:
            storage.delete_path(path)
        except OSError:
            pass
        log_image_event(logger, "upload_failed", upload_id=upload_id, failure_code=ErrorCode.UPLOAD_STORAGE_FAILED, user_agent_category=ua_category)
        raise HTTPException(
            status_code=503,
            detail={"error_code": ErrorCode.UPLOAD_STORAGE_FAILED, "message": "We could not temporarily store this photo. Please try again."},
        ) from None

    log_image_event(
        logger,
        "upload_persisted",
        upload_id=upload.id,
        normalized_content_type=upload.content_type,
        detected_format=decoded.detected_format,
        width=upload.width,
        height=upload.height,
        size_bytes=upload.size_bytes,
        user_agent_category=ua_category,
    )
    return UploadResponse(
        upload_id=upload.id,
        filename=upload.filename,
        content_type=upload.content_type,
        normalized_content_type=upload.content_type,
        size_bytes=upload.size_bytes,
        width=upload.width,
        height=upload.height,
        format=upload.format,
        sha256=upload.sha256,
        validation_status=upload.validation_status,
        preview_url=f"/api/uploads/{upload.id}/preview",
        created_at=upload.created_at,
        expires_at=upload_expires_at(upload),
    )


def _get_available_upload(upload_id: str, identity: Identity, db: Session) -> Upload:
    upload = db.get(Upload, upload_id)
    if upload is None or not upload_belongs_to_identity(upload, identity):
        raise HTTPException(
            status_code=404,
            detail={"error_code": ErrorCode.UPLOAD_NOT_FOUND, "message": "The uploaded photo is unavailable."},
        )
    if upload_is_expired(upload) and not upload_has_active_job(db, upload):
        raise HTTPException(
            status_code=410,
            detail={
                "error_code": ErrorCode.UPLOAD_EXPIRED,
                "message": "The uploaded photo is no longer available. Please upload it again.",
            },
        )
    if not upload_file_is_available(upload):
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": ErrorCode.UPLOAD_NOT_FOUND,
                "message": "The uploaded photo is no longer available. Please upload it again.",
            },
        )
    return upload


@router.get(
    "/api/uploads/{upload_id}",
    response_model=UploadResponse,
    summary="Restore owned upload metadata",
    responses={404: {"description": "UPLOAD_NOT_FOUND"}, 410: {"description": "UPLOAD_EXPIRED"}},
)
def get_upload(upload_id: str, identity: Identity = Depends(get_identity), db: Session = Depends(get_db)) -> UploadResponse:
    upload = _get_available_upload(upload_id, identity, db)
    return UploadResponse(
        upload_id=upload.id,
        filename=upload.filename,
        content_type=upload.content_type,
        normalized_content_type=upload.content_type,
        size_bytes=upload.size_bytes,
        width=upload.width,
        height=upload.height,
        format=upload.format,
        sha256=upload.sha256,
        validation_status=upload.validation_status,
        preview_url=f"/api/uploads/{upload.id}/preview",
        created_at=upload.created_at,
        expires_at=upload_expires_at(upload),
    )


@router.get(
    "/api/uploads/{upload_id}/preview",
    summary="Preview the uploaded photo",
    responses={404: {"description": "UPLOAD_NOT_FOUND"}, 410: {"description": "UPLOAD_EXPIRED"}},
)
def upload_preview(upload_id: str, identity: Identity = Depends(get_identity), db: Session = Depends(get_db)) -> Response:
    upload = _get_available_upload(upload_id, identity, db)
    try:
        data = storage.read_file(upload.storage_path)
    except OSError:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": ErrorCode.UPLOAD_NOT_FOUND,
                "message": "The uploaded photo is no longer available. Please upload it again.",
            },
        ) from None

    return Response(
        content=data,
        media_type=upload.content_type,
        headers={
            "Cache-Control": "private, no-store, max-age=0",
            "Vary": "Cookie",
            "X-Content-Type-Options": "nosniff",
        },
    )
