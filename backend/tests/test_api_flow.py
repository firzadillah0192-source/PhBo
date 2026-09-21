"""API contract tests — health, templates, uploads, generation enqueue.

Covers the contract in docs/API_CONTRACT.md for the synchronous half of the
slice. Generation completion (worker + provider) is covered in
test_generation_pipeline.py.
"""

from __future__ import annotations

from app.models import JobState
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
    assert body["size_bytes"] == len(data)
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


def test_upload_rejects_non_image(client):
    response = client.post(
        "/api/uploads", files={"file": ("notes.txt", b"hello world", "text/plain")}
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["error_code"] == "VALIDATION_FAILED"
    assert detail["message"]


def test_upload_rejects_corrupt_image(client):
    response = client.post(
        "/api/uploads",
        files={"file": ("broken.jpg", b"\xff\xd8\xff\xe0garbage", "image/jpeg")},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["error_code"] == "VALIDATION_FAILED"


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
