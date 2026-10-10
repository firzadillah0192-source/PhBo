"""Asset-only release; prepare is offline/read-only, deploy requires user approval.

The existing helper already supports adjacent photo slots. No image build,
container restart, schema change, or customer photo read is needed.
"""
import datetime
import hashlib
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path('/opt/photobooth')
POINTER = Path('/srv/photobooth/tmp/classic-single-window-release-path')


def catalog_action(release, action):
    subprocess.run(['docker', 'exec', '-i', '-e', 'CLASSIC_COLLECTION_RELEASE_DIR='+str(release),
        '-e', 'CLASSIC_COLLECTION_ACTION='+action, 'photobooth-express', 'node', '--input-type=module', '-'],
        input=(ROOT/'backend-express/scripts/revise-classic-single-window.mjs').read_text(), text=True, check=True)


def containers():
    return {row['Names']: row['ID'] for row in map(json.loads,
        subprocess.check_output(['docker', 'ps', '--format', '{{json .}}']).decode().splitlines())}


action = sys.argv[1]
if action == 'prepare':
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = Path('/srv/photobooth/releases') / ('classic-single-window-'+stamp)
    release.mkdir()
    shutil.copytree(ROOT/'backend/app/data/classic-single-window-v4', release/'assets')
    rows = json.loads((release/'assets/collection.json').read_text())
    assert rows['status'] == 'PASS' and len(rows['frames']) == 36
    for row in rows['frames']:
        directory = release/'assets'/row['id']
        for filename, expected in json.loads((directory/'checksums.json').read_text()).items():
            assert hashlib.sha256((directory/filename).read_bytes()).hexdigest() == expected
    (release/'manifest.json').write_text(json.dumps({'containers': containers(), 'asset_only': True}, indent=2))
    catalog_action(release, 'snapshot')
    POINTER.write_text(str(release))
    print(json.dumps({'status': 'PASS', 'release': str(release), 'deployed': False, 'frames': 36}))
elif action in ('deploy', 'rollback'):
    release = Path(POINTER.read_text().strip())
    manifest = json.loads((release/'manifest.json').read_text())
    assert containers() == manifest['containers'], 'Runtime changed since preparation; inspect and reprepare'
    catalog_action(release, 'publish' if action == 'deploy' else 'rollback')
    with urllib.request.urlopen('http://127.0.0.1:3000/api/health', timeout=20) as response:
        assert response.status == 200
    with urllib.request.urlopen('http://127.0.0.1:3000/api/classic/layouts', timeout=30) as response:
        rows = json.load(response)
    if action == 'deploy':
        for frame in json.loads((release/'assets/collection.json').read_text())['frames']:
            row = next(row for row in rows if row['id'] == frame['id'])
            assert row['shot_count'] == 3 and row['requires_event_name'] is True
            with urllib.request.urlopen('http://127.0.0.1:3000'+row['preview_url'], timeout=30) as response:
                actual = response.read()
            assert actual == (release/'assets'/row['id']/'preview.png').read_bytes(), frame['id']
    assert containers() == manifest['containers'], 'Asset-only release must not change containers'
    report = {'status': 'PASS', 'action': action, 'asset_only': True, 'frames': 36, 'containers_changed': False}
    (release/(action+'-verification.json')).write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
else:
    raise SystemExit('Use prepare / deploy (only after approval) / rollback')
