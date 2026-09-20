"""Consistent JSON error responses.

Every error the API returns is shaped like:
    {"detail": {"error_code": "...", "message": "...", "detail": "..."}}

This keeps the frontend error handling uniform and matches the ErrorResponse
schema. FastAPI's HTTPException detail is used as the carrier so status codes
stay standard.
"""

from __future__ import annotations

from fastapi import HTTPException


class APIError(HTTPException):
    """HTTPException carrying the structured error payload."""

    def __init__(
        self,
        status_code: int,
        error_code: str,
        message: str,
        *,
        detail: str | None = None,
    ) -> None:
        super().__init__(
            status_code=status_code,
            detail={"error_code": error_code, "message": message, "detail": detail},
        )
        self.error_code = error_code
