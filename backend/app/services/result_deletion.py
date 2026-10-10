"""Delete generated photo bytes while retaining job and usage evidence."""

from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Literal

from app.core.config import get_settings
from app.models import Result, ResultClaim
from app.services.control_plane import now_utc, record_generation_event


class ResultDeleteRequest(BaseModel):
    confirm: Literal[True]


def delete_result_photo(db: Session, result: Result, *, actor_type: str) -> None:
    path = Path(result.storage_path)
    root = get_settings().results_dir.resolve()
    try:
        resolved = path.resolve()
        expected_parent = root / result.id[:2]
        if path.is_symlink() or resolved.parent != expected_parent or resolved.stem != result.id:
            raise ValueError("Invalid result storage path")
        # missing_ok also lets owners remove an expired result from their gallery.
        path.unlink(missing_ok=True)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail={"error_code": "RESULT_DELETE_FAILED", "message": "Could not delete the result photo."}) from exc
    result.deleted_at = now_utc()
    db.query(ResultClaim).filter(ResultClaim.result_id == result.id).update({ResultClaim.is_revoked: True}, synchronize_session="fetch")
    record_generation_event(db, result.job_id, "result_photo_deleted", "Generated photo deleted", {"result_id": result.id, "actor_type": actor_type})
