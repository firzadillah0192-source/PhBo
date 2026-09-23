from pathlib import Path
from uuid import uuid4

from app.models import ManagedExperience, PreviewGenerationJob, PreviewJobState, PreviewSource, PreviewStatus
from app.services import preview_factory
from app.services.preview_factory import process_preview_job, save_source_asset
from conftest import StubProvider, make_jpeg, make_png

ADMIN_HEADERS = {"X-Admin-Token": "test-admin-token"}


def _create_experience(client, *, suffix=None, status="draft"):
    suffix = suffix or uuid4().hex[:8]
    experience_id = f"preview-test-{suffix}"
    response = client.post(
        "/api/admin/experiences",
        headers=ADMIN_HEADERS,
        json={
            "id": experience_id,
            "name": "Preview Factory Test",
            "description": "Internal test record",
            "internal_prompt": "A carefully lit test portrait",
            "status": status,
            "category": "Portrait",
        },
    )
    assert response.status_code == 201, response.text
    return experience_id


def _install_source(db_session):
    return save_source_asset(
        db_session,
        "portrait-default",
        make_jpeg(640, 640),
        "image/jpeg",
        "test-admin",
    )


def test_single_preview_is_internal_and_does_not_consume_customer_quota(
    client, db_session, monkeypatch
):
    experience_id = _create_experience(client)
    _install_source(db_session)
    enqueued = []
    monkeypatch.setattr(preview_factory, "enqueue_preview", lambda job_id: enqueued.append(job_id))
    provider = StubProvider()
    monkeypatch.setattr(preview_factory, "get_provider", lambda: provider)

    before = client.get("/api/account/usage").json()
    created = client.post(
        f"/api/admin/experiences/{experience_id}/preview", headers=ADMIN_HEADERS
    )
    assert created.status_code == 202, created.text
    job_id = created.json()["id"]
    assert created.json()["purpose"] == "admin_preview_generation"
    assert enqueued == [job_id]
    assert process_preview_job(job_id, db=db_session) == PreviewJobState.COMPLETED

    after = client.get("/api/account/usage").json()
    assert (after["ai_total"], after["ai_used"], after["ai_reserved"]) == (
        before["ai_total"], before["ai_used"], before["ai_reserved"]
    )
    row = db_session.get(ManagedExperience, experience_id)
    assert row.preview_status == PreviewStatus.READY
    assert Path(row.thumbnail_path).is_file()
    assert provider.calls[-1]["experience_id"] == experience_id

    public = client.get("/api/experiences").json()
    public_item = next(item for item in public["experiences"] if item["id"] == "mini-me")
    assert all(key not in public_item for key in ("internal_prompt", "provider", "model"))


def test_default_preview_uses_the_canonical_portrait_source(
    client, db_session, monkeypatch
):
    experience_id = _create_experience(client)
    _install_source(db_session)
    enqueued = []
    monkeypatch.setattr(preview_factory, "enqueue_preview", lambda job_id: enqueued.append(job_id))
    provider = StubProvider()
    monkeypatch.setattr(preview_factory, "get_provider", lambda: provider)

    created = client.post(
        f"/api/admin/experiences/{experience_id}/preview", headers=ADMIN_HEADERS
    )
    assert created.status_code == 202, created.text
    assert created.json()["source_id"] == preview_factory.DEFAULT_PREVIEW_SOURCE_ID
    assert enqueued == [created.json()["id"]]
    assert process_preview_job(created.json()["id"], db=db_session) == PreviewJobState.COMPLETED
    assert provider.calls[-1]["user_image_bytes"] > 0


def test_failed_preview_marks_only_that_job_failed_and_can_be_retried(
    client, db_session, monkeypatch
):
    first = _create_experience(client, suffix="failed")
    second = _create_experience(client, suffix="success")
    _install_source(db_session)
    monkeypatch.setattr(preview_factory, "enqueue_preview", lambda _job_id: None)

    class SelectiveProvider(StubProvider):
        def generate(self, user_image, template, options):
            if options.extra["experience"].id == first:
                raise RuntimeError("provider timeout")
            return super().generate(user_image, template, options)

    provider = SelectiveProvider()
    monkeypatch.setattr(preview_factory, "get_provider", lambda: provider)
    first_job = preview_factory.queue_preview_job(db_session, experience_id=first)
    second_job = preview_factory.queue_preview_job(db_session, experience_id=second)
    assert process_preview_job(first_job.id, db=db_session) == PreviewJobState.FAILED
    assert process_preview_job(second_job.id, db=db_session) == PreviewJobState.COMPLETED
    db_session.expire_all()
    assert db_session.get(ManagedExperience, first).preview_status == PreviewStatus.FAILED
    assert db_session.get(ManagedExperience, second).preview_status == PreviewStatus.READY


def test_bulk_confirmation_and_publish_ready_are_safe(client, db_session, monkeypatch):
    ready_id = _create_experience(client, suffix="ready")
    missing_id = _create_experience(client, suffix="missing")
    _install_source(db_session)
    ready_image = client.post(
        f"/api/admin/experiences/{ready_id}/thumbnail",
        headers=ADMIN_HEADERS,
        files={"file": ("preview.png", make_png(), "image/png")},
    )
    assert ready_image.status_code == 200
    monkeypatch.setattr(preview_factory, "enqueue_preview", lambda _job_id: None)

    not_confirmed = client.post(
        "/api/admin/preview-jobs/generate-missing",
        headers=ADMIN_HEADERS,
        json={"confirm": False},
    )
    assert not_confirmed.status_code == 400
    bulk = client.post(
        "/api/admin/preview-jobs/generate-missing",
        headers=ADMIN_HEADERS,
        json={"confirm": True},
    )
    assert bulk.status_code == 202, bulk.text
    assert bulk.json()["skipped_ready"] >= 1
    assert all(job["experience_id"] != ready_id for job in bulk.json()["jobs"])

    published = client.post(
        "/api/admin/experiences/publish-ready",
        headers=ADMIN_HEADERS,
        json={"confirm": True},
    )
    assert published.status_code == 200
    db_session.expire_all()
    assert db_session.get(ManagedExperience, ready_id).status == "published"
    assert db_session.get(ManagedExperience, missing_id).status == "draft"
    assert missing_id not in {item["id"] for item in client.get("/api/experiences").json()["experiences"]}


def test_preview_source_is_not_exposed_in_public_contract(client, db_session):
    _install_source(db_session)
    response = client.get("/api/admin/preview-sources", headers=ADMIN_HEADERS)
    assert response.status_code == 200
    source = next(item for item in response.json() if item["id"] == "portrait-default")
    assert source["has_asset"] is True
    assert "storage_path" not in source
    public = client.get("/api/experiences").json()
    assert all("internal_prompt" not in item and "provider" not in item and "model" not in item for item in public["experiences"])
