"""Focused acceptance checks for quota, customer sessions, and admin sessions."""

from __future__ import annotations

from app.ai.base import AIProviderError
from app.models import JobState
from app.services.generation import process_job


def _advanced(client, upload_id):
    return client.post("/api/generations", json={
        "upload_id": upload_id,
        "mode": "ADVANCED",
        "experience_id": "mini-me",
    })


def test_guest_quota_persists_and_basic_does_not_consume(client, uploaded_photo, captured_queue, stub_provider, db_session):
    assert client.get("/api/account/usage").json() == {
        "authenticated": False,
        "quota_type": "guest",
        "ai_total": 2,
        "ai_used": 0,
        "ai_reserved": 0,
        "ai_remaining": 2,
    }
    first = _advanced(client, uploaded_photo["upload_id"])
    second = _advanced(client, uploaded_photo["upload_id"])
    assert first.status_code == second.status_code == 202
    usage = client.get("/api/account/usage").json()
    assert usage["ai_reserved"] == 2 and usage["ai_remaining"] == 0
    assert _advanced(client, uploaded_photo["upload_id"]).status_code == 403

    assert process_job(first.json()["job_id"], db=db_session) == JobState.COMPLETED
    assert process_job(second.json()["job_id"], db=db_session) == JobState.COMPLETED
    usage = client.get("/api/account/usage").json()
    assert usage["ai_used"] == 2 and usage["ai_reserved"] == 0 and usage["ai_remaining"] == 0

    basic = client.post("/api/generations", json={
        "upload_id": uploaded_photo["upload_id"],
        "mode": "BASIC",
        "template_id": "sci-fi-space-commander-001",
    })
    assert basic.status_code == 202
    assert client.get("/api/account/usage").json()["ai_remaining"] == 0


def test_failed_ai_job_refunds_once(client, uploaded_photo, captured_queue, db_session, monkeypatch):
    import app.services.generation as generation_module

    class FailingProvider:
        name = "failing-test"

        def is_available(self):
            return True

        def generate(self, *_args, **_kwargs):
            raise AIProviderError("provider failed")

    monkeypatch.setattr(generation_module, "get_provider", lambda: FailingProvider())
    created = _advanced(client, uploaded_photo["upload_id"])
    assert created.status_code == 202
    job_id = created.json()["job_id"]
    assert client.get("/api/account/usage").json()["ai_reserved"] == 1
    assert process_job(job_id, db=db_session) == JobState.FAILED
    assert client.get("/api/account/usage").json()["ai_remaining"] == 2
    assert process_job(job_id, db=db_session) == JobState.FAILED
    usage = client.get("/api/account/usage").json()
    assert usage["ai_used"] == 0 and usage["ai_reserved"] == 0 and usage["ai_remaining"] == 2


def test_signup_gets_separate_five_unit_allocation(client, uploaded_photo, captured_queue):
    response = client.post("/api/account/signup", json={"email": "new-user@example.com", "password": "correct horse battery"})
    assert response.status_code == 201
    assert "photobooth_session=" in response.headers["set-cookie"]
    assert "; Secure" not in response.headers["set-cookie"]
    usage = client.get("/api/account/usage").json()
    assert usage["authenticated"] is True
    assert usage["quota_type"] == "account"
    assert usage["ai_total"] == 5 and usage["ai_used"] == 0 and usage["ai_remaining"] == 5
    transferred = _advanced(client, uploaded_photo["upload_id"])
    assert transferred.status_code == 202
    assert client.get("/api/account/usage").json()["ai_remaining"] == 4


def test_admin_login_establishes_cookie_session(client):
    assert client.get("/api/admin/experiences").status_code == 401
    logged_in = client.post("/api/admin/login", json={"token": "test-admin-token"})
    assert logged_in.status_code == 200
    assert "HttpOnly" in logged_in.headers["set-cookie"]
    assert client.get("/api/admin/experiences").status_code == 200
    assert client.post("/api/admin/logout").status_code == 200
    assert client.get("/api/admin/experiences").status_code == 401
