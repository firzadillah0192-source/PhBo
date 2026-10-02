"""Admin editing of Classic layout metadata and Advanced art direction presets."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
import tempfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.admin_auth import require_admin_csrf, require_admin_roles, require_admin_session
from app.core.config import get_settings
from app.db import get_db
from app.models import AdvancedFrameStyle, AdvancedOrnament, ClassicLayout
from app.routers.product_options import layout_response
from app.services.classic import ClassicLayoutError, slots_for, validated_frame

router = APIRouter(
    prefix="/api/admin", tags=["admin-product"],
    dependencies=[Depends(require_admin_session), Depends(require_admin_csrf), Depends(require_admin_roles("content_manager"))],
)


class ClassicLayoutInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9-]{1,32}$")
    slug: str = Field(pattern=r"^[a-z0-9-]{1,128}$")
    name: str = Field(min_length=1, max_length=255)
    canvas_width: int = Field(gt=0, le=10000)
    canvas_height: int = Field(gt=0, le=10000)
    shot_count: int = Field(gt=0, le=20)
    slots: list[dict]
    frame_filename: str | None = None
    enabled: bool = False
    sort_order: int = 0


class ClassicLayoutPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    canvas_width: int | None = Field(default=None, gt=0, le=10000)
    canvas_height: int | None = Field(default=None, gt=0, le=10000)
    shot_count: int | None = Field(default=None, gt=0, le=20)
    slots: list[dict] | None = None
    enabled: bool | None = None
    sort_order: int | None = None


class PresetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9-]{1,128}$")
    slug: str = Field(pattern=r"^[a-z0-9-]{1,128}$")
    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    prompt_fragment: str = Field(min_length=1)
    enabled: bool = True
    sort_order: int = 0


class PresetPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    prompt_fragment: str | None = Field(default=None, min_length=1)
    enabled: bool | None = None
    sort_order: int | None = None


def _layout_dict(row: ClassicLayout) -> dict:
    data = layout_response(row).model_dump()
    data["frame_asset_present"] = bool(row.frame_asset_path and Path(row.frame_asset_path).is_file())
    return data


def _preset_dict(row) -> dict:
    return {key: getattr(row, key) for key in ("id", "slug", "name", "description", "prompt_fragment", "enabled", "sort_order")}


def _check_layout(row: ClassicLayout) -> None:
    try:
        slots_for(row)
        if row.active:
            validated_frame(row)
    except ClassicLayoutError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/classic-layouts")
def admin_classic_layouts(db: Session = Depends(get_db)):
    return [_layout_dict(row) for row in db.query(ClassicLayout).order_by(ClassicLayout.sort_order, ClassicLayout.id).all()]


@router.post("/classic-layouts", status_code=201)
def create_classic_layout(payload: ClassicLayoutInput, db: Session = Depends(get_db)):
    if db.get(ClassicLayout, payload.id) or db.query(ClassicLayout).filter_by(slug=payload.slug).first():
        raise HTTPException(status_code=409, detail="Classic layout already exists")
    filename = payload.frame_filename
    if filename and (Path(filename).name != filename or not filename.endswith(".png")):
        raise HTTPException(status_code=422, detail="Frame filename must be a PNG basename")
    row = ClassicLayout(
        id=payload.id, slug=payload.slug, name=payload.name,
        canvas_width=payload.canvas_width, canvas_height=payload.canvas_height,
        shot_count=payload.shot_count, layout_config_json=json.dumps({"slots": payload.slots}),
        frame_asset_path=str(get_settings().templates_dir / "_classic" / filename) if filename else None,
        active=payload.enabled, sort_order=payload.sort_order,
    )
    _check_layout(row)
    db.add(row)
    db.commit()
    return _layout_dict(row)


@router.patch("/classic-layouts/{layout_id}")
def patch_classic_layout(layout_id: str, payload: ClassicLayoutPatch, db: Session = Depends(get_db)):
    row = db.get(ClassicLayout, layout_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Classic layout unavailable")
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "slots":
            config = json.loads(row.layout_config_json)
            config["slots"] = value
            row.layout_config_json = json.dumps(config)
        else:
            setattr(row, "active" if key == "enabled" else key, value)
    _check_layout(row)
    db.commit()
    return _layout_dict(row)


@router.post("/classic-layouts/{layout_id}/frame")
async def replace_classic_frame(layout_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    row = db.get(ClassicLayout, layout_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Classic layout unavailable")
    data = await file.read(get_settings().upload_max_bytes + 1)
    if len(data) > get_settings().upload_max_bytes:
        raise HTTPException(status_code=413, detail="Frame image too large")
    try:
        with Image.open(BytesIO(data)) as image:
            image.load()
            if image.format != "PNG" or "A" not in image.getbands() or image.size != (row.canvas_width, row.canvas_height):
                raise ValueError("Frame must be an alpha PNG matching the layout canvas")
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    target = get_settings().templates_dir / "_classic" / f"{layout_id}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    previous_path = row.frame_asset_path
    with tempfile.NamedTemporaryFile(suffix=".png", dir=get_settings().tmp_dir, delete=False) as candidate:
        candidate.write(data)
        candidate_path = Path(candidate.name)
    try:
        row.frame_asset_path = str(candidate_path)
        try:
            validated_frame(row)
        except ClassicLayoutError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        candidate_path.replace(target)
        row.frame_asset_path = str(target)
    except Exception:
        row.frame_asset_path = previous_path
        raise
    finally:
        candidate_path.unlink(missing_ok=True)
    db.commit()
    return _layout_dict(row)


def _presets(kind: str):
    return AdvancedFrameStyle if kind == "frame-styles" else AdvancedOrnament


@router.get("/advanced/{kind}")
def list_admin_presets(kind: str, db: Session = Depends(get_db)):
    if kind not in {"frame-styles", "ornaments"}:
        raise HTTPException(status_code=404)
    return [_preset_dict(row) for row in db.query(_presets(kind)).order_by(_presets(kind).sort_order, _presets(kind).id).all()]


@router.post("/advanced/{kind}", status_code=201)
def create_admin_preset(kind: str, payload: PresetInput, db: Session = Depends(get_db)):
    if kind not in {"frame-styles", "ornaments"}:
        raise HTTPException(status_code=404)
    model = _presets(kind)
    if db.get(model, payload.id) or db.query(model).filter_by(slug=payload.slug).first():
        raise HTTPException(status_code=409, detail="Preset already exists")
    row = model(**payload.model_dump())
    db.add(row)
    db.commit()
    return _preset_dict(row)


@router.patch("/advanced/{kind}/{preset_id}")
def patch_admin_preset(kind: str, preset_id: str, payload: PresetPatch, db: Session = Depends(get_db)):
    if kind not in {"frame-styles", "ornaments"}:
        raise HTTPException(status_code=404)
    row = db.get(_presets(kind), preset_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Preset unavailable")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, key, value)
    db.commit()
    return _preset_dict(row)
