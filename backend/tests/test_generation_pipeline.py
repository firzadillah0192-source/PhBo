"""Generation pipeline tests — async contract, worker state machine, results.

Two paths are asserted, deliberately kept apart:

1. NO provider configured (the real state of this environment)
   -> job ends FAILED with error_code AI_PROVIDER_NOT_CONNECTED.
   This is the honest behaviour required by spec sections 4 and 17. No image
   is invented and the job is never reported as complete.

2. Stub provider (clearly labelled TEST DOUBLE)
   -> job ends COMPLETED with a real PNG file on disk and a working download.
   This proves the plumbing only; it does NOT prove real AI generation works.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

from app.models import ErrorCode, GenerationJob, JobState, Result, Upload
from app.services.generation import process_job
from conftest import make_jpeg


# ---------------------------------------------------------------------------
# POST /api/generations — request validation
# ---------------------------------------------------------------------------
def test_generation_rejects_unknown_upload(client):
    response = client.post(
        "/api/generations",
        json={"upload_id": "doesnotexist", "template_id": "sci-fi-space-commander-001", "mode": "BASIC"},
    )
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "UPLOAD_NOT_FOUND"


def test_generation_rejects_unknown_template(client, uploaded_photo):
    response = client.post(
        "/api/generations",
        json={"upload_id": uploaded_photo["upload_id"], "template_id": "no-such-template", "mode": "BASIC"},
    )
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "TEMPLATE_NOT_FOUND"


def test_generation_rejects_upload_when_file_is_missing(client, uploaded_photo, captured_queue, db_session):
    upload = db_session.get(Upload, uploaded_photo["upload_id"])
    assert upload is not None
    Path(upload.storage_path).unlink()

    response = client.post(
        "/api/generations",
        json={
            "upload_id": uploaded_photo["upload_id"],
            "template_id": "sci-fi-space-commander-001",
            "mode": "BASIC",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "UPLOAD_NOT_FOUND"
    assert captured_queue == []


def test_generation_rejects_missing_fields(client):
    response = client.post("/api/generations", json={})
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Async contract: 202 + job_id + QUEUED, then polling
# ---------------------------------------------------------------------------
def test_generation_returns_202_queued_and_is_pollable(client, uploaded_photo, captured_queue):
    response = client.post(
        "/api/generations",
        json={
            "upload_id": uploaded_photo["upload_id"],
            "template_id": "sci-fi-space-commander-001",
            "mode": "BASIC",
        },
    )
    assert response.status_code == 202, response.text
    body = response.json()

    assert body["job_id"]
    assert body["state"] == JobState.QUEUED
    assert body["upload_id"] == uploaded_photo["upload_id"]
    assert body["template_id"] == "sci-fi-space-commander-001"

    # The job was pushed onto the queue for the worker to pick up.
    assert captured_queue == [body["job_id"]]

    # The frontend polls this endpoint; it must not assume sync completion.
    status = client.get(f"/api/generations/{body['job_id']}")
    assert status.status_code == 200
    status_body = status.json()
    assert status_body["state"] == JobState.QUEUED
    assert status_body["result_id"] is None
    assert status_body["result_url"] is None
    assert status_body["download_url"] is None


def test_generation_status_404_for_unknown_job(client):
    response = client.get("/api/generations/doesnotexist")
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "JOB_NOT_FOUND"


def test_generation_status_shape_has_all_contract_fields(client, uploaded_photo, captured_queue):
    response = client.post(
        "/api/generations",
        json={
            "upload_id": uploaded_photo["upload_id"],
            "template_id": "sci-fi-space-commander-001",
            "mode": "BASIC",
        },
    )
    job_id = response.json()["job_id"]
    body = client.get(f"/api/generations/{job_id}").json()

    expected_fields = {
        "job_id",
        "state",
        "upload_id",
        "template_id",
        "provider",
        "model",
        "error_code",
        "error_message",
        "result_id",
        "result_url",
        "download_url",
        "created_at",
        "updated_at",
        "started_at",
        "finished_at",
    }
    assert expected_fields.issubset(set(body.keys()))
