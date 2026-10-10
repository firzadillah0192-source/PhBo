from __future__ import annotations

from uuid import uuid4

import pytest

from app.ai.base import AIProvider, AIProviderError, AIResult, GenerationOptions
from app.auth_models import Account, QuotaReservation
from app.models import GenerationProviderRun, JobState
from app.services.generation import process_job
from conftest import make_png

ADMIN_HEADERS = {"X-Admin-Token": "test-admin-token"}


class MetadataProvider(AIProvider):
    name = "9router"

    def is_available(self) -> bool:
        return True

    def generate(self, user_image: bytes | None, template, options: GenerationOptions) -> AIResult:
        experience = options.extra["experience"]
        return AIResult(
            image_bytes=make_png(128, 128),
            content_type="image/png",
            provider=self.name,
            model="upstream/image-v2",
            prompt_used=experience.prompt,
            raw_meta={
                "requested_model": "cx/gpt-image-2.5",
                "router_request_id": "rtr_test-123",
                "upstream_request_id": "resp_test-123",
                "provider_account_ref": "acct_004e13ad8adc",
                "routing_strategy": "round-robin",
                "provider_name": "codex",
                "provider_reported_model": "gpt-image-2.5",
                "attempt_count": 1,
                "failover_count": 0,
                "router_duration_ms": 1200,
                "usage_available": "true",
                "provider_request_id": "req-real-123",
                "upstream_provider": "upstream-vendor",
                "response_model": "upstream/image-v2",
                "provider_account_label": "oauth-primary",
                "provider_account_id": "acct-01",
                "provider_strategy_hint": "failover",
                "retry_count": 1,
                "usage": {
                    "input_tokens": 2243,
                    "output_tokens": 71,
                    "input_text_tokens": 11,
                    "input_image_tokens": 22,
                    "output_image_tokens": 33,
                    "total_tokens": 66,
                    "billable_units": 2,
                },
            },
        )


class FailingMetadataProvider(AIProvider):
    name = "9router"

    def is_available(self) -> bool:
        return True

    def generate(self, user_image: bytes | None, template, options: GenerationOptions) -> AIResult:
        raise AIProviderError(
            "upstream rejected request",
            operational_meta={
                "provider_request_id": "req-failed-456",
                "provider_account_label": "oauth-secondary",
                "provider_account_id": "acct-02",
                "upstream_status": "FAILED",
                "retry_count": 0,
            },
        )


def _account_job(client, captured_queue, db_session) -> tuple[str, str]:
    email = f"usage-{uuid4().hex[:10]}@example.com"
    signup = client.post(
        "/api/account/signup",
        json={"email": email, "password": "correct horse battery"},
    )
    assert signup.status_code == 201, signup.text
    upload = client.post(
        "/api/uploads",
        files={"file": ("portrait.png", make_png(640, 640), "image/png")},
    )
    assert upload.status_code == 201, upload.text
    created = client.post(
        "/api/generations",
        json={
            "upload_id": upload.json()["upload_id"],
            "mode": "ADVANCED",
            "experience_id": "mini-me",
        },
    )
    assert created.status_code == 202, created.text
    job_id = created.json()["job_id"]
    from app.models import GenerationJob
    job = db_session.get(GenerationJob, job_id)
    return job.account_id, job_id


def test_provider_metadata_persists_and_admin_usage_is_aggregated(
    client, captured_queue, db_session, monkeypatch
):
    import app.services.generation as generation_module

    account_id, job_id = _account_job(client, captured_queue, db_session)
    monkeypatch.setattr(generation_module, "get_provider", lambda: MetadataProvider())
    assert process_job(job_id, db=db_session) == JobState.COMPLETED

    run = db_session.query(GenerationProviderRun).filter(
        GenerationProviderRun.generation_job_id == job_id
    ).one()
    assert run.provider_name == "upstream-vendor"
    assert run.provider_model == "upstream/image-v2"
    assert run.requested_model == "cx/gpt-image-2.5"
    assert run.provider_reported_model == "upstream/image-v2"
    assert run.router_request_id == "rtr_test-123"
    assert run.upstream_request_id == "resp_test-123"
    assert run.routing_strategy == "round-robin"
    assert run.attempt_count == 1
    assert run.failover_count == 0
    assert run.router_duration_ms == 1200
    assert run.input_tokens == 2243
    assert run.output_tokens == 71
    assert run.provider_request_id == "resp_test-123"
    assert run.provider_account_id == "acct_004e13ad8adc"
    assert run.total_tokens == 66
    assert run.billable_units == 2
    assert run.retry_count == 1
    assert run.upstream_status == "SUCCEEDED"

    overview = client.get("/api/admin/usage/overview", headers=ADMIN_HEADERS)
    assert overview.status_code == 200, overview.text
    assert overview.json()["provider_usage_jobs"] >= 1
    assert overview.json()["provider_account_jobs"] >= 1

    users = client.get(
        "/api/admin/usage/users",
        headers=ADMIN_HEADERS,
        params={"q": account_id},
    )
    assert users.status_code == 200, users.text
    summary = users.json()["users"][0]
    assert summary["account_id"] == account_id
    assert summary["total_ai_credits_spent"] == 1
    assert summary["successful_advanced_generations"] == 1

    history = client.get(
        f"/api/admin/usage/users/{account_id}/generations",
        headers=ADMIN_HEADERS,
    )
    assert history.status_code == 200
    assert {row["job_id"] for row in history.json()["generations"]} == {job_id}

    filtered = client.get(
        "/api/admin/usage/generations",
        headers=ADMIN_HEADERS,
        params={"provider": "upstream-vendor", "model": "upstream/image-v2"},
    )
    assert any(row["job_id"] == job_id for row in filtered.json()["generations"])

    detail = client.get(f"/api/admin/usage/generations/{job_id}", headers=ADMIN_HEADERS)
    assert detail.status_code == 200
    provider_run = detail.json()["provider_runs"][0]
    assert provider_run["provider_usage"]["total_tokens"] == 66
    assert provider_run["provider_account_label"] == "oauth-primary"
    assert provider_run["router_request_id"] == "rtr_test-123"
    assert provider_run["upstream_request_id"] == "resp_test-123"
    assert provider_run["requested_model"] == "cx/gpt-image-2.5"
    assert provider_run["provider_reported_model"] == "upstream/image-v2"
    assert provider_run["routing_strategy"] == "round-robin"
    assert provider_run["input_tokens"] == 2243
    assert provider_run["output_tokens"] == 71
    assert provider_run["api_price_estimate"]["status"] == "unavailable"
    assert provider_run["api_price_estimate"]["low_usd"] is None
    listed = next(row for row in filtered.json()["generations"] if row["job_id"] == job_id)
    assert listed["input_tokens"] == 2243 and listed["output_tokens"] == 71
    assert listed["api_price_estimate"]["status"] == "unavailable"
    # Read-time estimation also works for historical runs without a DB migration.
    run.provider_reported_model = "gpt-image-2.5"
    db_session.commit()
    priced = client.get(f"/api/admin/usage/generations/{job_id}", headers=ADMIN_HEADERS).json()
    assert priced["provider_runs"][0]["api_price_estimate"]["low_usd"] == pytest.approx(0.001221)
    assert priced["generation"]["api_price_estimate"]["status"] == "image_token_estimate"

    accounts = client.get("/api/admin/usage/providers/accounts", headers=ADMIN_HEADERS)
    assert accounts.status_code == 200
    assert any(row["provider_account_id"] == "acct_004e13ad8adc" for row in accounts.json())

    routing = client.get("/api/admin/usage/providers/overview", headers=ADMIN_HEADERS).json()
    assert routing["can_prove_round_robin"] is False
    assert routing["routing_strategy_known"] is False
    assert "managed externally" in routing["strategy_message"]

    public = client.get(f"/api/generations/{job_id}")
    assert public.status_code == 200
    assert "provider_runs" not in public.json()
    assert "provider_request_id" not in public.json()
    assert "provider_account_id" not in public.json()


def test_provider_failure_records_error_refund_and_nullable_usage(
    client, captured_queue, db_session, monkeypatch
):
    import app.services.generation as generation_module

    account_id, job_id = _account_job(client, captured_queue, db_session)
    monkeypatch.setattr(generation_module, "get_provider", lambda: FailingMetadataProvider())
    assert process_job(job_id, db=db_session) == JobState.FAILED

    run = db_session.query(GenerationProviderRun).filter(
        GenerationProviderRun.generation_job_id == job_id
    ).one()
    assert run.provider_request_id == "req-failed-456"
    assert run.upstream_error_code == "AI_PROVIDER_ERROR"
    assert run.provider_usage_raw_json is None
    assert run.total_tokens is None
    assert run.upstream_status == "FAILED"

    reservation = db_session.query(QuotaReservation).filter(
        QuotaReservation.job_id == job_id
    ).one()
    assert reservation.status == "REFUNDED"
    account = db_session.get(Account, account_id)
    assert account.ai_quota_used == 0
    assert account.ai_quota_reserved == 0

    credits = client.get(
        f"/api/admin/usage/users/{account_id}/credits",
        headers=ADMIN_HEADERS,
    ).json()
    assert credits["summary"]["total_ai_credits_refunded"] == 1
    assert any(row["type"] == "generation_refund" for row in credits["entries"])


@pytest.mark.parametrize(
    "path",
    [
        "/api/admin/usage/overview",
        "/api/admin/usage/users",
        "/api/admin/usage/users/unknown-account",
        "/api/admin/usage/users/unknown-account/generations",
        "/api/admin/usage/users/unknown-account/credits",
        "/api/admin/usage/generations",
        "/api/admin/usage/generations/unknown-job",
        "/api/admin/usage/providers/overview",
        "/api/admin/usage/providers/accounts",
    ],
)
def test_usage_endpoints_require_admin(client, path):
    assert client.get(path).status_code == 401
