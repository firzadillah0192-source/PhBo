"""POST /api/uploads and GET /api/uploads/{upload_id}/preview

Photo upload + validation (workflow steps 1-2). Validation is real: the file
is decoded with Pillow before it is accepted. Invalid uploads return HTTP 422
with an explicit error_code, never a success response.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db import get_db
from app.models import ErrorCode, Upload, new_id
from app.schemas import UploadResponse
from app.services import storage
from app.services.image_validation import ImageValidationError, validate_image_bytes

router = APIRouter(tags=["uploads"])


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
    file: UploadFile = File(..., description="JPEG, PNG or WEBP photo"),
    db: Session = Depends(get_db),
) -> UploadResponse:
    settings = get_settings()

    if file.filename is None or file.filename == "":
        raise HTTPException(
            status_code=400,
            detail={"error_code": ErrorCode.VALIDATION_FAILED, "message": "No file provided."},
        )

    data = await file.read()

    try:
        validated = validate_image_bytes(data, content_type=file.content_type)
    except ImageValidationError as exc:
        # Explicit, actionable failure. Never downgraded to success.
        raise HTTPException(
            status_code=422,
            detail={
                "error_code": ErrorCode.VALIDATION_FAILED,
                "message": exc.message,
                "detail": exc.detail,
            },
        ) from exc

    # The primary key is needed before the row exists, because the filesystem
    # path is derived from it and storage_path is NOT NULL. Generating the id
    # up front lets us write the file first and insert a complete row once.
    upload_id = new_id()

    path = storage.save_upload(
        upload_id=upload_id,
        data=data,
        content_type=file.content_type or "application/octet-stream",
        fmt=validated.format,
    )

    upload = Upload(
        id=upload_id,
        storage_path=str(path),
        filename=file.filename,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=validated.size_bytes,
        width=validated.width,
        height=validated.height,
        format=validated.format,
        sha256=validated.sha256,
        validation_status="VALID",
        validation_detail=None,
    )
    db.add(upload)
    db.commit()
    db.refresh(upload)

    return UploadResponse(
        upload_id=upload.id,
        filename=upload.filename,
        content_type=upload.content_type,
        size_bytes=upload.size_bytes,
        width=upload.width,
        height=upload.height,
        format=upload.format,
        sha256=upload.sha256,
        validation_status=upload.validation_status,
        preview_url=f"/api/uploads/{upload.id}/preview",
        created_at=upload.created_at,
    )


@router.get(
    "/api/uploads/{upload_id}/preview",
    summary="Preview the uploaded photo",
    responses={404: {"description": "UPLOAD_NOT_FOUND"}},
)
def upload_preview(upload_id: str, db: Session = Depends(get_db)) -> Response:
    upload = db.get(Upload, upload_id)
    if upload is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": ErrorCode.UPLOAD_NOT_FOUND,
                "message": f"upload '{upload_id}' not found",
            },
        )

    try:
        data = storage.read_file(upload.storage_path)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": ErrorCode.UPLOAD_NOT_FOUND,
                "message": "upload file no longer exists on disk",
                "detail": str(exc),
            },
        ) from exc

    return Response(
        content=data,
        media_type=upload.content_type,
        headers={"Cache-Control": "private, max-age=300"},
    )
