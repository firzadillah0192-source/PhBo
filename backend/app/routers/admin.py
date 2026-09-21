"""Protected CRUD API for admin-managed experiences and templates."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.admin_auth import require_admin_token
from app.catalog import (
    get_experience_row, get_template_row, list_experience_rows, list_template_rows,
)
from app.core.config import get_settings
from app.db import get_db
from app.models import ManagedExperience, ManagedTemplate
from app.schemas import (
    AdminExperienceCreate, AdminExperiencePatch, AdminExperienceResponse,
    AdminTemplateCreate, AdminTemplatePatch, AdminTemplateResponse,
)
from app.services.admin_assets import save_admin_image

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin_token)])


def _now():
    return datetime.now(timezone.utc)


def _experience(row: ManagedExperience) -> AdminExperienceResponse:
    return AdminExperienceResponse.model_validate(row, from_attributes=True)


def _template(row: ManagedTemplate) -> AdminTemplateResponse:
    return AdminTemplateResponse.model_validate(row, from_attributes=True)


def _not_found(kind: str, item_id: str):
    raise HTTPException(status_code=404, detail=f"{kind} '{item_id}' not found")


@router.get("/experiences", response_model=list[AdminExperienceResponse])
def admin_experiences(db: Session = Depends(get_db)):
    return [_experience(row) for row in list_experience_rows(db)]


@router.post("/experiences", response_model=AdminExperienceResponse, status_code=201)
def create_experience(payload: AdminExperienceCreate, db: Session = Depends(get_db)):
    if get_experience_row(db, payload.id):
        raise HTTPException(status_code=409, detail="experience id already exists")
    row = ManagedExperience(**payload.model_dump(), updated_by="admin")
    db.add(row)
    db.commit()
    db.refresh(row)
    return _experience(row)


@router.patch("/experiences/{experience_id}", response_model=AdminExperienceResponse)
def patch_experience(experience_id: str, payload: AdminExperiencePatch, db: Session = Depends(get_db)):
    row = get_experience_row(db, experience_id)
    if row is None:
        _not_found("experience", experience_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    row.updated_by = "admin"
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return _experience(row)


@router.delete("/experiences/{experience_id}", status_code=204)
def delete_experience(experience_id: str, db: Session = Depends(get_db)):
    row = get_experience_row(db, experience_id)
    if row is None:
        _not_found("experience", experience_id)
    db.delete(row)
    db.commit()


@router.post("/experiences/{experience_id}/thumbnail", response_model=AdminExperienceResponse)
async def replace_experience_thumbnail(
    experience_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    row = get_experience_row(db, experience_id)
    if row is None:
        _not_found("experience", experience_id)
    data = await file.read()
    target = get_settings().templates_dir / "_experience_thumbnails" / f"{experience_id}.png"
    try:
        save_admin_image(data, content_type=file.content_type, target=target)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    row.thumbnail_path = str(target)
    row.updated_by = "admin"
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return _experience(row)


@router.get("/templates", response_model=list[AdminTemplateResponse])
def admin_templates(db: Session = Depends(get_db)):
    return [_template(row) for row in list_template_rows(db)]


@router.post("/templates", response_model=AdminTemplateResponse, status_code=201)
def create_template(payload: AdminTemplateCreate, db: Session = Depends(get_db)):
    if get_template_row(db, payload.id):
        raise HTTPException(status_code=409, detail="template id already exists")
    settings = get_settings()
    target_dir = settings.templates_dir / payload.id
    row = ManagedTemplate(
        **payload.model_dump(),
        image_path=str(target_dir / "base.png"),
        metadata_path=str(target_dir / "template.json"),
        updated_by="admin",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _template(row)


@router.patch("/templates/{template_id}", response_model=AdminTemplateResponse)
def patch_template(template_id: str, payload: AdminTemplatePatch, db: Session = Depends(get_db)):
    row = get_template_row(db, template_id)
    if row is None:
        _not_found("template", template_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    row.updated_by = "admin"
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return _template(row)


@router.delete("/templates/{template_id}", status_code=204)
def delete_template(template_id: str, db: Session = Depends(get_db)):
    row = get_template_row(db, template_id)
    if row is None:
        _not_found("template", template_id)
    db.delete(row)
    db.commit()


@router.post("/templates/{template_id}/image", response_model=AdminTemplateResponse)
async def replace_template_image(
    template_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    row = get_template_row(db, template_id)
    if row is None:
        _not_found("template", template_id)
    data = await file.read()
    target = get_settings().templates_dir / template_id / "base.png"
    try:
        save_admin_image(data, content_type=file.content_type, target=target)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    row.image_path = str(target)
    row.updated_by = "admin"
    row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return _template(row)


@router.get("/experiences/{experience_id}/thumbnail")
def public_experience_thumbnail(experience_id: str, db: Session = Depends(get_db)):
    # This route is intentionally also protected by the router dependency.
    row = get_experience_row(db, experience_id)
    if row is None or not row.thumbnail_path:
        _not_found("thumbnail", experience_id)
    path = Path(row.thumbnail_path)
    if not path.is_file():
        _not_found("thumbnail", experience_id)
    return FileResponse(path, media_type="image/png")
