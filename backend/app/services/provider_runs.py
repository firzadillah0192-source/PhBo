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
        "input_tokens": _integer(data.get("input_tokens")),
        "output_tokens": _integer(data.get("output_tokens")),
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
    if isinstance(meta.get("requested_model"), str):
        run.requested_model = meta["requested_model"]
    run.router_request_id = meta.get("router_request_id")
    run.upstream_request_id = meta.get("upstream_request_id")
    # Preserve the old field as an upstream-request compatibility alias.
    run.provider_request_id = run.upstream_request_id or meta.get("provider_request_id")
    run.provider_account_label = meta.get("provider_account_label")
    run.provider_account_id = meta.get("provider_account_ref") or meta.get("provider_account_id")
    run.provider_strategy_hint = meta.get("routing_strategy") or meta.get("provider_strategy_hint")
    run.routing_strategy = meta.get("routing_strategy") or meta.get("provider_strategy_hint")
    if meta.get("retry_count") is not None:
        run.retry_count = _integer(meta.get("retry_count"))
    run.attempt_count = _integer(meta.get("attempt_count"))
    run.failover_count = _integer(meta.get("failover_count"))
    run.router_duration_ms = _integer(meta.get("router_duration_ms"))
    if meta.get("usage_available") is not None:
        run.usage_available = str(meta.get("usage_available")).lower() == "true"
    if meta.get("provider_reported_cost") is not None:
        try:
            run.provider_reported_cost = float(meta["provider_reported_cost"])
        except (TypeError, ValueError):
            run.provider_reported_cost = None
    if isinstance(meta.get("provider_name"), str):
        run.provider_name = meta["provider_name"]
    if isinstance(meta.get("upstream_provider"), str):
        run.provider_name = meta["upstream_provider"]
    if isinstance(meta.get("provider_reported_model"), str):
        run.provider_reported_model = meta["provider_reported_model"]
        run.provider_model = meta["provider_reported_model"]
    elif isinstance(meta.get("response_model"), str):
        run.provider_reported_model = meta["response_model"]
        run.provider_model = meta["response_model"]
    if isinstance(usage, dict):
        run.provider_usage_raw_json = json.dumps(
            usage, separators=(",", ":"), sort_keys=True
        )
        run.usage_available = True
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
        requested_model=provider_model,
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
    if result.model:
        run.provider_reported_model = result.model
        run.provider_model = result.model
    run.upstream_status = "SUCCEEDED"
    run.request_completed_at = _now()
    run.total_duration_ms = max(
        0, int((run.request_completed_at - run.request_started_at).total_seconds() * 1000)
    )
    job = db.get(GenerationJob, run.generation_job_id)
    if job and job.started_at:
        run.application_duration_ms = max(
            0, int((run.request_completed_at - job.started_at).total_seconds() * 1000)
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
    job = db.get(GenerationJob, run.generation_job_id)
    if job and job.started_at:
        run.application_duration_ms = max(
            0, int((run.request_completed_at - job.started_at).total_seconds() * 1000)
        )
    db.flush()
