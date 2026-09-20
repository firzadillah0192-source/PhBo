"""Filesystem storage for uploads and results.

The VPS is NOT permanent customer-photo storage (spec section 9). Files are
written under runtime_dir and referenced by path from PostgreSQL. Image bytes
are never stored in the database.
"""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path

from app.core.config import get_settings

_EXT_BY_CONTENT_TYPE = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/octet-stream": ".bin",
}


def _ext_for(content_type: str, fmt: str | None = None) -> str:
    if content_type in _EXT_BY_CONTENT_TYPE:
        return _EXT_BY_CONTENT_TYPE[content_type]
    if fmt:
        return "." + fmt.lower().lstrip(".")
    return ".bin"


def save_upload(*, upload_id: str, data: bytes, content_type: str, fmt: str | None) -> Path:
    """Persist an uploaded photo. Returns the absolute path."""
    settings = get_settings()
    target_dir = settings.uploads_dir / upload_id[:2]
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{upload_id}{_ext_for(content_type, fmt)}"
    path.write_bytes(data)
    return path


def save_result(*, result_id: str, data: bytes, content_type: str) -> Path:
    """Persist a generated result image. Returns the absolute path."""
    settings = get_settings()
    target_dir = settings.results_dir / result_id[:2]
    target_dir.mkdir(parents=True, exist_ok=True)
    path = target_dir / f"{result_id}{_ext_for(content_type)}"
    path.write_bytes(data)
    return path


def read_file(path: str | Path) -> bytes:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(str(p))
    return p.read_bytes()


def delete_path(path: str | Path) -> bool:
    """Best-effort delete. Returns True if something was removed."""
    p = Path(path)
    if p.exists():
        p.unlink(missing_ok=True)
        return True
    return False


def sha256_of(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def copy_to_backup(path: str | Path, *, label: str) -> Path | None:
    """Copy a file into backups_dir (spec section 6 runtime layout)."""
    src = Path(path)
    if not src.exists():
        return None
    settings = get_settings()
    settings.backups_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.backups_dir / f"{label}-{src.name}"
    shutil.copy2(src, dest)
    return dest


def path_is_inside_runtime(path: str | Path) -> bool:
    """Guard against path traversal outside the runtime tree."""
    settings = get_settings()
    try:
        Path(path).resolve().relative_to(settings.runtime_dir.resolve())
        return True
    except (ValueError, OSError):
        return False
