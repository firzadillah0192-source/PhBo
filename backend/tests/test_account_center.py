from __future__ import annotations

from uuid import uuid4

from app.auth_models import SubscriptionPlan


def test_account_center_is_authenticated_and_server_authoritative(client, uploaded_photo, captured_queue):
    assert client.get('/api/account/center').status_code == 401
    email = f'center-{uuid4().hex[:10]}@example.com'
    signed_up = client.post('/api/account/signup', json={
        'email': email,
        'password': 'correct horse battery',
    })
    assert signed_up.status_code == 201

    queued = client.post('/api/generations', json={
        'upload_id': uploaded_photo['upload_id'],
        'mode': 'ADVANCED',
        'experience_id': 'mini-me',
    })
    assert queued.status_code == 202

    center = client.get('/api/account/center')
    assert center.status_code == 200, center.text
    payload = center.json()
    assert payload['account']['email'] == email
    assert payload['current_plan']['code'] == 'free'
    assert payload['usage']['ai_total'] == 5
    assert payload['usage']['ai_remaining'] == 4
    assert len(payload['creations']) == 1
    assert payload['creations'][0]['job_id'] == queued.json()['job_id']
    assert payload['sessions'][0]['is_current'] is True
    assert payload['sessions'][0]['id'] not in client.cookies.get('photobooth_session', '')
    assert payload['billing']['enabled'] is False
    assert payload['privacy']['deletion_available'] is False


def test_account_center_uses_plan_registry_and_profile_patch(client, db_session):
    plan_id = 'center-plan-' + uuid4().hex[:8]
    db_session.add(SubscriptionPlan(
        id=plan_id,
        code='go',
        name='Go',
        description='Regular use',
        monthly_ai_credits=40,
        is_active=True,
    ))
    db_session.commit()
    email = f'profile-{uuid4().hex[:10]}@example.com'
    assert client.post('/api/account/signup', json={
        'email': email,
        'password': 'correct horse battery',
    }).status_code == 201

    profile = client.patch('/api/account/profile', json={'display_name': '  Mahez  '})
    assert profile.status_code == 200
    assert profile.json()['display_name'] == 'Mahez'
    center = client.get('/api/account/center').json()
    go = next(item for item in center['plans'] if item['code'] == 'go')
    assert go['monthly_ai_credits'] == 40
    assert go['name'] == 'Go'
    assert 'price' not in go


def test_account_session_revoke_is_scoped_and_clears_current_session(client):
    email = f'session-{uuid4().hex[:10]}@example.com'
    assert client.post('/api/account/signup', json={
        'email': email,
        'password': 'correct horse battery',
    }).status_code == 201
    session_id = client.get('/api/account/center').json()['sessions'][0]['id']
    revoked = client.post(f'/api/account/sessions/{session_id}/revoke')
    assert revoked.status_code == 200
    assert revoked.json()['current'] is True
    assert client.get('/api/account/center').status_code == 401
