"""GET /api/templates and GET /api/templates/{template_id}/preview

Read-only template listing for the MVP. No template management UI (out of
scope per spec section 3).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.schemas import TemplateListResponse, TemplateResponse
from app.templates_registry import TemplateNotFound, get_registry

router = APIRouter(tags=["templates"])


@router.get("/api/templates", response_model=TemplateListResponse, summary="List available templates")
def list_templates() -> TemplateListResponse:
    registry = get_registry()
    templates = registry.list()
    return TemplateListResponse(
        templates=[
            TemplateResponse(
                id=t.id,
                name=t.name,
                description=t.description,
                preview_url=(
                    f"/api/templates/{t.id}/preview" if t.preview_filename else None
                ),
                width=t.width,
                height=t.height,
            )
            for t in templates
        ],
        count=len(templates),
    )


@router.get(
    "/api/templates/{template_id}/preview",
    summary="Template preview image",
    responses={404: {"description": "Template or preview image not found"}},
)
def template_preview(template_id: str) -> FileResponse:
    registry = get_registry()
    try:
        template = registry.get(template_id)
    except TemplateNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not template.preview_filename:
        raise HTTPException(
            status_code=404,
            detail=f"template '{template_id}' has no preview image",
        )

    settings = get_settings()
    path = settings.templates_dir / template_id / template.preview_filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"preview file missing: {path}")

    return FileResponse(path, media_type="image/png")
