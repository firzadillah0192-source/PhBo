"""POST /api/generations and GET /api/generations/{job_id}."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import Identity
from app.catalog import experience_definition, get_experience_row, get_template_row, template_definition
from app.db import get_db
from app.dependencies import get_identity
from app.models import ErrorCode, ExperienceStatus, GenerationJob, JobState, Upload, new_id
from app.queue import enqueue
from app.schemas import GenerationCreateRequest, GenerationCreateResponse, GenerationStatusResponse
from app.services.control_plane import record_generation_event
from app.services.quota import QuotaExhausted, reserve_for_job, settle_for_job

router = APIRouter(tags=["generations"])


def _belongs_to_owner(record, identity: Identity) -> bool:
    if record.account_id is None and record.guest_id is None:
        return True
    return (
        identity.account_id is not None and record.account_id == identity.account_id
    ) or (identity.guest_id is not None and record.guest_id == identity.guest_id)


def _job_not_found(job_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail={"error_code": ErrorCode.JOB_NOT_FOUND, "message": f"job '{job_id}' not found"})


@router.post("/api/generations", response_model=GenerationCreateResponse, status_code=202, summary="Enqueue a generation job")
def create_generation(
    payload: GenerationCreateRequest,
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
) -> GenerationCreateResponse:
    upload = db.get(Upload, payload.upload_id)
    if upload is None or not _belongs_to_owner(upload, identity):
        raise HTTPException(status_code=404, detail={"error_code": ErrorCode.UPLOAD_NOT_FOUND, "message": f"upload '{payload.upload_id}' not found"})
    if upload.validation_status != "VALID":
        raise HTTPException(status_code=422, detail={"error_code": ErrorCode.VALIDATION_FAILED, "message": f"upload '{payload.upload_id}' did not pass validation"})
    if not Path(upload.storage_path).is_file():
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": ErrorCode.UPLOAD_NOT_FOUND,
                "message": "The uploaded photo is no longer available. Please upload it again.",
                "detail": upload.storage_path,
            },
        )

    template_id = payload.template_id or ""
    experience_id = None
    if payload.mode == "BASIC":
        row = get_template_row(db, template_id)
        if row is None or not row.enabled:
            raise HTTPException(status_code=404, detail={"error_code": ErrorCode.TEMPLATE_NOT_FOUND, "message": f"template '{template_id}' not found or disabled"})
        try:
            template_definition(db, template_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail={"error_code": ErrorCode.TEMPLATE_NOT_FOUND, "message": f"template '{template_id}' not found"}) from exc
    else:
        experience_id = payload.experience_id
        row = get_experience_row(db, experience_id or "")
        if row is None or row.status != ExperienceStatus.PUBLISHED:
            raise HTTPException(status_code=404, detail={"error_code": ErrorCode.EXPERIENCE_NOT_FOUND, "message": f"experience '{experience_id}' not found or unavailable"})
        try:
            experience_definition(db, experience_id or "")
        except KeyError as exc:
            raise HTTPException(status_code=404, detail={"error_code": ErrorCode.EXPERIENCE_NOT_FOUND, "message": f"experience '{experience_id}' not found"}) from exc

    job = GenerationJob(
        id=new_id(),
        upload_id=upload.id,
        account_id=identity.account_id,
        guest_id=identity.guest_id,
        template_id=template_id,
        experience_id=experience_id,
        mode=payload.mode,
        state=JobState.QUEUED,
    )
    if identity.account is not None:
        identity.account.last_activity_at = datetime.now(timezone.utc)
    db.add(job)
    try:
        db.flush()
        if payload.mode == "ADVANCED":
            reserve_for_job(db, identity, job.id)
        record_generation_event(db, job.id, "job_queued", "Generation job queued")
        db.commit()
        db.refresh(job)
    except QuotaExhausted as exc:
        db.rollback()
        raise HTTPException(status_code=403, detail={"error_code": ErrorCode.AI_QUOTA_EXHAUSTED, "message": "Your free AI generation quota is exhausted."}) from exc
    except Exception:
        db.rollback()
        raise

    try:
        enqueue(job.id)
    except Exception as exc:
        failed = db.get(GenerationJob, job.id)
        if failed is not None:
            failed.state = JobState.FAILED
            failed.error_code = ErrorCode.QUEUE_UNAVAILABLE
            failed.error_message = "Generation queue is unavailable."
            failed.finished_at = datetime.now(timezone.utc)
            settle_for_job(db, job.id, successful=False)
            db.commit()
        raise HTTPException(status_code=503, detail={"error_code": ErrorCode.QUEUE_UNAVAILABLE, "message": "Generation queue is unavailable."}) from exc

    return GenerationCreateResponse(
        job_id=job.id,
        state=job.state,
        upload_id=job.upload_id,
        template_id=job.template_id or None,
        experience_id=job.experience_id,
        mode=job.mode,
        created_at=job.created_at,
    )


@router.get("/api/generations/{job_id}", response_model=GenerationStatusResponse, summary="Poll generation job state")
def get_generation(
    job_id: str,
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
) -> GenerationStatusResponse:
    job = db.get(GenerationJob, job_id)
    if job is None or not _belongs_to_owner(job, identity):
        raise _job_not_found(job_id)
    result = job.result
    return GenerationStatusResponse(
        job_id=job.id,
        state=job.state,
        upload_id=job.upload_id,
        template_id=job.template_id or None,
        experience_id=job.experience_id,
        mode=job.mode,
        provider=job.provider,
        model=job.model,
        error_code=job.error_code,
        error_message=job.error_message,
        result_id=result.id if result else None,
        result_url=f"/api/results/{result.id}" if result else None,
        download_url=f"/api/results/{result.id}/download" if result else None,
        created_at=job.created_at,
        updated_at=job.updated_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )
