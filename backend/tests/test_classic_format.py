"""Frozen 1:3 Classic master, 2x6-inch print export and original migration."""
import io
import json
from pathlib import Path

import pytest
from PIL import Image

from app.catalog import seed_catalog
from app.models import ClassicLayout, ResultClaim
from app.services.classic import validated_frame
from app.services.classic_events import original_frame_definitions, event_frame_definitions
from app.services.classic_format import MASTER_SIZE, PRINT_SIZE, MASTER_DPI, PRINT_DPI, PROFILE, PROFILE_ID, classic_print_bytes
from conftest import make_png

ROOT = Path(__file__).resolve().parents[2]
DEFINITIONS = original_frame_definitions() + event_frame_definitions()


def test_frozen_classic_format_is_2x6_not_4r():
    assert PROFILE['frozen'] is True
    assert MASTER_SIZE == (1200, 3600)
    assert PRINT_SIZE == (600, 1800)
    assert PROFILE['print_inches'] == {'width': 2, 'height': 6}
    assert PRINT_DPI == 300 and MASTER_DPI == 600


@pytest.mark.parametrize('item', DEFINITIONS, ids=lambda item: item['id'])
def test_all_35_templates_have_master_and_print_renditions(item):
    base = ROOT / 'templates' / '_classic'
    if 'theme_slug' in item:
        base /= 'events'
    master = base / item['filename']
    with Image.open(master) as image:
        assert image.size == MASTER_SIZE
        assert image.width * 3 == image.height
        assert abs(image.info['dpi'][0] - MASTER_DPI) < .1
    with Image.open(master.parent / 'print' / master.name) as image:
        assert image.size == PRINT_SIZE
        assert abs(image.info['dpi'][0] - PRINT_DPI) < .1
        assert image.width / image.info['dpi'][0] == pytest.approx(2, abs=.001)
        assert image.height / image.info['dpi'][1] == pytest.approx(6, abs=.001)
    assert item['print_profile'] == PROFILE_ID


def test_print_export_preserves_ratio_and_has_300_dpi():
    data = classic_print_bytes(make_png(1200, 3600, color=(21, 81, 141)))
    with Image.open(io.BytesIO(data)) as image:
        assert image.size == PRINT_SIZE
        assert image.getpixel((300, 900)) == (21, 81, 141, 255)
        assert image.info['dpi'][0] == pytest.approx(300, abs=.1)
    with pytest.raises(ValueError):
        classic_print_bytes(make_png(1024, 1536))


def test_original_seeding_upgrades_format_preserving_publication_and_old_files(db_session):
    for item in original_frame_definitions():
        row = db_session.get(ClassicLayout, item['id'])
        assert (row.canvas_width, row.canvas_height) == MASTER_SIZE
        with validated_frame(row) as frame:
            assert frame.size == MASTER_SIZE
    first = db_session.get(ClassicLayout, 'classic-frame-001')
    old_json, old_active, old_name = first.layout_config_json, first.active, first.name
    try:
        config = json.loads(first.layout_config_json)
        config.pop('collection_version')
        first.layout_config_json = json.dumps(config)
        first.canvas_width, first.canvas_height = 724, 2172
        first.active = False
        first.name = 'Operator name'
        db_session.commit()
        seed_catalog(db_session)
        assert (first.canvas_width, first.canvas_height) == MASTER_SIZE
        assert first.active is False and first.name == 'Operator name'
        assert json.loads(first.layout_config_json)['collection_version'] == 2
        seed_catalog(db_session)
        assert first.active is False
        assert Image.open(ROOT / 'templates/_classic/classic-frame1.png').size == (724, 2172)
    finally:
        first.active, first.name, first.layout_config_json = old_active, old_name, old_json
        first.canvas_width, first.canvas_height = MASTER_SIZE
        db_session.commit()


def test_admin_cannot_publish_wrong_classic_canvas(client):
    headers = {'X-Admin-Token': 'test-admin-token'}
    response = client.patch('/api/admin/classic-layouts/classic-frame-001', headers=headers, json={'canvas_width': 1024, 'canvas_height': 1536})
    assert response.status_code == 422
    assert 'frozen' in response.json()['detail']


def test_other_modes_do_not_advertise_or_accept_classic_print(client, uploaded_photo, db_session):
    from test_result_claims import _completed_result
    result_id, _ = _completed_result(db_session, uploaded_photo)
    metadata = client.get('/api/results/' + result_id).json()
    assert metadata['print_download_url'] is None
    assert client.get(metadata['download_url'] + '?rendition=print').status_code == 422
    claim = client.post('/api/results/' + result_id + '/claim', json={}).json()
    token = claim['claim_url'].rsplit('/', 1)[-1]
    try:
        public = client.get('/api/public/results/' + token).json()
        assert public['print_download_url'] is None
        assert client.get(public['download_url'] + '?rendition=print').status_code == 422
        assert client.get('/api/public/results/invalid-claim/download?rendition=print').status_code == 404
    finally:
        db_session.query(ResultClaim).filter_by(result_id=result_id).delete(synchronize_session=False)
        db_session.commit()
