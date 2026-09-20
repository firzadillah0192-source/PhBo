"""POST /api/generations and GET /api/generations/{job_id}

Asynchronous generation contract (spec section 13):

    POST generation -> job_id + QUEUED
    poll GET /api/generations/{job_id}
    state moves QUEUED -> PROCESSING -> COMPLETED | FAILED
    COMPLETED carries result_id

The frontend never assumes synchronous generation.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ErrorCode, GenerationJob, JobState, Upload
from app.queue import enqueue
from app.schemas import GenerationCreateRequest, GenerationCreateResponse, GenerationStatusResponse
from app.templates_registry import TemplateNotFound, get_registry

router = APIRouter(tags=["generations"])


@router.post(
    "/api/generations",
    response_model=GenerationCreateResponse,
    status_code=202,
    summary="Enqueue an AI generation job",
    responses={
        404: {"description": "UPLOAD_NOT_FOUND or TEMPLATE_NOT_FOUND"},
        422: {"description": "Request body validation failed"},
    },
)
def create_generation(
    payload: GenerationCreateRequest,
    db: Session = Depends(get_db),
) -> GenerationCreateResponse:
    upload = db.get(Upload, payload.upload_id)
    if upload is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": ErrorCode.UPLOAD_NOT_FOUND,
                "message": f"upload '{payload.upload_id}' not found",
            },
        )

    if upload.validation_status != "VALID":
        raise HTTPException(
            status_code=422,
            detail={
                "error_code": ErrorCode.VALIDATION_FAILED,
                "message": f"upload '{payload.upload_id}' did not pass validation",
            },
        )

    try:
        get_registry().get(payload.template_id)
    except TemplateNotFound as exc:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": ErrorCode.TEMPLATE_NOT_FOUND,
                "message": f"template '{payload.template_id}' not found",
            },
        ) from exc

    job = GenerationJob(
        upload_id=upload.id,
        template_id=payload.template_id,
        state=JobState.QUEUED,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # Queue after the row is committed so the worker can always find it.
    enqueue(job.id)

    return GenerationCreateResponse(
        job_id=job.id,
        state=job.state,
        upload_id=job.upload_id,
        template_id=job.template_id,
        created_at=job.created_at,
    )


@router.get(
    "/api/generations/{job_id}",
    response_model=GenerationStatusResponse,
    summary="Poll generation job state",
    responses={404: {"description": "JOB_NOT_FOUND"}},
)
def get_generation(job_id: str, db: Session = Depends(get_db)) -> GenerationStatusResponse:
    job = db.get(GenerationJob, job_id)
    if job is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": ErrorCode.JOB_NOT_FOUND,
                "message": f"job '{job_id}' not found",
            },
        )

    result = job.result
    return GenerationStatusResponse(
        job_id=job.id,
        state=job.state,
        upload_id=job.upload_id,
        template_id=job.template_id,
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
