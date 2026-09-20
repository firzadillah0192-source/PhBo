"""Mode dispatch on an existing job queue: Basic never calls the AI provider."""

from __future__ import annotations

from sqlalchemy import create_engine, inspect, text

from app.models import ErrorCode, GenerationJob, GenerationMode, JobState
from app.services.generation import process_job


def test_basic_job_fails_honestly_without_ai_or_result(
    client, uploaded_photo, captured_queue, stub_provider, db_session
):
    response = client.post(
        "/api/generations",
        json={
            "upload_id": uploaded_photo["upload_id"],
            "template_id": "sci-fi-space-commander-001",
            "mode": "BASIC",
        },
    )
    assert response.status_code == 202
    created = response.json()
    assert created["mode"] == GenerationMode.BASIC
    assert captured_queue == [created["job_id"]]
    assert process_job(created["job_id"], db=db_session) == JobState.FAILED
    status = client.get(f"/api/generations/{created['job_id']}").json()
    assert status["mode"] == GenerationMode.BASIC
    assert status["error_code"] == ErrorCode.BASIC_ENGINE_NOT_CONNECTED
    assert status["result_id"] is None
    assert stub_provider.calls == []
    assert db_session.get(GenerationJob, created["job_id"]).result is None


def test_existing_client_defaults_to_advanced(client, uploaded_photo, captured_queue):
    response = client.post(
        "/api/generations",
        json={
            "upload_id": uploaded_photo["upload_id"],
            "template_id": "sci-fi-space-commander-001",
        },
    )
    assert response.status_code == 202
    assert response.json()["mode"] == GenerationMode.ADVANCED
    assert client.get(f"/api/generations/{response.json()['job_id']}").json()["mode"] == GenerationMode.ADVANCED


def test_mode_rejects_unknown_value(client, uploaded_photo, captured_queue):
    response = client.post(
        "/api/generations",
        json={
            "upload_id": uploaded_photo["upload_id"],
            "template_id": "sci-fi-space-commander-001",
            "mode": "OTHER",
        },
    )
    assert response.status_code == 422
    assert captured_queue == []


def test_legacy_jobs_migrate_to_advanced(monkeypatch):
    """Existing installations have a generation_jobs table without mode."""
    import app.db as db_mod

    legacy = create_engine("sqlite+pysqlite:///:memory:")
    with legacy.begin() as conn:
        conn.execute(text("CREATE TABLE generation_jobs (id VARCHAR(32) PRIMARY KEY)"))
        conn.execute(text("INSERT INTO generation_jobs (id) VALUES ('old-job')"))
    monkeypatch.setattr(db_mod, "engine", legacy)
    db_mod.init_db()
    db_mod.init_db()  # repeat startup must be safe
    assert "mode" in {column["name"] for column in inspect(legacy).get_columns("generation_jobs")}
    with legacy.connect() as conn:
        assert conn.execute(text("SELECT mode FROM generation_jobs WHERE id='old-job'")).scalar_one() == "ADVANCED"
