"""GET /api/results/{result_id} and GET /api/results/{result_id}/download

Result metadata, inline preview and attachment download.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ErrorCode, Result
from app.schemas import ResultResponse
from app.services import storage

router = APIRouter(tags=["results"])


def _load_result(result_id: str, db: Session) -> Result:
    result = db.get(Result, result_id)
    if result is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": ErrorCode.RESULT_NOT_FOUND,
                "message": f"result '{result_id}' not found",
            },
        )
    return result


def _read_or_404(result: Result) -> bytes:
    try:
        return storage.read_file(result.storage_path)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": ErrorCode.RESULT_NOT_FOUND,
                "message": "result file no longer exists on disk",
                "detail": str(exc),
            },
        ) from exc


@router.get(
    "/api/results/{result_id}",
    response_model=ResultResponse,
    summary="Result metadata",
    responses={404: {"description": "RESULT_NOT_FOUND"}},
)
def get_result(result_id: str, db: Session = Depends(get_db)) -> ResultResponse:
    result = _load_result(result_id, db)
    return ResultResponse(
        result_id=result.id,
        job_id=result.job_id,
        template_id=result.template_id,
        content_type=result.content_type,
        size_bytes=result.size_bytes,
        width=result.width,
        height=result.height,
        sha256=result.sha256,
        provider=result.provider,
        model=result.model,
        result_url=f"/api/results/{result.id}",
        download_url=f"/api/results/{result.id}/download",
        created_at=result.created_at,
    )


@router.get(
    "/api/results/{result_id}/image",
    summary="Inline result image (for <img> preview)",
    responses={404: {"description": "RESULT_NOT_FOUND"}},
)
def result_image(result_id: str, db: Session = Depends(get_db)) -> Response:
    result = _load_result(result_id, db)
    data = _read_or_404(result)
    return Response(
        content=data,
        media_type=result.content_type,
        headers={"Cache-Control": "private, max-age=600"},
    )


@router.get(
    "/api/results/{result_id}/download",
    summary="Download result image as attachment",
    responses={404: {"description": "RESULT_NOT_FOUND"}},
)
def result_download(result_id: str, db: Session = Depends(get_db)) -> Response:
    result = _load_result(result_id, db)
    data = _read_or_404(result)

    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(
        result.content_type, "bin"
    )
    filename = f"photobooth-{result.template_id}-{result.id}.{ext}"

    return Response(
        content=data,
        media_type=result.content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
