"""Unit tests for the template registry and template-dominant prompting."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.templates_registry import (
    TEMPLATE_DOMINANT_PREAMBLE,
    TemplateNotFound,
    TemplateRegistry,
    get_registry,
)


def test_mvp_template_is_present():
    registry = get_registry()
    ids = [t.id for t in registry.list()]
    assert "sci-fi-space-commander-001" in ids


def test_mvp_template_is_gettable():
    template = get_registry().get("sci-fi-space-commander-001")
    assert template.name == "Sci-Fi Space Commander"
    assert template.width > 0 and template.height > 0
    assert template.prompt.strip() != ""


def test_unknown_template_raises():
    with pytest.raises(TemplateNotFound):
        get_registry().get("does-not-exist")


def test_prompt_is_template_dominant():
    """Spec section 4: the template must be the visual authority."""
    template = get_registry().get("sci-fi-space-commander-001")
    prompt = template.build_prompt()

    assert prompt.startswith(TEMPLATE_DOMINANT_PREAMBLE)
    # Template-dominance language must be explicit.
    lowered = prompt.lower()
    assert "template-dominant" in lowered
    assert "not a literal face swap" in lowered
    # Moderate resemblance vocabulary must be present.
    for token in ("eye characteristics", "nose tendency", "lip tendency", "cheek contour", "jaw contour"):
        assert token in lowered, f"missing resemblance term: {token}"
    # The template brief must be included after the preamble.
    assert template.prompt in prompt


def test_disk_manifest_overlays_builtin(tmp_path: Path):
    """A template.json on disk must win over / add to the built-ins."""
    template_dir = tmp_path / "custom-template-002"
    template_dir.mkdir()
    (template_dir / "template.json").write_text(
        json.dumps(
            {
                "id": "custom-template-002",
                "name": "Custom Test Template",
                "description": "Loaded from disk by the test.",
                "prompt": "A plain studio portrait on a grey backdrop.",
                "width": 768,
                "height": 1024,
            }
        ),
        encoding="utf-8",
    )

    registry = TemplateRegistry(templates_dir=tmp_path)
    template = registry.get("custom-template-002")
    assert template.name == "Custom Test Template"
    assert (template.width, template.height) == (768, 1024)
    # Built-in still available alongside it.
    assert registry.get("sci-fi-space-commander-001") is not None


def test_broken_manifest_is_skipped_not_fatal(tmp_path: Path):
    """A malformed manifest must not take down the whole registry."""
    bad_dir = tmp_path / "broken-template"
    bad_dir.mkdir()
    (bad_dir / "template.json").write_text("{ this is not valid json", encoding="utf-8")

    registry = TemplateRegistry(templates_dir=tmp_path)
    # Built-in survives.
    assert registry.get("sci-fi-space-commander-001") is not None
    with pytest.raises(TemplateNotFound):
        registry.get("broken-template")


def test_preview_filename_detected(tmp_path: Path):
    template_dir = tmp_path / "with-preview"
    template_dir.mkdir()
    (template_dir / "template.json").write_text(
        json.dumps({"id": "with-preview", "name": "P", "description": "", "prompt": "x"}),
        encoding="utf-8",
    )
    (template_dir / "preview.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    registry = TemplateRegistry(templates_dir=tmp_path)
    assert registry.get("with-preview").preview_filename == "preview.png"


def test_registry_reload_picks_up_new_template(tmp_path: Path):
    registry = TemplateRegistry(templates_dir=tmp_path)
    with pytest.raises(TemplateNotFound):
        registry.get("late-template")

    late_dir = tmp_path / "late-template"
    late_dir.mkdir()
    (late_dir / "template.json").write_text(
        json.dumps({"id": "late-template", "name": "Late", "description": "", "prompt": "y"}),
        encoding="utf-8",
    )

    registry.reload()
    assert registry.get("late-template").name == "Late"
