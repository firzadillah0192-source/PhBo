"""Protected CRUD API for admin-managed experiences and templates."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.admin_auth import AdminPrincipal, require_admin_csrf, require_admin_roles, require_admin_session, admin_login, admin_logout
from app.auth_schemas import AdminLoginRequest
from app.catalog import get_experience_row, get_template_row, list_experience_rows, list_template_rows
from app.core.config import get_settings
from app.db import get_db
from app.models import ExperienceStatus, ManagedExperience, ManagedTemplate, PreviewStatus
from app.schemas import (
    AdminExperienceCreate, AdminExperiencePatch, AdminExperienceResponse,
    AdminTemplateCreate, AdminTemplatePatch, AdminTemplateResponse,
    AdminConfirmRequest, PreviewBatchRequest, PreviewBatchResponse,
    PreviewJobResponse, PreviewSourceResponse,
)
from app.services.admin_assets import save_admin_image
from app.services.control_plane import record_audit
from app.services.preview_factory import (
    PreviewFactoryError, job_response, list_sources, missing_experiences,
    queue_preview_job, save_source_asset, source_has_asset, source_response,
    thumbnail_asset_path,
)

CONTENT_DEP = Depends(require_admin_roles("content_manager"))
router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin_session), Depends(require_admin_csrf), CONTENT_DEP],
)


def _now():
    return datetime.now(timezone.utc)


def _experience(row: ManagedExperience) -> AdminExperienceResponse:
    return AdminExperienceResponse(
        id=row.id, name=row.name, description=row.description,
        thumbnail_path=row.thumbnail_path, internal_prompt=row.internal_prompt,
        provider=row.provider, model=row.model, reference_mode=row.reference_mode,
        output_format=row.output_format, status=row.status, category=row.category,
        preview_missing=not bool(row.thumbnail_path and Path(row.thumbnail_path).is_file()),
        preview_status=row.preview_status,
        preview_error=row.preview_error,
        enabled=row.enabled, sort_order=row.sort_order, created_at=row.created_at,
        updated_at=row.updated_at, updated_by=row.updated_by,
    )


def _template(row: ManagedTemplate) -> AdminTemplateResponse:
    processing_path = Path(row.image_path)
    preview_path = Path(row.marketing_preview_path) if row.marketing_preview_path else None
    return AdminTemplateResponse(
        id=row.id,
        name=row.name,
        description=row.description,
        image_path=row.image_path,
        marketing_preview_path=row.marketing_preview_path,
        metadata_path=row.metadata_path,
        preview_missing=preview_path is None or not preview_path.is_file(),
        processing_asset_present=processing_path.is_file(),
        marketing_preview_url=f"/api/admin/templates/{row.id}/preview" if preview_path and preview_path.is_file() else None,
        enabled=row.enabled,
        sort_order=row.sort_order,
        created_at=row.created_at,
        updated_at=row.updated_at,
        updated_by=row.updated_by,
    )


def _not_found(kind: str, item_id: str):
    raise HTTPException(status_code=404, detail=f"{kind} '{item_id}' not found")


@router.get("/experiences", response_model=list[AdminExperienceResponse])
def admin_experiences(db: Session = Depends(get_db)):
    return [_experience(row) for row in list_experience_rows(db)]


@router.post("/experiences", response_model=AdminExperienceResponse, status_code=201)
def create_experience(payload: AdminExperienceCreate, db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    if get_experience_row(db, payload.id):
        raise HTTPException(status_code=409, detail="experience id already exists")
    row = ManagedExperience(**payload.model_dump(), updated_by="admin")
    db.add(row)
    record_audit(db, actor_id=principal.actor_id, action="experience_created", target_type="experience", target_id=row.id, metadata={"name": row.name})
    db.commit()
    db.refresh(row)
    return _experience(row)


@router.patch("/experiences/{experience_id}", response_model=AdminExperienceResponse)
def patch_experience(experience_id: str, payload: AdminExperiencePatch, db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    row = get_experience_row(db, experience_id)
    if row is None:
        _not_found("experience", experience_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    row.updated_by = "admin"
    row.updated_at = _now()
    record_audit(db, actor_id=principal.actor_id, action="experience_changed", target_type="experience", target_id=row.id, metadata=payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(row)
    return _experience(row)


@router.delete("/experiences/{experience_id}", status_code=204)
def delete_experience(experience_id: str, db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    row = get_experience_row(db, experience_id)
    if row is None:
        _not_found("experience", experience_id)
    record_audit(db, actor_id=principal.actor_id, action="experience_deleted", target_type="experience", target_id=row.id, reason="Admin registry deletion")
    db.delete(row)
    db.commit()


@router.post("/experiences/{experience_id}/thumbnail", response_model=AdminExperienceResponse)
async def replace_experience_thumbnail(experience_id: str, file: UploadFile = File(...), db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    row = get_experience_row(db, experience_id)
    if row is None:
        _not_found("experience", experience_id)
    data = await file.read(get_settings().upload_max_bytes + 1)
    target = get_settings().templates_dir / "_experience_thumbnails" / f"{experience_id}.png"
    try:
        save_admin_image(data, content_type=file.content_type, target=target)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    row.thumbnail_path = str(target)
    row.preview_status = PreviewStatus.READY
    row.preview_error = None
    row.updated_by = "admin"
    row.updated_at = _now()
    record_audit(db, actor_id=principal.actor_id, action="experience_thumbnail_changed", target_type="experience", target_id=row.id, metadata={"content_type": file.content_type})
    db.commit()
    db.refresh(row)
    return _experience(row)


@router.delete("/experiences/{experience_id}/thumbnail", status_code=204)
def delete_experience_thumbnail(experience_id: str, db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    row = get_experience_row(db, experience_id)
    if row is None:
        _not_found("experience", experience_id)
    target = thumbnail_asset_path(experience_id)
    if row.thumbnail_path == str(target):
        target.unlink(missing_ok=True)
    row.thumbnail_path = None
    row.preview_status = PreviewStatus.MISSING
    row.preview_error = None
    row.updated_by = principal.actor_id
    row.updated_at = _now()
    record_audit(db, actor_id=principal.actor_id, action="experience_thumbnail_deleted", target_type="experience", target_id=row.id)
    db.commit()


@router.post("/experiences/publish-ready")
def publish_ready_experiences(payload: AdminConfirmRequest, db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="Explicit confirmation is required.")
    rows = db.query(ManagedExperience).filter(
        ManagedExperience.status == ExperienceStatus.DRAFT,
        ManagedExperience.preview_status == PreviewStatus.READY,
    ).all()
    published = 0
    for row in rows:
        if not row.thumbnail_path or not Path(row.thumbnail_path).is_file():
            continue
        row.status = ExperienceStatus.PUBLISHED
        row.updated_by = principal.actor_id
        row.updated_at = _now()
        published += 1
    record_audit(db, actor_id=principal.actor_id, action="experiences_published_ready", target_type="experience_catalog", target_id="all", metadata={"published": published})
    db.commit()
    return {"published": published}


@router.get("/preview-sources", response_model=list[PreviewSourceResponse])
def preview_sources(db: Session = Depends(get_db)):
    return [source_response(row) for row in list_sources(db)]


@router.post("/preview-sources/{source_id}", response_model=PreviewSourceResponse)
async def upload_preview_source(source_id: str, file: UploadFile = File(...), db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    data = await file.read(get_settings().upload_max_bytes + 1)
    try:
        row = save_source_asset(db, source_id, data, file.content_type, principal.actor_id)
    except PreviewFactoryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    record_audit(db, actor_id=principal.actor_id, action="preview_source_changed", target_type="preview_source", target_id=source_id)
    return source_response(row)


@router.get("/preview-sources/{source_id}/image")
def preview_source_image(source_id: str, db: Session = Depends(get_db)):
    from app.models import PreviewSource
    source = db.get(PreviewSource, source_id)
    if source is None or not source_has_asset(source):
        _not_found("preview source", source_id)
    return FileResponse(source.storage_path, media_type=source.content_type or "image/png")


@router.post("/experiences/{experience_id}/preview", response_model=PreviewJobResponse, status_code=202)
def generate_experience_preview(experience_id: str, db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    try:
        job = queue_preview_job(db, experience_id=experience_id, actor_id=principal.actor_id)
    except PreviewFactoryError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    record_audit(db, actor_id=principal.actor_id, action="experience_preview_generation_requested", target_type="experience", target_id=experience_id, metadata={"purpose": "admin_preview_generation"})
    return job_response(job)


@router.get("/preview-jobs/{job_id}", response_model=PreviewJobResponse)
def preview_job(job_id: str, db: Session = Depends(get_db)):
    from app.models import PreviewGenerationJob
    job = db.get(PreviewGenerationJob, job_id)
    if job is None:
        _not_found("preview job", job_id)
    return job_response(job)


@router.post("/preview-jobs/generate-missing", response_model=PreviewBatchResponse, status_code=202)
def generate_missing_previews(payload: PreviewBatchRequest, db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    if not payload.confirm:
        raise HTTPException(status_code=400, detail="Explicit confirmation is required before starting paid provider usage.")
    from app.models import PreviewSource
    source = db.get(PreviewSource, payload.source_id) if payload.source_id != "prompt-only" else None
    if payload.source_id != "prompt-only" and (source is None or not source_has_asset(source)):
        raise HTTPException(status_code=422, detail="Upload an approved canonical preview source first.")
    rows, skipped_ready = missing_experiences(db)
    db.commit()
    jobs = []
    for row in rows:
        try:
            jobs.append(queue_preview_job(db, experience_id=row.id, source_id=payload.source_id, actor_id=principal.actor_id))
        except PreviewFactoryError:
            continue
    record_audit(db, actor_id=principal.actor_id, action="experience_preview_batch_requested", target_type="experience_catalog", target_id="missing", metadata={"queued": len(jobs), "skipped_ready": skipped_ready, "purpose": "admin_preview_generation"})
    return {"queued": len(jobs), "skipped_ready": skipped_ready, "jobs": [job_response(job) for job in jobs]}


@router.get("/templates", response_model=list[AdminTemplateResponse])
def admin_templates(db: Session = Depends(get_db)):
    return [_template(row) for row in list_template_rows(db)]


@router.post("/templates", response_model=AdminTemplateResponse, status_code=201)
def create_template(payload: AdminTemplateCreate, db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    if get_template_row(db, payload.id):
        raise HTTPException(status_code=409, detail="template id already exists")
    settings = get_settings()
    target_dir = settings.templates_dir / payload.id
    row = ManagedTemplate(
        **payload.model_dump(),
        image_path=str(target_dir / "base.png"),
        marketing_preview_path=None,
        metadata_path=str(target_dir / "template.json"),
        updated_by="admin",
    )
    db.add(row)
    record_audit(db, actor_id=principal.actor_id, action="template_created", target_type="template", target_id=row.id, metadata={"name": row.name})
    db.commit()
    db.refresh(row)
    return _template(row)


@router.patch("/templates/{template_id}", response_model=AdminTemplateResponse)
def patch_template(template_id: str, payload: AdminTemplatePatch, db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    row = get_template_row(db, template_id)
    if row is None:
        _not_found("template", template_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    row.updated_by = "admin"
    row.updated_at = _now()
    record_audit(db, actor_id=principal.actor_id, action="template_changed", target_type="template", target_id=row.id, metadata=payload.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(row)
    return _template(row)


@router.delete("/templates/{template_id}", status_code=204)
def delete_template(template_id: str, db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    row = get_template_row(db, template_id)
    if row is None:
        _not_found("template", template_id)
    record_audit(db, actor_id=principal.actor_id, action="template_deleted", target_type="template", target_id=row.id, reason="Admin registry deletion")
    db.delete(row)
    db.commit()


@router.post("/templates/{template_id}/image", response_model=AdminTemplateResponse)
async def replace_template_image(template_id: str, file: UploadFile = File(...), db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    row = get_template_row(db, template_id)
    if row is None:
        _not_found("template", template_id)
    data = await file.read(get_settings().upload_max_bytes + 1)
    target = get_settings().templates_dir / template_id / "base.png"
    try:
        save_admin_image(data, content_type=file.content_type, target=target)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    row.image_path = str(target)
    row.updated_by = "admin"
    row.updated_at = _now()
    record_audit(db, actor_id=principal.actor_id, action="template_image_changed", target_type="template", target_id=row.id, metadata={"content_type": file.content_type})
    db.commit()
    db.refresh(row)
    return _template(row)


@router.post("/templates/{template_id}/preview", response_model=AdminTemplateResponse)
async def replace_template_preview(template_id: str, file: UploadFile = File(...), db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    row = get_template_row(db, template_id)
    if row is None:
        _not_found("template", template_id)
    data = await file.read(get_settings().upload_max_bytes + 1)
    target = get_settings().templates_dir / template_id / "preview.png"
    try:
        save_admin_image(data, content_type=file.content_type, target=target)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    row.marketing_preview_path = str(target)
    row.updated_by = "admin"
    row.updated_at = _now()
    record_audit(db, actor_id=principal.actor_id, action="template_marketing_preview_changed", target_type="template", target_id=row.id, metadata={"content_type": file.content_type})
    db.commit()
    db.refresh(row)
    return _template(row)


@router.delete("/templates/{template_id}/preview", status_code=204)
def remove_template_preview(template_id: str, db: Session = Depends(get_db), principal: AdminPrincipal = Depends(require_admin_session)):
    row = get_template_row(db, template_id)
    if row is None:
        _not_found("template", template_id)
    previous = Path(row.marketing_preview_path) if row.marketing_preview_path else None
    row.marketing_preview_path = None
    row.updated_by = "admin"
    row.updated_at = _now()
    record_audit(db, actor_id=principal.actor_id, action="template_marketing_preview_removed", target_type="template", target_id=row.id)
    db.commit()
    if previous and previous.is_file():
        previous.unlink()


@router.get("/templates/{template_id}/image")
def admin_template_image(template_id: str, db: Session = Depends(get_db)):
    row = get_template_row(db, template_id)
    path = Path(row.image_path) if row else None
    if row is None or path is None or not path.is_file():
        _not_found("template image", template_id)
    return FileResponse(path, media_type="image/png")


@router.get("/templates/{template_id}/preview")
def admin_template_preview(template_id: str, db: Session = Depends(get_db)):
    row = get_template_row(db, template_id)
    path = Path(row.marketing_preview_path) if row and row.marketing_preview_path else None
    if row is None or path is None or not path.is_file():
        _not_found("template preview", template_id)
    return FileResponse(path, media_type="image/png")


@router.get("/experiences/{experience_id}/thumbnail")
def public_experience_thumbnail(experience_id: str, db: Session = Depends(get_db)):
    row = get_experience_row(db, experience_id)
    if row is None or not row.thumbnail_path:
        _not_found("thumbnail", experience_id)
    path = Path(row.thumbnail_path)
    if not path.is_file():
        _not_found("thumbnail", experience_id)
    return FileResponse(path, media_type="image/png")


# Authentication endpoints are separate so login can establish the HttpOnly session.
auth_router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin_csrf)])


@auth_router.post("/login")
def login_admin(payload: AdminLoginRequest, response: Response, db: Session = Depends(get_db)):
    admin_login(response, payload.token, db)
    return {"authenticated": True}


@auth_router.post("/logout")
def logout_admin(request: Request, response: Response, db: Session = Depends(get_db)):
    admin_logout(request, response, db)
    return {"authenticated": False}
