"""Customer-visible Classic layouts and Advanced art direction presets."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AdvancedFrameStyle, AdvancedOrnament, ClassicLayout
from app.schemas import ClassicLayoutResponse, FrameStyleResponse, OrnamentResponse
from app.services.classic import ClassicLayoutError, slots_for, validated_frame

router = APIRouter(tags=["product-options"])


def layout_response(row: ClassicLayout) -> ClassicLayoutResponse:
    return ClassicLayoutResponse(
        id=row.id, slug=row.slug, name=row.name,
        canvas_width=row.canvas_width, canvas_height=row.canvas_height,
        shot_count=row.shot_count, slots=slots_for(row),
        preview_url=f"/api/classic/layouts/{row.id}/preview",
        enabled=row.active, sort_order=row.sort_order,
    )


@router.get("/api/classic/layouts", response_model=list[ClassicLayoutResponse])
def list_classic_layouts(db: Session = Depends(get_db)):
    rows = db.query(ClassicLayout).filter(ClassicLayout.active.is_(True)).order_by(ClassicLayout.sort_order, ClassicLayout.id).all()
    result = []
    for row in rows:
        try:
            validated_frame(row)
            result.append(layout_response(row))
        except ClassicLayoutError:
            continue
    return result


@router.get("/api/classic/layouts/{layout_id}/preview")
def classic_layout_preview(layout_id: str, db: Session = Depends(get_db)):
    row = db.get(ClassicLayout, layout_id)
    if row is None or not row.active:
        raise HTTPException(status_code=404, detail="Classic layout unavailable")
    try:
        validated_frame(row)
    except ClassicLayoutError as exc:
        raise HTTPException(status_code=404, detail="Classic frame unavailable") from exc
    return FileResponse(Path(row.frame_asset_path), media_type="image/png")


@router.get("/api/advanced/frame-styles", response_model=list[FrameStyleResponse])
def list_frame_styles(db: Session = Depends(get_db)):
    rows = db.query(AdvancedFrameStyle).filter(AdvancedFrameStyle.enabled.is_(True)).order_by(AdvancedFrameStyle.sort_order, AdvancedFrameStyle.id).all()
    return [FrameStyleResponse(id=row.id, slug=row.slug, name=row.name, description=row.description, enabled=row.enabled, sort_order=row.sort_order) for row in rows]


@router.get("/api/advanced/ornaments", response_model=list[OrnamentResponse])
def list_ornaments(db: Session = Depends(get_db)):
    rows = db.query(AdvancedOrnament).filter(AdvancedOrnament.enabled.is_(True)).order_by(AdvancedOrnament.sort_order, AdvancedOrnament.id).all()
    return [OrnamentResponse(id=row.id, slug=row.slug, name=row.name, description=row.description, enabled=row.enabled, sort_order=row.sort_order) for row in rows]
