"""Static event frames, measured openings and provider-free shared delivery."""
import hashlib
import io
import json
import shutil
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image, ImageChops

from app.catalog import seed_catalog
from app.core.config import get_settings
from app.models import ClassicLayout, GenerationJob, JobState
from app.services.classic import ClassicLayoutError, compose_classic, validated_frame
from app.services.classic_events import event_frame_definitions, layout_theme
from app.services.generation import process_job
from app.models import ResultClaim
from conftest import make_jpeg, make_png

ROOT = Path(__file__).resolve().parents[2]
FRAMES = event_frame_definitions()


def layout(item):
    return SimpleNamespace(canvas_width=item['canvas_width'], canvas_height=item['canvas_height'], shot_count=item['shot_count'], layout_config_json=json.dumps({'slots': item['slots']}), frame_asset_path=str(ROOT / 'templates' / '_classic' / 'events' / item['filename']))


def test_event_collection_is_32_unique_frames_in_eight_themes():
    assert len(FRAMES) == len({row['id'] for row in FRAMES}) == 32
    assert set(Counter(row['theme_slug'] for row in FRAMES).values()) == {4}
    assert len({row['theme_slug'] for row in FRAMES}) == 8
    assert Counter(row['shot_count'] for row in FRAMES) == {3: 16, 4: 16}
    assert layout_theme('{}')['theme_slug'] == 'classic-originals'


@pytest.mark.parametrize('item', FRAMES, ids=lambda item: item['id'])
def test_event_asset_alpha_geometry_branding_and_composite(item):
    row = layout(item)
    assert hashlib.sha256(Path(row.frame_asset_path).read_bytes()).hexdigest() == item['sha256']
    with validated_frame(row) as frame:
        assert frame.size == (1200, 3600)
        assert frame.getchannel('A').getextrema() == (0, 255)
        alpha = frame.getchannel('A')
        area = sum(slot['width'] * slot['height'] for slot in item['slots'])
        assert .94 * area <= alpha.histogram()[0] <= area
        for slot in item['slots']:
            opening = alpha.crop((slot['x'], slot['y'], slot['x'] + slot['width'], slot['y'] + slot['height']))
            assert opening.histogram()[0] >= .94 * slot['width'] * slot['height']
        colors = [(220, 80, 80), (60, 150, 210), (80, 170, 110), (225, 180, 70)]
        output = compose_classic(row, [make_png(600, 400, color=colors[i]) for i in range(row.shot_count)])
        with Image.open(io.BytesIO(output)) as composite:
            assert composite.size == frame.size
            assert composite.getchannel('A').getextrema() == (255, 255)
            for index, slot in enumerate(item['slots']):
                assert composite.getpixel((slot['x'] + slot['width'] // 2, slot['y'] + slot['height'] // 2))[:3] == colors[index]
            # Every decorative/branding pixel remains exactly as the static asset.
            mask = alpha.point(lambda value: 255 if value == 255 else 0)
            difference = ImageChops.difference(composite.convert('RGB'), frame.convert('RGB'))
            assert ImageChops.multiply(difference, Image.merge('RGB', (mask, mask, mask))).getbbox() is None
        with pytest.raises(ClassicLayoutError):
            compose_classic(row, [make_png()] * (row.shot_count - 1))


@pytest.fixture
def seeded_event_frames(db_session, tmp_path):
    destination = get_settings().templates_dir / '_classic' / 'events'
    existing = {
        row.id: {column.name: getattr(row, column.name) for column in row.__table__.columns}
        for row in db_session.query(ClassicLayout).filter(
            ClassicLayout.id.in_([item['id'] for item in FRAMES])
        ).all()
    }
    backup = tmp_path / 'original-event-assets'
    if destination.exists():
        shutil.copytree(destination, backup)
    shutil.copytree(ROOT / 'templates' / '_classic' / 'events', destination, dirs_exist_ok=True)
    seed_catalog(db_session)
    try:
        yield
    finally:
        for item in FRAMES:
            row = db_session.get(ClassicLayout, item['id'])
            previous = existing.get(item['id'])
            if previous:
                if row is None:
                    row = ClassicLayout(**previous)
                    db_session.add(row)
                else:
                    for key, value in previous.items():
                        setattr(row, key, value)
            elif row is not None:
                db_session.delete(row)
        db_session.commit()
        shutil.rmtree(destination)
        if backup.exists():
            shutil.copytree(backup, destination)


def test_event_catalog_seed_idempotent_preview_and_admin_preserve_theme(client, db_session, seeded_event_frames):
    seed_catalog(db_session)
    listed = client.get('/api/classic/layouts').json()
    assert len(listed) == 35
    assert len({item['id'] for item in listed}) == 35
    first = next(item for item in listed if item['id'] == FRAMES[0]['id'])
    preview = client.get(first['preview_url'])
    assert preview.status_code == 200
    assert Image.open(io.BytesIO(preview.content)).size == (160, 480)
    headers = {'X-Admin-Token': 'test-admin-token'}
    updated = client.patch('/api/admin/classic-layouts/' + first['id'], headers=headers, json={'slots': first['slots']})
    assert updated.status_code == 200
    assert updated.json()['theme_slug'] == first['theme_slug']
    row = db_session.get(ClassicLayout, first['id'])
    row.active = False
    db_session.commit()
    seed_catalog(db_session)
    assert row.active is False
    assert client.get(first['preview_url']).status_code == 404


def test_event_classic_uses_shared_result_no_provider_no_ai_credits(client, db_session, seeded_event_frames, captured_queue, stub_provider):
    before = client.get('/api/account/usage').json()['ai_remaining']
    item = next(row for row in FRAMES if row['shot_count'] == 3)
    ids = [client.post('/api/uploads', files={'file': ('synthetic.jpg', make_jpeg(color=(100 + i * 30, 140, 100)), 'image/jpeg')}).json()['upload_id'] for i in range(3)]
    created = client.post('/api/generations', json={'mode': 'CLASSIC', 'layout_id': item['id'], 'upload_id': ids[0], 'capture_upload_ids': ids})
    assert created.status_code == 202, created.text
    job_id = created.json()['job_id']
    assert process_job(job_id, db=db_session) == JobState.COMPLETED
    job = db_session.get(GenerationJob, job_id)
    assert job.layout_id == item['id']
    result_id = client.get('/api/generations/' + job_id).json()['result_id']
    result = client.get('/api/results/' + result_id).json()
    assert (result['width'], result['height']) == (1200, 3600)
    assert client.get(result['download_url']).status_code == 200
    master = client.get(result['download_url'])
    with Image.open(io.BytesIO(master.content)) as image:
        assert image.size == (1200, 3600)
        assert image.info['dpi'][0] == pytest.approx(600, abs=.1)
    printed = client.get(result['print_download_url'])
    assert printed.status_code == 200
    assert 'no-store' in printed.headers['cache-control']
    with Image.open(io.BytesIO(printed.content)) as image:
        assert image.size == (600, 1800)
        assert image.info['dpi'][0] == pytest.approx(300, abs=.1)
    claim = client.post('/api/results/' + result_id + '/claim', json={})
    assert claim.status_code == 200
    token = claim.json()['claim_url'].rsplit('/', 1)[-1]
    public = client.get('/api/public/results/' + token).json()
    qr_print = client.get(public['print_download_url'])
    assert qr_print.status_code == 200
    assert qr_print.content == printed.content
    assert stub_provider.calls == []
    assert client.get('/api/account/usage').json()['ai_remaining'] == before
    # The legacy suite shares a database; remove only this test's claim.
    db_session.query(ResultClaim).filter_by(result_id=result_id).delete(synchronize_session=False)
    db_session.commit()
