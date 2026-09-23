"""Persistence helpers for application-visible provider execution evidence."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.ai.base import AIResult
from app.models import GenerationJob, GenerationProviderRun


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _integer(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result >= 0 else None


def _nested(mapping: dict, *path: str) -> object:
    value: object = mapping
    for key in path:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _usage_values(usage: object) -> dict[str, int | None]:
    data = usage if isinstance(usage, dict) else {}
    return {
        "input_text_tokens": _integer(
            data.get("input_text_tokens")
            if data.get("input_text_tokens") is not None
            else _nested(data, "input_tokens_details", "text_tokens")
        ),
        "input_image_tokens": _integer(
            data.get("input_image_tokens")
            if data.get("input_image_tokens") is not None
            else _nested(data, "input_tokens_details", "image_tokens")
        ),
        "output_image_tokens": _integer(
            data.get("output_image_tokens")
            if data.get("output_image_tokens") is not None
            else _nested(data, "output_tokens_details", "image_tokens")
        ),
        "total_tokens": _integer(data.get("total_tokens")),
        "billable_units": _integer(data.get("billable_units")),
    }


def _apply_meta(run: GenerationProviderRun, meta: dict[str, Any]) -> None:
    usage = meta.get("usage")
    run.provider_request_id = meta.get("provider_request_id")
    run.provider_account_label = meta.get("provider_account_label")
    run.provider_account_id = meta.get("provider_account_id")
    run.provider_strategy_hint = meta.get("provider_strategy_hint")
    run.retry_count = _integer(meta.get("retry_count")) or 0
    if isinstance(meta.get("upstream_provider"), str):
        run.provider_name = meta["upstream_provider"]
    if isinstance(meta.get("response_model"), str):
        run.provider_model = meta["response_model"]
    if isinstance(usage, dict):
        run.provider_usage_raw_json = json.dumps(
            usage, separators=(",", ":"), sort_keys=True
        )
    for key, value in _usage_values(usage).items():
        setattr(run, key, value)


def start_provider_run(
    db: Session,
    *,
    job: GenerationJob,
    provider_name: str,
    provider_model: str | None,
) -> GenerationProviderRun:
    started = _now()
    run = GenerationProviderRun(
        generation_job_id=job.id,
        account_id=job.account_id,
        provider_name=provider_name,
        provider_model=provider_model,
        upstream_status="PROCESSING",
        retry_count=0,
        request_started_at=started,
        created_at=started,
    )
    db.add(run)
    db.flush()
    return run


def complete_provider_run(db: Session, run: GenerationProviderRun, result: AIResult) -> None:
    _apply_meta(run, result.raw_meta if isinstance(result.raw_meta, dict) else {})
    run.provider_model = result.model or run.provider_model
    run.upstream_status = "SUCCEEDED"
    run.request_completed_at = _now()
    run.total_duration_ms = max(
        0, int((run.request_completed_at - run.request_started_at).total_seconds() * 1000)
    )
    db.flush()


def fail_provider_run(
    db: Session,
    run: GenerationProviderRun,
    error: Exception,
) -> None:
    raw_meta = getattr(error, "operational_meta", {})
    meta = raw_meta if isinstance(raw_meta, dict) else {}
    _apply_meta(run, meta)
    run.upstream_status = str(meta.get("upstream_status") or "FAILED")[:32]
    run.upstream_error_code = str(getattr(error, "code", "INTERNAL_ERROR"))[:128]
    message = getattr(error, "message", f"{type(error).__name__}: {error}")
    run.upstream_error_message = str(message)[:2000]
    run.request_completed_at = _now()
    run.total_duration_ms = max(
        0, int((run.request_completed_at - run.request_started_at).total_seconds() * 1000)
    )
    db.flush()
