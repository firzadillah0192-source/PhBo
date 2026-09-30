"""API contract tests — health, templates, uploads, generation enqueue.

Covers the contract in docs/API_CONTRACT.md for the synchronous half of the
slice. Generation completion (worker + provider) is covered in
test_generation_pipeline.py.
"""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image

from app.main import app as fastapi_app
from app.models import GenerationJob, JobState, Upload, new_id
from app.services.uploads import cleanup_expired_uploads
from conftest import make_jpeg, make_png


# ---------------------------------------------------------------------------
# GET /api/health
# ---------------------------------------------------------------------------
def test_health_reports_real_status(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["app"] == "Photobooth AI"
    assert body["environment"] == "test"
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["redis"] in ("ok", "error: unreachable")
    # No provider is configured in the test env, and health must say so.
    assert body["ai_provider"] == "none"
    assert body["ai_provider_connected"] is False
    assert "not_connected" in body["checks"]["ai_provider"]


# ---------------------------------------------------------------------------
# GET /api/templates
# ---------------------------------------------------------------------------
def test_templates_lists_mvp_template(client):
    response = client.get("/api/templates")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == len(body["templates"]) >= 1
    ids = [t["id"] for t in body["templates"]]
    assert "sci-fi-space-commander-001" in ids

    template = next(t for t in body["templates"] if t["id"] == "sci-fi-space-commander-001")
    assert template["name"] == "Sci-Fi Space Commander"
    assert template["width"] > 0 and template["height"] > 0
    assert template["preview_url"] is None
    assert "image_path" not in template and "metadata_path" not in template
    assert "prompt" not in template  # Internal preset text stays on the server.


def test_template_preview_404_when_no_preview_file(client):
    response = client.get("/api/templates/sci-fi-space-commander-001/preview")
    assert response.status_code == 404


def test_template_preview_404_for_unknown_template(client):
    response = client.get("/api/templates/nope/preview")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/uploads
# ---------------------------------------------------------------------------
def test_upload_valid_photo(client):
    data = make_jpeg(640, 480)
    response = client.post("/api/uploads", files={"file": ("portrait.jpg", data, "image/jpeg")})
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["upload_id"]
    assert body["filename"] == "portrait.jpg"
    assert body["content_type"] == "image/jpeg"
    assert body["normalized_content_type"] == "image/jpeg"
    assert body["size_bytes"] > 0
    assert body["width"] == 640 and body["height"] == 480
    assert body["format"] == "JPEG"
    assert len(body["sha256"]) == 64
    assert body["validation_status"] == "VALID"
    assert body["preview_url"] == f"/api/uploads/{body['upload_id']}/preview"


def test_upload_preview_returns_the_same_bytes(client, uploaded_photo):
    response = client.get(uploaded_photo["preview_url"])
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content[:3] == b"\xff\xd8\xff"
    assert len(response.content) == uploaded_photo["size_bytes"]
    assert response.headers["cache-control"] == "private, no-store, max-age=0"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_upload_metadata_can_restore_preview_after_navigation_or_refresh(client, uploaded_photo):
    restored = client.get(f"/api/uploads/{uploaded_photo['upload_id']}")
    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert body["upload_id"] == uploaded_photo["upload_id"]
    assert body["preview_url"] == uploaded_photo["preview_url"]
    assert body["expires_at"]
    assert "storage_path" not in body
    image = client.get(body["preview_url"])
    assert image.status_code == 200
    assert image.content[:3] == b"\xff\xd8\xff"


def test_upload_accepts_mobile_mime_and_uppercase_extension(client):
    data = make_jpeg(640, 480)
    response = client.post(
        "/api/uploads",
        files={"file": ("IMG_0812.HEIC", data, "application/octet-stream")},
        headers={"user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["content_type"] == body["normalized_content_type"] == "image/jpeg"
    assert body["format"] == "JPEG"
    restored = client.get(body["preview_url"])
    assert restored.status_code == 200
    assert restored.headers["content-type"] == "image/jpeg"
    assert restored.content[:3] == b"\xff\xd8\xff"


def test_upload_accepts_empty_mime_and_png(client):
    data = make_png(640, 480)
    response = client.post("/api/uploads", files={"file": ("Portrait.PNG", data, "")})
    assert response.status_code == 201, response.text
    assert response.json()["content_type"] == "image/jpeg"
    assert response.json()["format"] == "JPEG"


def test_upload_accepts_android_chrome_webp_and_logs_stages_safely(client, caplog):
    image = Image.new("RGB", (640, 480), (22, 80, 140))
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=88)
    caplog.set_level("INFO", logger="photobooth.upload")

    response = client.post(
        "/api/uploads",
        files={"file": ("camera.WEBP", buffer.getvalue(), "image/webp")},
        headers={"user-agent": "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/136.0.0.0 Mobile Safari/537.36"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["upload_id"]
    assert body["content_type"] == "image/jpeg"
    assert body["width"] == 640 and body["height"] == 480
    assert client.get(body["preview_url"]).headers["content-type"] == "image/jpeg"
    for event in ("upload_received", "decode_success", "normalize_success", "validation_success", "upload_persisted"):
        assert event in caplog.text
    assert "android_chrome" in caplog.text
    assert "storage_path" not in caplog.text
    assert "base64" not in caplog.text.lower()


def test_heif_upload_is_stored_and_served_as_oriented_jpeg(client):
    import pytest

    pytest.importorskip("pillow_heif")
    fixture = Path(__file__).parent / "fixtures" / "synthetic-oriented.heic"
    response = client.post(
        "/api/uploads",
        files={"file": ("IMG_0001.HEIC", fixture.read_bytes(), "")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["content_type"] == body["normalized_content_type"] == "image/jpeg"
    assert body["format"] == "JPEG"
    assert (body["width"], body["height"]) == (480, 640)
    preview = client.get(body["preview_url"])
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/jpeg"
    assert preview.content[:3] == b"\xff\xd8\xff"


def test_upload_is_not_available_to_another_guest(client, uploaded_photo):
    from fastapi.testclient import TestClient

    with TestClient(fastapi_app) as other_guest:
        metadata = other_guest.get(f"/api/uploads/{uploaded_photo['upload_id']}")
        preview = other_guest.get(uploaded_photo["preview_url"])
        generation = other_guest.post(
            "/api/generations",
            json={
                "upload_id": uploaded_photo["upload_id"],
                "template_id": "sci-fi-space-commander-001",
                "mode": "BASIC",
            },
        )
    assert metadata.status_code == 404
    assert preview.status_code == 404
    assert generation.status_code == 404
    assert metadata.json()["detail"]["error_code"] == "UPLOAD_NOT_FOUND"


def test_upload_ownership_survives_guest_to_account_upgrade_but_not_other_account(client, uploaded_photo):
    upgraded = client.post(
        "/api/account/signup",
        json={"email": "upload-owner@example.com", "password": "correct horse battery"},
    )
    assert upgraded.status_code == 201
    assert client.get(f"/api/uploads/{uploaded_photo['upload_id']}").status_code == 200

    from fastapi.testclient import TestClient

    with TestClient(fastapi_app) as other_account:
        signup = other_account.post(
            "/api/account/signup",
            json={"email": "other-upload-owner@example.com", "password": "correct horse battery"},
        )
        assert signup.status_code == 201
        response = other_account.get(f"/api/uploads/{uploaded_photo['upload_id']}")
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "UPLOAD_NOT_FOUND"


def test_expired_upload_returns_recovery_error_without_storage_path(client, uploaded_photo, db_session):
    upload = db_session.get(Upload, uploaded_photo["upload_id"])
    upload.created_at = datetime.now(timezone.utc) - timedelta(hours=25)
    db_session.commit()

    response = client.get(f"/api/uploads/{uploaded_photo['upload_id']}")
    assert response.status_code == 410
    assert response.json()["detail"]["error_code"] == "UPLOAD_EXPIRED"
    assert response.json()["detail"]["message"] == "The uploaded photo is no longer available. Please upload it again."
    assert upload.storage_path not in response.text


def test_expired_upload_cleanup_removes_temporary_file_and_unreferenced_row(client, uploaded_photo, db_session):
    upload = db_session.get(Upload, uploaded_photo["upload_id"])
    path = upload.storage_path
    from pathlib import Path

    assert Path(path).is_file()
    upload.created_at = datetime.now(timezone.utc) - timedelta(hours=25)
    db_session.commit()

    counts = cleanup_expired_uploads(db=db_session)
    assert counts["files_removed"] == 1
    assert counts["rows_removed"] == 1
    assert not Path(path).exists()
    assert db_session.get(Upload, uploaded_photo["upload_id"]) is None


def test_expired_upload_is_retained_during_job_then_scrubbed_without_breaking_job_reference(client, uploaded_photo, db_session):
    from pathlib import Path

    upload = db_session.get(Upload, uploaded_photo["upload_id"])
    path = upload.storage_path
    upload.created_at = datetime.now(timezone.utc) - timedelta(hours=25)
    job = GenerationJob(
        id=new_id(),
        upload_id=upload.id,
        template_id="sci-fi-space-commander-001",
        mode="BASIC",
        state=JobState.PROCESSING,
    )
    db_session.add(job)
    db_session.commit()

    active_counts = cleanup_expired_uploads(db=db_session)
    assert active_counts["active_jobs_skipped"] == 1
    assert Path(path).is_file()

    job.state = JobState.COMPLETED
    db_session.commit()
    final_counts = cleanup_expired_uploads(db=db_session)
    db_session.refresh(upload)
    assert final_counts["files_removed"] == 1
    assert final_counts["metadata_scrubbed"] == 1
    assert not Path(path).exists()
    assert upload.storage_path == ""
    assert upload.sha256 == ""
    assert upload.filename == ""
    assert upload.validation_status == "EXPIRED"
    assert db_session.get(GenerationJob, job.id).upload_id == upload.id


def test_missing_upload_file_does_not_return_storage_path(client, uploaded_photo, db_session):
    from pathlib import Path

    upload = db_session.get(Upload, uploaded_photo["upload_id"])
    path = upload.storage_path
    Path(path).unlink()
    response = client.get(f"/api/uploads/{uploaded_photo['upload_id']}")
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "UPLOAD_NOT_FOUND"
    assert path not in response.text


def test_upload_rejects_non_image(client):
    response = client.post(
        "/api/uploads", files={"file": ("notes.txt", b"hello world", "text/plain")}
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["error_code"] == "IMAGE_DECODE_FAILED"
    assert detail["message"]


def test_upload_rejects_corrupt_image(client):
    response = client.post(
        "/api/uploads",
        files={"file": ("broken.jpg", b"\xff\xd8\xff\xe0garbage", "image/jpeg")},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["error_code"] == "IMAGE_DECODE_FAILED"


def test_upload_rejects_too_small_image(client):
    response = client.post(
        "/api/uploads", files={"file": ("tiny.png", make_png(64, 64), "image/png")}
    )
    assert response.status_code == 422
    assert "too small" in response.json()["detail"]["message"]


def test_upload_preview_404_for_unknown_id(client):
    response = client.get("/api/uploads/doesnotexist/preview")
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "UPLOAD_NOT_FOUND"
