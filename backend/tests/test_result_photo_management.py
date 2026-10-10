import io
from pathlib import Path
from uuid import uuid4

import pytest
from PIL import Image

from app.auth_models import AdminAuditLog
from app.models import GenerationJob, GenerationProviderRun, JobState, Result, ResultClaim
from app.services.generation import process_job
from conftest import make_png

ADMIN = {"X-Admin-Token": "test-admin-token"}
PASSWORD = "correct horse battery"


@pytest.fixture
def owned_result(client, captured_queue, stub_provider, db_session):
    email = f"photos-{uuid4().hex[:12]}@example.com"
    assert client.post('/api/account/signup', json={"email": email, "password": PASSWORD}).status_code == 201
    upload = client.post('/api/uploads', files={"file": ("photo.png", make_png(640, 640), "image/png")}).json()
    created = client.post('/api/generations', json={"upload_id": upload['upload_id'], "mode": "ADVANCED", "experience_id": "mini-me"})
    assert created.status_code == 202, created.text
    job_id = created.json()['job_id']
    assert process_job(job_id, db=db_session) == JobState.COMPLETED
    job = db_session.get(GenerationJob, job_id)
    return email, job, job.result


def test_admin_can_view_result_preview_thumbnail_and_download(client, owned_result):
    _, job, result = owned_result
    base = f'/api/admin/usage/generations/{job.id}/result'
    assert client.get(base + '/image').status_code == 401
    image = client.get(base + '/image', headers=ADMIN)
    assert image.status_code == 200
    assert image.headers['cache-control'] == 'private, no-store'
    assert image.content == Path(result.storage_path).read_bytes()
    thumbnail = client.get(base + '/image?thumbnail=true', headers=ADMIN)
    with Image.open(io.BytesIO(thumbnail.content)) as output:
        assert output.width <= 300 and output.height <= 450
    download = client.get(base + '/download', headers=ADMIN)
    assert download.status_code == 200 and 'attachment' in download.headers['content-disposition']
    detail = client.get(f'/api/admin/usage/generations/{job.id}', headers=ADMIN).json()['generation']
    assert detail['result_id'] == result.id and detail['result_image_url'] == base + '/image'
    creation = next(item for item in client.get('/api/account/center').json()['creations'] if item['job_id'] == job.id)
    assert creation['result_id'] == result.id and creation['image_url']


def test_owner_deletion_enforces_ownership_confirmation_and_revokes_links(client, owned_result, db_session):
    email, job, result = owned_result
    path = Path(result.storage_path)
    claim = client.post(f'/api/results/{result.id}/claim').json()
    token = claim['claim_url'].rsplit('/', 1)[-1]
    usage_before = client.get('/api/account/usage').json()
    assert client.request('DELETE', f'/api/results/{result.id}', json={"confirm": False}).status_code == 422
    assert path.is_file()
    client.cookies.clear()
    assert client.post('/api/account/signup', json={"email": f"other-{uuid4().hex[:12]}@example.com", "password": PASSWORD}).status_code == 201
    assert client.get(f'/api/generations/{job.id}').status_code == 404
    for suffix in ['', '/image', '/download']:
        assert client.get(f'/api/results/{result.id}' + suffix).status_code == 404
    assert job.id not in {item['job_id'] for item in client.get('/api/account/center').json()['creations']}
    assert client.get(f'/api/admin/usage/generations/{job.id}/result/image').status_code == 401
    assert client.request('DELETE', f'/api/results/{result.id}', json={"confirm": True}).status_code == 404
    assert path.is_file()
    assert client.post('/api/account/login', json={"email": email, "password": PASSWORD}).status_code == 200
    deleted = client.request('DELETE', f'/api/results/{result.id}', json={"confirm": True})
    assert deleted.status_code == 200, deleted.text
    assert not path.exists()
    db_session.refresh(result)
    assert result.deleted_at is not None
    assert db_session.query(ResultClaim).filter_by(result_id=result.id).first().is_revoked
    for suffix in ['', '/image', '/download']:
        assert client.get(f'/api/results/{result.id}' + suffix).status_code == 404
    assert client.get(f'/api/public/results/{token}').status_code == 404
    assert client.post(f'/api/results/{result.id}/claim').status_code == 404
    assert client.request('DELETE', f'/api/results/{result.id}', json={"confirm": True}).status_code == 404
    assert job.id not in {item['job_id'] for item in client.get('/api/account/center').json()['creations']}
    assert client.get('/api/account/usage').json() == usage_before
    assert db_session.get(GenerationJob, job.id).state == JobState.COMPLETED
    assert db_session.query(GenerationProviderRun).filter_by(generation_job_id=job.id).count() == 1
    assert client.get(f'/api/generations/{job.id}').json()['result_id'] is None


def test_admin_deletion_keeps_usage_and_records_audit(client, owned_result, db_session):
    _, job, result = owned_result
    url = f'/api/admin/usage/generations/{job.id}/result'
    assert client.request('DELETE', url, json={"confirm": True}).status_code == 401
    assert client.request('DELETE', url, json={"confirm": False}, headers=ADMIN).status_code == 422
    assert client.request('DELETE', url, json={"confirm": True}, headers=ADMIN).status_code == 200
    assert not Path(result.storage_path).exists()
    assert client.get(url + '/image', headers=ADMIN).status_code == 404
    detail = client.get(f'/api/admin/usage/generations/{job.id}', headers=ADMIN).json()
    assert detail['generation']['result_deleted_at'] is not None
    assert detail['generation']['result_image_url'] is None
    assert detail['provider_runs']
    assert any(event['type'] == 'result_photo_deleted' for event in detail['events'])
    assert db_session.query(AdminAuditLog).filter_by(action='result_photo_deleted', target_id=result.id).count() == 1
    assert job.id not in {item['job_id'] for item in client.get('/api/account/center').json()['creations']}


def test_expired_result_can_be_removed_from_history(client, owned_result):
    _, _, result = owned_result
    Path(result.storage_path).unlink()
    assert client.request('DELETE', f'/api/results/{result.id}', json={"confirm": True}).status_code == 200


def test_deletion_refuses_paths_outside_result_storage(client, owned_result, db_session, tmp_path):
    _, job, result = owned_result
    unrelated = tmp_path / f'{result.id}.png'
    unrelated.write_bytes(b'keep me')
    result.storage_path = str(unrelated)
    db_session.commit()
    response = client.request('DELETE', f'/api/admin/usage/generations/{job.id}/result', json={"confirm": True}, headers=ADMIN)
    assert response.status_code == 500
    assert unrelated.read_bytes() == b'keep me'
    db_session.refresh(result)
    assert result.deleted_at is None


def test_legacy_job_without_owner_is_not_public(client, owned_result, db_session):
    _, job, result = owned_result
    job.account_id = None
    job.guest_id = None
    db_session.commit()
    assert client.get(f'/api/generations/{job.id}').status_code == 404
    assert client.get(f'/api/results/{result.id}/image').status_code == 404
    assert client.get(f'/api/admin/usage/generations/{job.id}/result/image', headers=ADMIN).status_code == 200
