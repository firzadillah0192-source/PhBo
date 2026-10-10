"""GET /api/results/{result_id} and image/download endpoints."""

from __future__ import annotations
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth import Identity
from app.db import get_db
from app.dependencies import get_identity
from app.models import ErrorCode, Result
from app.schemas import ResultResponse
from app.services import storage
from app.services.classic_format import classic_print_bytes
from app.services.result_deletion import ResultDeleteRequest, delete_result_photo

router = APIRouter(tags=["results"])


def _load_result(result_id: str, db: Session, identity: Identity) -> Result:
    result = db.get(Result, result_id)
    if result is None or result.deleted_at is not None:
        raise HTTPException(status_code=404, detail={"error_code": ErrorCode.RESULT_NOT_FOUND, "message": f"result '{result_id}' not found"})
    job = result.job
    owned = identity.account_id == job.account_id if job.account_id else bool(job.guest_id and job.guest_id == identity.guest_id)
    if not owned:
        raise HTTPException(status_code=404, detail={"error_code": ErrorCode.RESULT_NOT_FOUND, "message": f"result '{result_id}' not found"})
    return result


@router.delete("/api/results/{result_id}", summary="Delete an owned generated photo")
def delete_result(result_id: str, payload: ResultDeleteRequest, identity: Identity = Depends(get_identity), db: Session = Depends(get_db)) -> dict:
    result = _load_result(result_id, db, identity)
    delete_result_photo(db, result, actor_type="owner")
    db.commit()
    return {"result_id": result.id, "deleted": True}


def _read_or_404(result: Result) -> bytes:
    try:
        return storage.read_file(result.storage_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error_code": ErrorCode.RESULT_NOT_FOUND, "message": "result file no longer exists on disk", "detail": str(exc)}) from exc


@router.get("/api/results/{result_id}", response_model=ResultResponse, summary="Result metadata")
def get_result(result_id: str, identity: Identity = Depends(get_identity), db: Session = Depends(get_db)) -> ResultResponse:
    result = _load_result(result_id, db, identity)
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
        print_download_url=f"/api/results/{result.id}/download?rendition=print" if result.job.mode == "CLASSIC" and result.width * 3 == result.height else None,
        created_at=result.created_at,
    )


@router.get("/api/results/{result_id}/image", summary="Inline result image")
def result_image(result_id: str, identity: Identity = Depends(get_identity), db: Session = Depends(get_db)) -> Response:
    result = _load_result(result_id, db, identity)
    return Response(content=_read_or_404(result), media_type=result.content_type, headers={"Cache-Control": "private, no-store"})


@router.get("/api/results/{result_id}/download", summary="Download result image")
def result_download(result_id: str, identity: Identity = Depends(get_identity), db: Session = Depends(get_db), rendition: Literal["master", "print"] = "master") -> Response:
    result = _load_result(result_id, db, identity)
    if rendition == "print":
        if result.job.mode != "CLASSIC":
            raise HTTPException(status_code=422, detail="Print-strip export is available for Classic only")
        try:
            data = classic_print_bytes(_read_or_404(result))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return Response(content=data, media_type="image/png", headers={"Cache-Control": "private, no-store", "Content-Disposition": f'attachment; filename="nxbooth-{result.id}-2x6-300dpi.png"'})
    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(result.content_type, "bin")
    return Response(
        content=_read_or_404(result),
        media_type=result.content_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'attachment; filename="photobooth-{result.template_id}-{result.id}.{ext}"',
        },
    )
