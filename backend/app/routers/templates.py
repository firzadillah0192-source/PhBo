"""Public BASIC template listing and previews."""
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.catalog import get_template_row, list_template_rows, template_definition
from app.db import get_db
from app.schemas import TemplateListResponse, TemplateResponse

router = APIRouter(tags=["templates"])

@router.get("/api/templates", response_model=TemplateListResponse)
def list_templates(db: Session = Depends(get_db)) -> TemplateListResponse:
    result = []
    for row in list_template_rows(db, enabled_only=True):
        template = template_definition(db, row.id)
        preview_path = Path(row.marketing_preview_path) if row.marketing_preview_path else None
        result.append(TemplateResponse(id=row.id, name=row.name, description=row.description, preview_url=f"/api/templates/{row.id}/preview" if preview_path and preview_path.is_file() else None, width=template.width, height=template.height, basic_available=bool(Path(row.image_path).is_file() and template.face_region), enabled=row.enabled, sort_order=row.sort_order))
    return TemplateListResponse(templates=result, count=len(result))

@router.get("/api/templates/{template_id}/preview")
def template_preview(template_id: str, db: Session = Depends(get_db)):
    row = get_template_row(db, template_id)
    preview_path = Path(row.marketing_preview_path) if row and row.marketing_preview_path else None
    if row is None or not row.enabled or preview_path is None or not preview_path.is_file():
        raise HTTPException(status_code=404, detail="template marketing preview not found")
    return FileResponse(preview_path, media_type="image/png")
