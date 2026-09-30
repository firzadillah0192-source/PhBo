"""POST /api/generations and GET /api/generations/{job_id}."""

from __future__ import annotations

import logging
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import Identity
from app.catalog import experience_definition, get_experience_row, get_template_row, template_definition
from app.db import get_db
from app.dependencies import get_identity
from app.models import ErrorCode, ExperienceStatus, GenerationJob, JobState, Upload, new_id, ClassicLayout, AdvancedFrameStyle, AdvancedOrnament
from app.queue import enqueue
from app.schemas import GenerationCreateRequest, GenerationCreateResponse, GenerationStatusResponse
from app.services.control_plane import record_generation_event
from app.services.diagnostics import log_image_event, user_agent_category
from app.services.quota import QuotaExhausted, reserve_for_job, settle_for_job
from app.services.uploads import upload_belongs_to_identity, upload_file_is_available, upload_is_expired
from app.services.classic import ClassicLayoutError, validated_frame
from app.services.advanced_prompt import AdvancedSelectionError, validate_advanced_selection

router = APIRouter(tags=["generations"])
logger = logging.getLogger("photobooth.generation")


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
    request: Request,
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
) -> GenerationCreateResponse:
    upload = db.get(Upload, payload.upload_id)
    if upload is None or not upload_belongs_to_identity(upload, identity):
        raise HTTPException(status_code=404, detail={"error_code": ErrorCode.UPLOAD_NOT_FOUND, "message": "The uploaded photo is unavailable."})
    if upload_is_expired(upload):
        raise HTTPException(
            status_code=410,
            detail={
                "error_code": ErrorCode.UPLOAD_EXPIRED,
                "message": "The uploaded photo is no longer available. Please upload it again.",
            },
        )
    if upload.validation_status != "VALID":
        raise HTTPException(status_code=422, detail={"error_code": ErrorCode.VALIDATION_FAILED, "message": "The uploaded photo did not pass validation."})
    if not upload_file_is_available(upload):
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": ErrorCode.UPLOAD_NOT_FOUND,
                "message": "The uploaded photo is no longer available. Please upload it again.",
            },
        )

    template_id = payload.template_id or ""
    experience_id = None
    layout_id = None
    frame_style_id = None
    ornament_ids: list[str] = []
    if payload.mode == "BASIC":
        row = get_template_row(db, template_id)
        if row is None or not row.enabled:
            raise HTTPException(status_code=404, detail={"error_code": ErrorCode.TEMPLATE_NOT_FOUND, "message": f"template '{template_id}' not found or disabled"})
        try:
            template_definition(db, template_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail={"error_code": ErrorCode.TEMPLATE_NOT_FOUND, "message": f"template '{template_id}' not found"}) from exc
    elif payload.mode == "CLASSIC":
        layout = db.get(ClassicLayout, payload.layout_id)
        if layout is None or not layout.active:
            raise HTTPException(status_code=404, detail={"error_code": "CLASSIC_LAYOUT_NOT_FOUND", "message": "Classic layout unavailable"})
        try:
            validated_frame(layout)
        except ClassicLayoutError as exc:
            raise HTTPException(status_code=422, detail={"error_code": "CLASSIC_LAYOUT_INVALID", "message": str(exc)}) from exc
        if len(payload.capture_upload_ids) != layout.shot_count or len(set(payload.capture_upload_ids)) != layout.shot_count:
            raise HTTPException(status_code=422, detail={"error_code": "CLASSIC_SHOT_COUNT_INVALID", "message": "Incorrect number of distinct captures"})
        for capture_id in payload.capture_upload_ids:
            capture = db.get(Upload, capture_id)
            if capture is None or not upload_belongs_to_identity(capture, identity) or upload_is_expired(capture) or capture.validation_status != "VALID" or not upload_file_is_available(capture):
                raise HTTPException(status_code=422, detail={"error_code": "CLASSIC_CAPTURE_UNAVAILABLE", "message": "A capture is unavailable"})
        layout_id = layout.id
    else:
        experience_id = payload.experience_id
        row = get_experience_row(db, experience_id or "")
        if row is None or row.status != ExperienceStatus.PUBLISHED:
            raise HTTPException(status_code=404, detail={"error_code": ErrorCode.EXPERIENCE_NOT_FOUND, "message": f"experience '{experience_id}' not found or unavailable"})
        try:
            experience_definition(db, experience_id or "")
        except KeyError as exc:
            raise HTTPException(status_code=404, detail={"error_code": ErrorCode.EXPERIENCE_NOT_FOUND, "message": f"experience '{experience_id}' not found"}) from exc
        frame_style_id = payload.frame_style_id or "natural"
        frame = db.get(AdvancedFrameStyle, frame_style_id)
        ornament_ids = payload.ornament_ids
        ornaments = db.query(AdvancedOrnament).filter(AdvancedOrnament.id.in_(ornament_ids)).all() if ornament_ids else []
        try:
            validate_advanced_selection(row, frame, ornaments, ornament_ids)
        except (AdvancedSelectionError, ValueError) as exc:
            raise HTTPException(status_code=422, detail={"error_code": "ADVANCED_SELECTION_INVALID", "message": str(exc)}) from exc

    job = GenerationJob(
        id=new_id(),
        upload_id=upload.id,
        account_id=identity.account_id,
        guest_id=identity.guest_id,
        template_id=template_id,
        experience_id=experience_id,
        layout_id=layout_id,
        capture_upload_ids_json=json.dumps(payload.capture_upload_ids) if layout_id else None,
        frame_style_id=frame_style_id,
        ornament_ids_json=json.dumps(ornament_ids) if frame_style_id else None,
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

    log_image_event(
        logger,
        "generation_job_created",
        upload_id=job.upload_id,
        job_id=job.id,
        mode=job.mode,
        user_agent_category=user_agent_category(request.headers.get("user-agent", "")),
    )

    try:
        enqueue(job.id)
    except Exception as exc:
        log_image_event(
            logger,
            "generation_failed",
            upload_id=job.upload_id,
            job_id=job.id,
            failure_code=ErrorCode.QUEUE_UNAVAILABLE,
        )
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
        layout_id=job.layout_id,
        frame_style_id=job.frame_style_id,
        ornament_ids=ornament_ids,
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
        layout_id=job.layout_id,
        frame_style_id=job.frame_style_id,
        ornament_ids=json.loads(job.ornament_ids_json or "[]"),
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
