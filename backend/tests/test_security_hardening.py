"""Attack regressions for private photos, browser sessions and upload limits."""

import io
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from app.ai.base import AIProviderError
from app.auth import ADMIN_COOKIE, create_auth_session, sign_value, unsign_value
from app.auth_models import AdminUser, AuthIdentity
from app.core.config import Settings, get_settings
from app.main import create_app
from app.models import GenerationJob, JobState, Upload
from app.services.generation import process_job
from app.services.google_auth import GoogleClaims
from app.services.image_validation import ImageValidationError, validate_image_bytes
from conftest import make_jpeg, make_png


def _make_bmp():
    buffer = io.BytesIO()
    Image.new("RGB", (300, 300)).save(buffer, format="BMP")
    return buffer.getvalue()


@pytest.mark.parametrize("url", [
    "/api/account/login", "/api/account/signup", "/api/account/google",
    "/api/account/logout", "/api/admin/login", "/api/admin/logout", "/api/generations",
])
@pytest.mark.parametrize("headers", [
    {"Origin": "https://attacker.example"},
    {"Origin": "null"},
    {"Referer": "https://attacker.example/form"},
    {"Sec-Fetch-Site": "cross-site"},
    {"Sec-Fetch-Site": "same-site"},
])
def test_browser_mutations_reject_untrusted_provenance(client, url, headers):
    response = client.post(url, json={}, headers=headers)
    assert response.status_code == 403
    assert response.json()["detail"]["error_code"] == "CSRF_BLOCKED"


def test_cross_site_multipart_upload_is_blocked(client):
    response = client.post("/api/uploads", files={"file": ("photo.jpg", make_jpeg(), "image/jpeg")}, headers={"Origin": "https://attacker.example"})
    assert response.status_code == 403


@pytest.mark.parametrize("headers", [
    {}, {"Origin": "http://testserver"}, {"Referer": "http://testserver/account"},
    {"Origin": "http://localhost:5173", "Sec-Fetch-Site": "cross-site"},
])
def test_trusted_browser_and_cli_requests_still_work(client, headers):
    assert client.post("/api/account/logout", headers=headers).status_code == 200


def test_photo_job_and_result_are_private_even_when_legacy_rows_lack_owner(client, uploaded_photo, captured_queue, stub_provider, db_session):
    job = client.post("/api/generations", json={"upload_id": uploaded_photo["upload_id"], "mode": "ADVANCED", "experience_id": "mini-me"}).json()
    assert process_job(job["job_id"], db=db_session) == JobState.COMPLETED
    result_id = client.get(f"/api/generations/{job['job_id']}").json()["result_id"]
    urls = [uploaded_photo["preview_url"], f"/api/generations/{job['job_id']}", f"/api/results/{result_id}", f"/api/results/{result_id}/image", f"/api/results/{result_id}/download"]
    for url in urls:
        assert client.get(url).status_code == 200
    with TestClient(client.app) as outsider:
        for url in urls:
            assert outsider.get(url).status_code == 404
        assert outsider.post("/api/generations", json={"upload_id": uploaded_photo["upload_id"], "mode": "ADVANCED", "experience_id": "mini-me"}).status_code == 404

    for row in (db_session.get(Upload, uploaded_photo["upload_id"]), db_session.get(GenerationJob, job["job_id"])):
        row.account_id = None
        row.guest_id = None
    db_session.commit()
    for url in urls:
        assert client.get(url).status_code == 404
    assert client.post("/api/generations", json={"upload_id": uploaded_photo["upload_id"], "mode": "ADVANCED", "experience_id": "mini-me"}).status_code == 404


def test_admin_role_changes_and_revocation_apply_to_existing_session(client, db_session):
    actor = AdminUser(id=uuid4().hex, name="Security test", role="superadmin", is_active=True)
    db_session.add(actor)
    db_session.commit()
    raw = create_auth_session(db_session, is_admin=True, admin_user_id=actor.id, admin_role="superadmin")
    client.cookies.set(ADMIN_COOKIE, sign_value(raw))
    assert client.get("/api/admin/experiences").status_code == 200
    actor.role = "operator"
    db_session.commit()
    assert client.get("/api/admin/experiences").status_code == 403
    actor.is_active = False
    db_session.commit()
    assert client.get("/api/admin/overview").status_code == 401
    db_session.delete(actor)
    db_session.commit()
    assert client.get("/api/admin/overview").status_code == 401


def test_legacy_admin_header_cannot_bypass_registry_role_or_disabled_state(client, db_session):
    actor = db_session.get(AdminUser, "token-admin")
    if actor is None:
        actor = AdminUser(id="token-admin", name="Token admin", role="superadmin", is_active=True)
        db_session.add(actor)
        db_session.commit()
    original = (actor.role, actor.is_active)
    try:
        actor.role = "operator"
        db_session.commit()
        assert client.get("/api/admin/experiences", headers={"X-Admin-Token": "test-admin-token"}).status_code == 403
        actor.is_active = False
        db_session.commit()
        assert client.get("/api/admin/overview", headers={"X-Admin-Token": "test-admin-token"}).status_code == 401
        assert client.post("/api/admin/login", json={"token": "test-admin-token"}).status_code == 401
    finally:
        actor.role, actor.is_active = original
        db_session.commit()


@pytest.mark.parametrize("filename,content_type,data", [
    ("photo.png", "image/png", make_jpeg()),
    ("photo.jpg", "image/jpeg", make_png()),
    ("photo.html", "image/jpeg", make_jpeg()),
    ("../photo.jpg", "image/jpeg", make_jpeg()),
    ("photo.jpg", "image/jpeg", _make_bmp()),
])
def test_upload_rejects_spoofed_types_extensions_and_paths(client, filename, content_type, data):
    response = client.post("/api/uploads", files={"file": (filename, data, content_type)})
    assert response.status_code == 422
    assert response.json()["detail"]["error_code"] == "VALIDATION_FAILED"


def test_upload_byte_limit_returns_413(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "upload_max_bytes", 100)
    response = client.post("/api/uploads", files={"file": ("photo.jpg", make_jpeg(), "image/jpeg")})
    assert response.status_code == 413


def test_dimension_limit_is_checked_before_pixel_decode(monkeypatch):
    data = make_jpeg()
    monkeypatch.setattr(get_settings(), "upload_max_dimension", 300)
    def forbidden_load(_image, *args, **kwargs):
        pytest.fail("Oversized image must be rejected before allocating pixel buffers")
    monkeypatch.setattr(Image.Image, "load", forbidden_load)
    with pytest.raises(ImageValidationError, match="too large"):
        validate_image_bytes(data, content_type="image/jpeg")


def test_decompression_bomb_is_a_validation_failure(client, monkeypatch):
    data = make_png()
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)
    response = client.post("/api/uploads", files={"file": ("photo.png", data, "image/png")})
    assert response.status_code == 422


def test_validation_errors_never_echo_passwords_or_tokens(client):
    for url, payload, secret in [
        ("/api/account/login", {"email": "a@example.com", "password": "secret"}, "secret"),
        ("/api/admin/login", {"token": "private-token-" * 50}, "private-token-"),
        ("/api/account/google", {"id_token": "private-id-token"}, "private-id-token"),
    ]:
        response = client.post(url, json=payload)
        assert response.status_code == 422
        assert secret not in response.text


def test_unhandled_error_is_generic_and_not_cached():
    app = create_app()
    @app.get("/api/security-test-error")
    def broken():
        raise RuntimeError("private-db-password /srv/private/path")
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/security-test-error")
    assert response.status_code == 500
    assert response.json()["error_code"] == "INTERNAL_ERROR"
    assert "private" not in response.text
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_private_preview_and_errors_have_security_headers(client, uploaded_photo):
    for url in (uploaded_photo["preview_url"], "/api/uploads/missing/preview"):
        response = client.get(url)
        assert response.headers["Cache-Control"] == "no-store"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]


@pytest.mark.parametrize("failure,error_code", [
    (AIProviderError("private-provider-api-key", detail="private upstream body"), "AI_PROVIDER_ERROR"),
    (RuntimeError("private internal traceback"), "INTERNAL_ERROR"),
])
def test_worker_does_not_publish_provider_response_or_internal_traceback(client, uploaded_photo, captured_queue, db_session, monkeypatch, failure, error_code):
    import app.services.generation as generation
    class FailingProvider:
        def is_available(self):
            return True

        def generate(self, *_args, **_kwargs):
            raise failure
    monkeypatch.setattr(generation, "get_provider", lambda: FailingProvider())
    response = client.post("/api/generations", json={"upload_id": uploaded_photo["upload_id"], "mode": "ADVANCED", "experience_id": "mini-me"})
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    assert process_job(job_id, db=db_session) == JobState.FAILED
    response = client.get(f"/api/generations/{job_id}")
    assert response.json()["error_code"] == error_code
    assert "private" not in response.text


def test_malformed_cookie_signature_is_rejected_without_server_error():
    assert unsign_value("guest." + "é" * 64) is None
    assert unsign_value(sign_value("guest") + "tampered") is None


def test_missing_photo_response_does_not_leak_storage_path(client, uploaded_photo, db_session):
    photo = db_session.get(Upload, uploaded_photo["upload_id"])
    photo.storage_path = "/srv/private-does-not-exist/photo.jpg"
    db_session.commit()
    response = client.get(uploaded_photo["preview_url"])
    assert response.status_code == 404
    assert "private-does-not-exist" not in response.text


def test_google_identity_requires_authenticated_account_link(client, db_session, monkeypatch):
    import app.routers.account as account
    email = f"link-{uuid4().hex}@example.com"
    assert client.post("/api/account/signup", json={"email": email, "password": "correct horse battery"}).status_code == 201
    subject = uuid4().hex
    monkeypatch.setattr(account, "verify_google_id_token", lambda _: GoogleClaims(subject, email))
    with TestClient(client.app) as victim:
        response = victim.post("/api/account/google", json={"id_token": "x" * 24})
        assert response.status_code == 409
        assert response.json()["detail"]["error_code"] == "ACCOUNT_LINK_REQUIRED"
        assert db_session.query(AuthIdentity).filter(AuthIdentity.provider_subject == subject).count() == 0
    assert client.post("/api/account/google", json={"id_token": "x" * 24}).status_code == 200
    client.post("/api/account/logout")
    assert client.post("/api/account/google", json={"id_token": "x" * 24}).status_code == 200


@pytest.mark.parametrize("overrides", [
    {"session_secret_key": ""}, {"session_secret_key": "replace-with-a-long-random-secret"},
    {"session_secret_key": " replace-with-a-long-random-secret "},
    {"admin_token": "change-me-in-production"}, {"cors_origins": ("*",)},
])
def test_production_rejects_unsafe_configuration(overrides):
    values = {"environment": "production", "session_secret_key": "s" * 64, "admin_token": "a" * 64, "cors_origins": ("https://photobooth.example",)}
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{**values, **overrides})


def test_production_disables_public_api_docs(monkeypatch):
    monkeypatch.setattr(get_settings(), "environment", "production")
    app = create_app()
    assert app.openapi_url is None and app.docs_url is None and app.redoc_url is None
