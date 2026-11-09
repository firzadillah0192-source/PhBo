from __future__ import annotations

from fastapi import Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth import Identity, current_identity
from app.db import get_db


def get_identity(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> Identity:
    return current_identity(request, response, db)
