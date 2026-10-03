"""Reviewed event-frame metadata; static assets, with no runtime AI calls."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from types import SimpleNamespace

from app.services.classic import ClassicLayoutError, validated_frame


def event_frame_definitions() -> list[dict]:
    manifest = Path(__file__).resolve().parents[1] / "data" / "classic_event_frames.json"
    if not manifest.is_file():
        return []
    data = json.loads(manifest.read_text(encoding="utf-8"))
    return data["frames"]


def original_frame_definitions() -> list[dict]:
    path = Path(__file__).resolve().parents[1] / "data" / "classic_original_strip_frames.json"
    return json.loads(path.read_text())["frames"] if path.is_file() else []


def layout_theme(config_json: str) -> dict[str, str]:
    try:
        config = json.loads(config_json)
    except (ValueError, TypeError):
        config = {}
    return {
        "theme_slug": config.get("theme_slug") or "classic-originals",
        "theme_name": config.get("theme_name") or "Classic Originals",
    }


@lru_cache(maxsize=128)
def _validate_cached(path: str, modified: int, size: int, width: int, height: int, count: int, config: str) -> None:
    # The stat and complete metadata are keys: replacing an asset or editing slots invalidates it.
    row = SimpleNamespace(frame_asset_path=path, canvas_width=width, canvas_height=height, shot_count=count, layout_config_json=config)
    validated_frame(row).close()


def validate_catalog_frame(row) -> None:
    try:
        stat = Path(row.frame_asset_path).stat()
    except (OSError, TypeError) as exc:
        raise ClassicLayoutError("Frame image is missing") from exc
    _validate_cached(row.frame_asset_path, stat.st_mtime_ns, stat.st_size, row.canvas_width, row.canvas_height, row.shot_count, row.layout_config_json)
