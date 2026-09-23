from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.models import GenerationJob, JobState, Result, ResultClaim, Upload, new_id
from app.services import storage
from app.services.claims import token_hash
from conftest import make_png


def _completed_result(db, uploaded_photo):
    upload = db.get(Upload, uploaded_photo["upload_id"])
    assert upload is not None
    job = GenerationJob(
        id=new_id(),
        upload_id=upload.id,
        account_id=upload.account_id,
        guest_id=upload.guest_id,
        template_id="test-template",
        mode="BASIC",
        state=JobState.COMPLETED,
    )
    result_id = new_id()
    data = make_png(96, 96)
    path = storage.save_result(result_id=result_id, data=data, content_type="image/png")
    result = Result(
        id=result_id,
        job_id=job.id,
        template_id=job.template_id,
        storage_path=str(path),
        content_type="image/png",
        size_bytes=len(data),
        width=96,
        height=96,
        sha256=hashlib.sha256(data).hexdigest(),
        provider="local",
        model=None,
    )
    db.add(job)
    db.add(result)
    db.commit()
    return result_id, data


def _token(body):
    return body["claim_url"].rsplit("/", 1)[-1]


def test_claim_creation_is_opaque_hashed_and_idempotent(client, uploaded_photo, db_session):
    result_id, _ = _completed_result(db_session, uploaded_photo)

    first = client.post(f"/api/results/{result_id}/claim", json={})
    assert first.status_code == 200, first.text
    body = first.json()
    token = _token(body)
    assert len(token) >= 43
    assert body["qr_payload"] == body["claim_url"]
    assert body["claim_url"].startswith("http://testserver/r/")

    claim = db_session.query(ResultClaim).one()
    expires_at = claim.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    assert abs((expires_at - datetime.now(timezone.utc)).total_seconds() - 24 * 60 * 60) < 5
    assert claim.token_hash == token_hash(token)
    assert token not in claim.token_hash
    assert claim.created_by_session_id
    assert claim.created_by_kiosk_session_id is None
    assert "photobooth_kiosk_session" not in first.headers.get("set-cookie", "")

    duplicate = client.post(f"/api/results/{result_id}/claim", json={})
    assert duplicate.status_code == 409
    reused = client.post(f"/api/results/{result_id}/claim", json={"reuse_token": token})
    assert reused.status_code == 200
    assert _token(reused.json()) == token
    assert db_session.query(ResultClaim).count() == 1


def test_public_claim_image_download_and_isolation(client, uploaded_photo, db_session):
    result_id, data = _completed_result(db_session, uploaded_photo)
    created = client.post(f"/api/results/{result_id}/claim", json={}).json()
    token = _token(created)

    metadata = client.get(f"/api/public/results/{token}")
    assert metadata.status_code == 200
    public = metadata.json()
    assert public["image_url"] == f"/api/public/results/{token}/image"
    assert public["download_url"] == f"/api/public/results/{token}/download"
    assert "result_id" not in public
    assert client.get(public["image_url"]).content == data

    # The existing authenticated web download remains usable alongside QR delivery.
    ordinary_download = client.get(f"/api/results/{result_id}/download")
    assert ordinary_download.status_code == 200
    assert ordinary_download.content == data

    downloaded = client.get(public["download_url"])
    assert downloaded.status_code == 200
    assert downloaded.content == data
    assert db_session.query(ResultClaim).filter(ResultClaim.result_id == result_id).one().download_count == 1

    assert client.get("/api/public/results/too-short").status_code == 404
    assert client.get("/api/public/results/" + ("x" * 43)).status_code == 404

    other_client = TestClient(app)
    assert other_client.post(f"/api/results/{result_id}/claim", json={}).status_code == 404


def test_claim_expiry_and_revocation_block_public_access(client, uploaded_photo, db_session):
    result_id, _ = _completed_result(db_session, uploaded_photo)
    created = client.post(f"/api/results/{result_id}/claim", json={}).json()
    token = _token(created)
    claim = db_session.query(ResultClaim).filter(ResultClaim.result_id == result_id).one()
    claim.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()
    assert client.get(f"/api/public/results/{token}").status_code == 404
    assert client.post(f"/api/results/{result_id}/claim", json={}).status_code == 409
    assert client.post(f"/api/results/{result_id}/claim", json={"refresh": True}).status_code == 200

    result_id, _ = _completed_result(db_session, uploaded_photo)
    created = client.post(f"/api/results/{result_id}/claim", json={}).json()
    token = _token(created)
    claim = db_session.query(ResultClaim).filter(ResultClaim.result_id == result_id).one()
    claim.is_revoked = True
    claim.expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    db_session.commit()
    assert client.get(f"/api/public/results/{token}").status_code == 404
    assert client.post(f"/api/results/{result_id}/claim", json={}).status_code == 409
    assert client.post(f"/api/results/{result_id}/claim", json={"refresh": True}).status_code == 200


def test_kiosk_claim_records_ephemeral_kiosk_session(client, uploaded_photo, db_session):
    result_id, _ = _completed_result(db_session, uploaded_photo)
    created = client.post(f"/api/results/{result_id}/claim", json={"kiosk": True})
    assert created.status_code == 200, created.text
    assert "photobooth_kiosk_session" in created.headers.get("set-cookie", "")
    claim = db_session.query(ResultClaim).filter(ResultClaim.result_id == result_id).one()
    assert claim.created_by_kiosk_session_id
    assert len(claim.created_by_kiosk_session_id) == 64


def test_kiosk_new_run_rotates_ephemeral_session_cookie(client):
    started = client.post("/api/kiosk/session")
    assert started.status_code == 200
    original = client.cookies.get("photobooth_kiosk_session")
    assert original
    next_run = client.post("/api/kiosk/session?new_run=true")
    assert next_run.status_code == 200
    rotated = client.cookies.get("photobooth_kiosk_session")
    assert rotated and rotated != original
    assert next_run.json()["reset_after_seconds"] == 90
    assert next_run.json()["claim_ttl_hours"] == 24


def test_admin_can_observe_and_revoke_claim_without_receiving_raw_token(
    client, uploaded_photo, db_session
):
    result_id, _ = _completed_result(db_session, uploaded_photo)
    created = client.post(f"/api/results/{result_id}/claim", json={}).json()
    token = _token(created)
    claim = db_session.query(ResultClaim).filter(ResultClaim.result_id == result_id).one()
    job_id = claim.result.job_id
    headers = {"X-Admin-Token": "test-admin-token"}

    detail = client.get(f"/api/admin/usage/generations/{job_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert len(detail.json()["claims"]) == 1
    assert detail.json()["claims"][0]["download_count"] == 0
    assert token not in detail.text

    revoked = client.post(
        f"/api/admin/result-claims/{claim.id}/revoke",
        headers=headers,
        json={"confirm": True, "reason": "Customer requested link revocation"},
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["revoked"] is True
    assert client.get(f"/api/public/results/{token}").status_code == 404
    assert "claim_revoked" in {
        event["type"]
        for event in client.get(
            f"/api/admin/usage/generations/{job_id}", headers=headers
        ).json()["events"]
    }


def test_explicit_refresh_revokes_the_previous_claim(client, uploaded_photo, db_session):
    result_id, _ = _completed_result(db_session, uploaded_photo)
    first = client.post(f"/api/results/{result_id}/claim", json={}).json()
    first_token = _token(first)
    refreshed = client.post(f"/api/results/{result_id}/claim", json={"refresh": True})
    assert refreshed.status_code == 200
    second_token = _token(refreshed.json())
    assert second_token != first_token
    assert client.get(f"/api/public/results/{first_token}").status_code == 404
    assert client.get(f"/api/public/results/{second_token}").status_code == 200
