"""Mode routing tests for Basic Local and backend-owned Advanced presets."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from app.models import GenerationJob, GenerationMode, JobState
from app.services.generation import process_job
from conftest import make_png
from conftest import make_png


def test_basic_job_calls_local_engine_and_never_ai(
    client, uploaded_photo, captured_queue, stub_provider, db_session, monkeypatch, tmp_path
):
    from app.generation.basic.engine import BasicResult
    import app.services.generation as generation_module

    calls = []

    class FakeBasicEngine:
        def generate(self, **kwargs):
            calls.append(kwargs)
            output = kwargs["output_path"]
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(make_png(128, 128))
            return BasicResult(make_png(128, 128), str(output), 128, 128)

    monkeypatch.setattr(generation_module, "get_basic_engine", lambda: FakeBasicEngine())
    response = client.post("/api/generations", json={
        "upload_id": uploaded_photo["upload_id"],
        "template_id": "sci-fi-space-commander-001",
        "mode": "BASIC",
    })
    job_id = response.json()["job_id"]
    assert process_job(job_id, db=db_session) == JobState.COMPLETED
    assert calls and calls[0]["template_id"] == "sci-fi-space-commander-001"
    with Image.open(calls[0]["user_image_path"]) as uploaded:
        assert uploaded.format == "JPEG"
        assert uploaded.mode == "RGB"
        assert Path(calls[0]["user_image_path"]).suffix == ".jpg"
    assert stub_provider.calls == []
    status = client.get(f"/api/generations/{job_id}").json()
    assert status["result_id"]
    assert status["provider"] == "local"


def test_advanced_requires_experience_and_keeps_template_out(client, uploaded_photo, captured_queue):
    response = client.post("/api/generations", json={
        "upload_id": uploaded_photo["upload_id"],
        "mode": "ADVANCED",
        "template_id": "sci-fi-space-commander-001",
    })
    assert response.status_code == 422

    response = client.post("/api/generations", json={
        "upload_id": uploaded_photo["upload_id"],
        "mode": "ADVANCED",
        "experience_id": "mini-me",
    })
    assert response.status_code == 202
    body = response.json()
    assert body["experience_id"] == "mini-me"
    assert body["template_id"] is None
    assert captured_queue == [body["job_id"]]


def test_advanced_worker_consumes_upload_id_as_canonical_jpeg(client, captured_queue, stub_provider, db_session):
    uploaded = client.post(
        "/api/uploads",
        files={"file": ("camera.PNG", make_png(640, 480), "image/png")},
    )
    assert uploaded.status_code == 201, uploaded.text
    upload_id = uploaded.json()["upload_id"]
    created = client.post("/api/generations", json={
        "upload_id": upload_id,
        "mode": "ADVANCED",
        "experience_id": "mini-me",
    })
    assert created.status_code == 202, created.text
    job_id = created.json()["job_id"]

    assert process_job(job_id, db=db_session) == JobState.COMPLETED
    assert stub_provider.calls[-1]["user_image_magic"] == b"\xff\xd8\xff"


def test_experiences_endpoint_exposes_safe_metadata_only(client):
    response = client.get("/api/experiences")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] >= 1
    assert len(body["experiences"]) == body["count"]
    item = next(item for item in body["experiences"] if item["id"] == "mini-me")
    assert item["enabled"] is True
    assert item["availability"] == "available"
    assert "prompt" not in item
    assert "internal_prompt" not in item
    assert "provider" not in item
    assert "model" not in item


def test_templates_mark_basic_compatibility(client):
    item = next(item for item in client.get("/api/templates").json()["templates"] if item["id"] == "sci-fi-space-commander-001")
    assert item["basic_available"] is True


def test_frontend_cannot_supply_advanced_prompt(client, uploaded_photo):
    response = client.post("/api/generations", json={
        "upload_id": uploaded_photo["upload_id"],
        "mode": "ADVANCED",
        "experience_id": "mini-me",
        "prompt": "override",
    })
    assert response.status_code == 422


def test_basic_engine_failure_marks_job_failed(client, uploaded_photo, captured_queue, db_session, monkeypatch):
    import app.services.generation as generation_module
    from app.generation.basic.errors import BasicFaceNotFoundError

    class FailingEngine:
        def generate(self, **kwargs):
            raise BasicFaceNotFoundError("BASIC_FACE_NOT_FOUND: no face detected")

    monkeypatch.setattr(generation_module, "get_basic_engine", lambda: FailingEngine())
    created = client.post("/api/generations", json={
        "upload_id": uploaded_photo["upload_id"],
        "mode": "BASIC",
        "template_id": "sci-fi-space-commander-001",
    }).json()
    assert process_job(created["job_id"], db=db_session) == JobState.FAILED
    status = client.get(f"/api/generations/{created['job_id']}").json()
    assert status["error_code"] == "BASIC_FACE_NOT_FOUND"


def test_job_cannot_complete_without_output_file(client, uploaded_photo, captured_queue, db_session, monkeypatch):
    from app.generation.basic.engine import BasicResult
    import app.services.generation as generation_module

    class MissingOutputEngine:
        def generate(self, **kwargs):
            return BasicResult(b"", str(kwargs["output_path"]), 0, 0)

    monkeypatch.setattr(generation_module, "get_basic_engine", lambda: MissingOutputEngine())
    created = client.post("/api/generations", json={
        "upload_id": uploaded_photo["upload_id"],
        "mode": "BASIC",
        "template_id": "sci-fi-space-commander-001",
    }).json()
    assert process_job(created["job_id"], db=db_session) == JobState.FAILED
    assert client.get(f"/api/generations/{created['job_id']}").json()["result_id"] is None


def test_basic_result_and_download_endpoints(client, uploaded_photo, captured_queue, db_session, monkeypatch):
    from app.generation.basic.engine import BasicResult
    import app.services.generation as generation_module

    class WorkingEngine:
        def generate(self, **kwargs):
            data = make_png(96, 96)
            kwargs["output_path"].parent.mkdir(parents=True, exist_ok=True)
            kwargs["output_path"].write_bytes(data)
            return BasicResult(data, str(kwargs["output_path"]), 96, 96)

    monkeypatch.setattr(generation_module, "get_basic_engine", lambda: WorkingEngine())
    created = client.post("/api/generations", json={
        "upload_id": uploaded_photo["upload_id"],
        "mode": "BASIC",
        "template_id": "sci-fi-space-commander-001",
    }).json()
    assert process_job(created["job_id"], db=db_session) == JobState.COMPLETED
    status = client.get(f"/api/generations/{created['job_id']}").json()
    result_id = status["result_id"]
    metadata = client.get(f"/api/results/{result_id}")
    assert metadata.status_code == 200
    assert metadata.json()["content_type"] == "image/png"
    preview = client.get(f"/api/results/{result_id}/image")
    download = client.get(f"/api/results/{result_id}/download")
    assert preview.status_code == 200 and preview.content.startswith(b"\x89PNG")
    assert download.status_code == 200 and download.content.startswith(b"\x89PNG")
