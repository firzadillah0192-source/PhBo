from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from app.generation.basic.engine import BasicResult
from app.experiences import list_experiences
from app.models import GenerationJob, JobState, ManagedTemplate
from app.services.generation import process_job
from conftest import make_png

ADMIN_HEADERS = {'X-Admin-Token': 'test-admin-token'}


def test_admin_requires_token_and_public_experience_hides_prompt(client):
    missing = client.get('/api/admin/experiences')
    wrong = client.get('/api/admin/experiences', headers={'X-Admin-Token': 'wrong'})
    valid = client.get('/api/admin/experiences', headers=ADMIN_HEADERS)
    assert missing.status_code == 401
    assert wrong.status_code == 401
    assert valid.status_code == 200
    assert valid.json()
    public_item = next(item for item in client.get('/api/experiences').json()['experiences'] if item['id'] == 'mini-me')
    assert 'internal_prompt' not in public_item
    assert 'provider' not in public_item
    assert 'model' not in public_item


def test_admin_experience_crud_prompt_and_disable(client):
    experience_id = 'test-admin-experience-' + uuid4().hex[:8]
    created = client.post('/api/admin/experiences', headers=ADMIN_HEADERS, json={
        'id': experience_id,
        'name': 'Admin Experience',
        'description': 'Managed description',
        'internal_prompt': 'initial private prompt',
        'enabled': True,
        'sort_order': 77,
    })
    assert created.status_code == 201, created.text
    assert created.json()['internal_prompt'] == 'initial private prompt'
    assert created.json()['status'] == 'draft'
    assert created.json()['preview_missing'] is True

    patched = client.patch('/api/admin/experiences/' + experience_id, headers=ADMIN_HEADERS, json={
        'internal_prompt': 'latest private prompt',
        'enabled': False,
        'name': 'Updated Experience',
    })
    assert patched.status_code == 200
    assert patched.json()['internal_prompt'] == 'latest private prompt'
    assert patched.json()['enabled'] is False
    assert patched.json()['updated_by'] == 'admin'
    deleted = client.delete('/api/admin/experiences/' + experience_id, headers=ADMIN_HEADERS)
    assert deleted.status_code == 204


def test_experience_publication_lifecycle_and_safe_customer_contract(client):
    suffix = uuid4().hex[:8]
    rows = {}
    for status in ('draft', 'published', 'disabled'):
        experience_id = f'test-{status}-{suffix}'
        response = client.post('/api/admin/experiences', headers=ADMIN_HEADERS, json={
            'id': experience_id,
            'name': f'{status.title()} Experience',
            'description': 'Publicly safe description',
            'internal_prompt': 'private prompt must stay private',
            'status': status,
            'category': 'Portrait',
        })
        assert response.status_code == 201, response.text
        rows[status] = response.json()

    public = client.get('/api/experiences')
    assert public.status_code == 200
    public_items = public.json()['experiences']
    public_ids = {item['id'] for item in public_items}
    assert rows['published']['id'] in public_ids
    assert rows['draft']['id'] not in public_ids
    assert rows['disabled']['id'] not in public_ids
    assert public.json()['count'] == len(public_items)
    assert all({'internal_prompt', 'provider', 'model', 'thumbnail_path'} .isdisjoint(item) for item in public_items)

    admin = client.get('/api/admin/experiences', headers=ADMIN_HEADERS)
    assert admin.status_code == 200
    admin_by_id = {item['id']: item for item in admin.json()}
    assert {admin_by_id[rows[state]['id']]['status'] for state in rows} == {'draft', 'published', 'disabled'}
    published_admin_ids = {item['id'] for item in admin.json() if item['status'] == 'published'}
    assert public_ids == published_admin_ids
    assert len(public_items) == len(published_admin_ids)

    overview = client.get('/api/admin/overview', headers=ADMIN_HEADERS)
    assert overview.status_code == 200
    overview_body = overview.json()
    assert overview_body['total_experiences'] == len(admin.json())
    assert overview_body['published_experiences'] >= 1
    assert overview_body['draft_experiences'] >= 1
    assert overview_body['disabled_experiences'] >= 1


def test_seeded_catalog_is_not_auto_published(client):
    admin = client.get('/api/admin/experiences', headers=ADMIN_HEADERS)
    assert admin.status_code == 200
    by_id = {item['id']: item for item in admin.json()}
    seeded_ids = {item.id for item in list_experiences()}
    assert len(seeded_ids) >= 44
    # mini-me is the only explicit approval in the test fixture for legacy
    # generation tests; all other seeded records remain draft.
    assert all(by_id[item_id]['status'] == ('published' if item_id == 'mini-me' else 'draft') for item_id in seeded_ids)


def test_admin_experience_thumbnail_rejects_invalid_without_overwriting(client):
    experience_id = 'test-admin-thumbnail-' + uuid4().hex[:8]
    created = client.post('/api/admin/experiences', headers=ADMIN_HEADERS, json={
        'id': experience_id,
        'name': 'Thumbnail Experience',
        'internal_prompt': 'prompt',
    })
    assert created.status_code == 201, created.text

    image = make_png(512, 512)
    uploaded = client.post(
        '/api/admin/experiences/' + experience_id + '/thumbnail',
        headers=ADMIN_HEADERS,
        files={'file': ('thumb.png', image, 'image/png')},
    )
    assert uploaded.status_code == 200, uploaded.text
    path = Path(uploaded.json()['thumbnail_path'])
    old_bytes = path.read_bytes()

    invalid = client.post(
        '/api/admin/experiences/' + experience_id + '/thumbnail',
        headers=ADMIN_HEADERS,
        files={'file': ('bad.png', b'not-an-image', 'image/png')},
    )
    assert invalid.status_code == 422
    assert path.read_bytes() == old_bytes


def test_admin_template_image_replacement_and_invalid_is_safe(client):
    template_id = 'test-admin-template-' + uuid4().hex[:8]
    created = client.post('/api/admin/templates', headers=ADMIN_HEADERS, json={
        'id': template_id,
        'name': 'Admin Template',
        'description': 'Basic managed asset',
    })
    assert created.status_code == 201, created.text

    image = make_png(512, 512)
    uploaded = client.post(
        '/api/admin/templates/' + template_id + '/image',
        headers=ADMIN_HEADERS,
        files={'file': ('base.png', image, 'image/png')},
    )
    assert uploaded.status_code == 200, uploaded.text
    path = Path(uploaded.json()['image_path'])
    old_bytes = path.read_bytes()
    assert path.name == 'base.png'

    invalid = client.post(
        '/api/admin/templates/' + template_id + '/image',
        headers=ADMIN_HEADERS,
        files={'file': ('base.png', b'not-an-image', 'image/png')},
    )
    assert invalid.status_code == 422
    assert path.read_bytes() == old_bytes


def test_admin_template_marketing_preview_is_separate_and_removable(client):
    template_id = 'test-admin-marketing-preview-' + uuid4().hex[:8]
    created = client.post('/api/admin/templates', headers=ADMIN_HEADERS, json={
        'id': template_id,
        'name': 'Marketing Preview Template',
    })
    assert created.status_code == 201, created.text
    assert created.json()['preview_missing'] is True

    preview = client.post(
        '/api/admin/templates/' + template_id + '/preview',
        headers=ADMIN_HEADERS,
        files={'file': ('preview.jpg', make_png(640, 800), 'image/png')},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body['preview_missing'] is False
    assert body['processing_asset_present'] is False
    assert body['marketing_preview_path'].endswith('/preview.png')
    preview_path = Path(body['marketing_preview_path'])
    previous_preview = preview_path.read_bytes()
    invalid = client.post(
        '/api/admin/templates/' + template_id + '/preview',
        headers=ADMIN_HEADERS,
        files={'file': ('preview.png', b'not-an-image', 'image/png')},
    )
    assert invalid.status_code == 422
    assert preview_path.read_bytes() == previous_preview

    public = client.get('/api/templates')
    item = next(row for row in public.json()['templates'] if row['id'] == template_id)
    assert item['preview_url'] == f'/api/templates/{template_id}/preview'
    assert client.get(item['preview_url']).status_code == 200

    removed = client.delete('/api/admin/templates/' + template_id + '/preview', headers=ADMIN_HEADERS)
    assert removed.status_code == 204
    public_after = client.get('/api/templates')
    item_after = next(row for row in public_after.json()['templates'] if row['id'] == template_id)
    assert item_after['preview_url'] is None
    assert client.get('/api/templates/' + template_id + '/preview').status_code == 404


def test_worker_uses_latest_database_prompt_for_new_job(
    client, uploaded_photo, captured_queue, stub_provider, db_session
):
    created = client.post('/api/generations', json={
        'upload_id': uploaded_photo['upload_id'],
        'mode': 'ADVANCED',
        'experience_id': 'mini-me',
    })
    assert created.status_code == 202, created.text
    job_id = created.json()['job_id']
    updated = client.patch('/api/admin/experiences/mini-me', headers=ADMIN_HEADERS, json={
        'internal_prompt': 'prompt edited in Admin MVP',
    })
    assert updated.status_code == 200
    assert process_job(job_id, db=db_session) == JobState.COMPLETED
    prompt = stub_provider.calls[-1]['prompt']
    assert prompt.startswith('EXPERIENCE — PRIMARY VISUAL AUTHORITY\nprompt edited in Admin MVP')
    assert 'FRAME STYLE' in prompt
    assert 'PRINT AND COMPOSITION' in prompt
    assert 'FRAME FOOTER BRANDING' in prompt
    assert '"NXBooth"' in prompt
    assert '"Powered by GenNexByte"' in prompt


def test_worker_uses_latest_template_image_and_missing_asset_fails(
    client, uploaded_photo, captured_queue, db_session, monkeypatch
):
    import app.services.generation as generation_module

    captured = []

    class FakeBasicEngine:
        def generate(self, **kwargs):
            captured.append(kwargs)
            output = kwargs['output_path']
            output.parent.mkdir(parents=True, exist_ok=True)
            data = make_png(128, 128)
            output.write_bytes(data)
            return BasicResult(data, str(output), 128, 128)

    monkeypatch.setattr(generation_module, 'get_basic_engine', lambda: FakeBasicEngine())
    replacement = make_png(512, 512, color=(200, 40, 40))
    replaced = client.post(
        '/api/admin/templates/sci-fi-space-commander-001/image',
        headers=ADMIN_HEADERS,
        files={'file': ('replacement.png', replacement, 'image/png')},
    )
    assert replaced.status_code == 200, replaced.text
    image_path = Path(replaced.json()['image_path'])
    assert image_path.read_bytes() == replacement

    created = client.post('/api/generations', json={
        'upload_id': uploaded_photo['upload_id'],
        'mode': 'BASIC',
        'template_id': 'sci-fi-space-commander-001',
    })
    assert created.status_code == 202, created.text
    assert process_job(created.json()['job_id'], db=db_session) == JobState.COMPLETED
    assert captured[-1]['options']['template_path'] == image_path
    assert Path(captured[-1]['options']['template_path']).read_bytes() == replacement

    missing_job = client.post('/api/generations', json={
        'upload_id': uploaded_photo['upload_id'],
        'mode': 'BASIC',
        'template_id': 'sci-fi-space-commander-001',
    }).json()
    image_path.unlink()
    assert process_job(missing_job['job_id'], db=db_session) == JobState.FAILED
    status = client.get('/api/generations/' + missing_job['job_id']).json()
    assert status['error_code'] == 'BASIC_TEMPLATE_METADATA_MISSING'
    assert 'asset missing' in status['error_message']
    image_path.write_bytes(replacement)
