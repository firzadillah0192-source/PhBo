"""Database-backed admin catalog with legacy registry seeding."""
from __future__ import annotations

from pathlib import Path
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.experiences import ExperienceDefinition, list_experiences
from app.models import ExperienceStatus, ManagedExperience, ManagedTemplate, ClassicLayout, AdvancedFrameStyle, AdvancedOrnament
from app.services.classic import CLASSIC_SEEDS
from app.services.classic import validated_frame
from app.services.classic_events import event_frame_definitions, original_frame_definitions
from app.services.advanced_prompt import FRAME_STYLE_SEEDS, ORNAMENT_SEEDS
from app.templates_registry import TemplateDefinition, get_registry


class ExperienceNotFound(KeyError):
    """Raised when a queued Advanced job no longer has its preset row."""


def _seed_category(experience_id: str) -> str:
    """Give newly seeded rows a useful starting category without publishing them."""
    if any(token in experience_id for token in ("portrait", "headshot", "lighting", "makeup", "hair", "enhance", "color")):
        return "Portrait"
    if any(token in experience_id for token in ("underwater", "wanderlust", "landscape", "fantasy", "tarot", "statue", "wallpaper")):
        return "Fantasy"
    if any(token in experience_id for token in ("game", "comic", "chibi", "sticker", "caricature", "bobble", "figurine", "disco", "mini-me")):
        return "Playful"
    if any(token in experience_id for token in ("80s", "film", "flash", "retro", "drawing", "sketch", "scribble")):
        return "Retro"
    return "Design"

def seed_catalog(session: Session) -> None:
    settings = get_settings()
    for order, item in enumerate(list_experiences()):
        if session.get(ManagedExperience, item.id) is None:
            session.add(ManagedExperience(
                id=item.id, name=item.name, description=item.description,
                thumbnail_path=None, internal_prompt=item.prompt,
                provider=item.provider, model=item.model,
                reference_mode=item.reference_mode, output_format=item.output_format,
                status=ExperienceStatus.DRAFT, category=_seed_category(item.id),
                enabled=item.enabled, sort_order=order, updated_by="seed",
            ))
    for order, item in enumerate(get_registry().list()):
        if session.get(ManagedTemplate, item.id) is None:
            directory = settings.templates_dir / item.id
            asset = directory / (item.asset_filename or "base.png")
            preview = directory / "preview.png"
            metadata = directory / "template.json"
            session.add(ManagedTemplate(
                id=item.id, name=item.name, description=item.description,
                image_path=str(asset),
                marketing_preview_path=str(preview) if preview.is_file() else None,
                metadata_path=str(metadata) if metadata.exists() else None,
                enabled=True, sort_order=-1 if item.id == "sci-fi-space-commander-framed-001" else order, updated_by="seed",
            ))
    originals = original_frame_definitions()
    for order, (slug, name, filename, raw_slots) in enumerate(CLASSIC_SEEDS if not originals else ()):
        if session.get(ClassicLayout, slug) is None:
            slots = [dict(x=x, y=y, width=width, height=height, fit="cover") for x, y, width, height in raw_slots]
            session.add(ClassicLayout(
                id=slug, slug=slug, name=name, canvas_width=724, canvas_height=2172,
                shot_count=len(slots), layout_config_json=json.dumps({"slots": slots}),
                frame_asset_path=str(settings.templates_dir / "_classic" / filename),
                active=True, sort_order=order,
            ))
    for item in originals + event_frame_definitions():
        row = session.get(ClassicLayout, item["id"])
        previous = json.loads(row.layout_config_json) if row else {}
        version = item.get("collection_version", 1)
        if row and previous.get("collection_version", 1) >= version:
            continue
        root = settings.templates_dir / "_classic"
        frame_path = (root if item in originals else root / "events") / item["filename"]
        if not frame_path.is_file():
            continue
        if row is None:
            row = ClassicLayout(id=item["id"], slug=item["id"], name=item["name"], active=True, sort_order=item["sort_order"])
        # One-time, versioned format correction. Keep names, publication and
        # sorting; existing Result files remain immutable in result storage.
        row.canvas_width, row.canvas_height = item["canvas_width"], item["canvas_height"]
        row.shot_count, row.frame_asset_path = item["shot_count"], str(frame_path)
        row.layout_config_json = json.dumps({**previous, "slots": item["slots"], "theme_slug": item.get("theme_slug", "classic-originals"), "theme_name": item.get("theme_name", "Classic Originals"), "collection_version": version, "print_profile": item.get("print_profile")})
        validated_frame(row).close()
        session.add(row)
    for order, (slug, name, description, prompt) in enumerate(FRAME_STYLE_SEEDS):
        if session.get(AdvancedFrameStyle, slug) is None:
            session.add(AdvancedFrameStyle(id=slug, slug=slug, name=name, description=description, prompt_fragment=prompt, enabled=True, sort_order=order))
    for order, (slug, name, description, prompt) in enumerate(ORNAMENT_SEEDS):
        if session.get(AdvancedOrnament, slug) is None:
            session.add(AdvancedOrnament(id=slug, slug=slug, name=name, description=description, prompt_fragment=prompt, enabled=True, sort_order=order))
    session.commit()


def list_experience_rows(
    session: Session, *, enabled_only: bool = False, status: str | None = None,
) -> list[ManagedExperience]:
    stmt = select(ManagedExperience).order_by(ManagedExperience.sort_order, ManagedExperience.id)
    if enabled_only:
        stmt = stmt.where(ManagedExperience.enabled.is_(True))
    if status is not None:
        stmt = stmt.where(ManagedExperience.status == status)
    return list(session.scalars(stmt))


def get_experience_row(session: Session, experience_id: str) -> ManagedExperience | None:
    return session.get(ManagedExperience, experience_id)


def experience_definition(session: Session, experience_id: str) -> ExperienceDefinition:
    row = get_experience_row(session, experience_id)
    if row is None:
        raise ExperienceNotFound(f"experience not found: {experience_id}")
    return ExperienceDefinition(
        id=row.id, name=row.name, description=row.description,
        thumbnail=None, enabled=row.enabled, status=row.status.upper(),
        provider=row.provider, model=row.model, prompt=row.internal_prompt,
        reference_mode=row.reference_mode, output_format=row.output_format,
    )


def list_template_rows(session: Session, *, enabled_only: bool = False) -> list[ManagedTemplate]:
    stmt = select(ManagedTemplate).order_by(ManagedTemplate.sort_order, ManagedTemplate.id)
    if enabled_only:
        stmt = stmt.where(ManagedTemplate.enabled.is_(True))
    return list(session.scalars(stmt))


def get_template_row(session: Session, template_id: str) -> ManagedTemplate | None:
    return session.get(ManagedTemplate, template_id)


def template_definition(session: Session, template_id: str) -> TemplateDefinition:
    row = get_template_row(session, template_id)
    if row is None:
        raise KeyError(f"template not found: {template_id}")
    try:
        legacy = get_registry().get(template_id)
    except Exception:
        legacy = None
    image = Path(row.image_path)
    return TemplateDefinition(
        id=row.id, name=row.name, description=row.description,
        prompt=legacy.prompt if legacy else "",
        width=legacy.width if legacy else 1024,
        height=legacy.height if legacy else 1024,
        preview_filename=image.name if image.exists() else None,
        asset_filename=image.name if image.exists() else None,
        face_region=legacy.face_region if legacy else None,
        face_anchors=legacy.face_anchors if legacy else None,
        mask_polygon=legacy.mask_polygon if legacy else None,
    )
