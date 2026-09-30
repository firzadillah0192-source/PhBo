"""Safe Advanced experience metadata for the customer frontend."""
import json
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.catalog import get_experience_row, list_experience_rows
from app.db import get_db
from app.models import ExperienceStatus
from app.schemas import ExperienceListResponse, ExperienceResponse

router = APIRouter(tags=["experiences"])

@router.get("/api/experiences", response_model=ExperienceListResponse)
def list_available_experiences(db: Session = Depends(get_db)) -> ExperienceListResponse:
    rows = list_experience_rows(db, status=ExperienceStatus.PUBLISHED)
    items = [ExperienceResponse(
        id=row.id, name=row.name, description=row.description, category=row.category,
        thumbnail=(f"/api/experiences/{row.id}/thumbnail" if row.thumbnail_path and Path(row.thumbnail_path).is_file() else None),
        enabled=True, sort_order=row.sort_order, availability="available",
        compatible_frame_style_ids=json.loads(row.compatible_frame_style_ids_json) if row.compatible_frame_style_ids_json else None,
        compatible_ornament_ids=json.loads(row.compatible_ornament_ids_json) if row.compatible_ornament_ids_json else None,
        max_ornaments=row.max_ornaments,
    ) for row in rows]
    return ExperienceListResponse(experiences=items, count=len(items))

@router.get("/api/experiences/{experience_id}/thumbnail")
def experience_thumbnail(experience_id: str, db: Session = Depends(get_db)):
    row = get_experience_row(db, experience_id)
    if row is None or row.status != ExperienceStatus.PUBLISHED or not row.thumbnail_path or not Path(row.thumbnail_path).is_file():
        raise HTTPException(status_code=404, detail="experience thumbnail not found")
    return FileResponse(row.thumbnail_path, media_type="image/png")
