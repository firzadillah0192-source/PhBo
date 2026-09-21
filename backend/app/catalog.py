"""Database-backed admin catalog with legacy registry seeding."""
from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.experiences import ExperienceDefinition, list_experiences
from app.models import ManagedExperience, ManagedTemplate
from app.templates_registry import TemplateDefinition, get_registry


def seed_catalog(session: Session) -> None:
    settings = get_settings()
    for order, item in enumerate(list_experiences()):
        if session.get(ManagedExperience, item.id) is None:
            session.add(ManagedExperience(
                id=item.id, name=item.name, description=item.description,
                thumbnail_path=None, internal_prompt=item.prompt,
                provider=item.provider, model=item.model,
                reference_mode=item.reference_mode, output_format=item.output_format,
                enabled=item.enabled, sort_order=order, updated_by="seed",
            ))
    for order, item in enumerate(get_registry().list()):
        if session.get(ManagedTemplate, item.id) is None:
            directory = settings.templates_dir / item.id
            asset = directory / (item.asset_filename or "base.png")
            metadata = directory / "template.json"
            session.add(ManagedTemplate(
                id=item.id, name=item.name, description=item.description,
                image_path=str(asset), metadata_path=str(metadata) if metadata.exists() else None,
                enabled=True, sort_order=order, updated_by="seed",
            ))
    session.commit()


def list_experience_rows(session: Session, *, enabled_only: bool = False) -> list[ManagedExperience]:
    stmt = select(ManagedExperience).order_by(ManagedExperience.sort_order, ManagedExperience.id)
    if enabled_only:
        stmt = stmt.where(ManagedExperience.enabled.is_(True))
    return list(session.scalars(stmt))


def get_experience_row(session: Session, experience_id: str) -> ManagedExperience | None:
    return session.get(ManagedExperience, experience_id)


def experience_definition(session: Session, experience_id: str) -> ExperienceDefinition:
    row = get_experience_row(session, experience_id)
    if row is None:
        raise KeyError(f"experience not found: {experience_id}")
    return ExperienceDefinition(
        id=row.id, name=row.name, description=row.description,
        thumbnail=None, enabled=row.enabled, status="ACTIVE" if row.enabled else "DISABLED",
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
    )
