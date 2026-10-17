"""Stage/deploy the old customer viewport UI over the inherited live web image.

Only photobooth-web changes; v2, nginx and old hashed assets are preserved.
Owner approval is required for deploy. All compose definitions are persistent.
"""
import argparse
import datetime
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request

REPO = Path('/opt/photobooth')
RELEASES = Path('/srv/photobooth/releases')
POINTER = RELEASES / '.customer-viewport-current'
WEB = 'photobooth-web'
PATCH_FILES = ['src/main.jsx', *['src/components/customer/' + name + '.jsx' for name in
    ['ClassicCaptureStage', 'ModePickerModal', 'AdvancedOptionsStage', 'PhotoStage', 'ReviewStage', 'ResultStage']]]
NEW_FILES = ['src/customerViewport.css', 'scripts/customer-viewport-check.mjs']


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]


def containers():
    return {row['Names']: row['ID'] for row in map(json.loads,
        subprocess.check_output(['docker', 'ps', '--format', '{{json .}}']).decode().splitlines())}


def live_hash(path, image=None):
    command = (['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'cat', image]
        if image else ['docker', 'exec', WEB, 'cat'])
    return hashlib.sha256(subprocess.check_output(command + [path])).hexdigest()


def preserved_hash(image=None):
    # Hash filenames + content hashes, without printing any configuration values.
    command = (['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'sh', image]
        if image else ['docker', 'exec', WEB, 'sh'])
    listing = subprocess.check_output(command + ['-c',
        'find /usr/share/nginx/html/v2 /etc/nginx -type f -exec sha256sum {} \\; | sort'])
    return hashlib.sha256(listing).hexdigest()


def compose(manifest, rollback=False):
    return ['docker', 'compose', '--project-name', 'photobooth', '--project-directory', str(REPO),
        '-f', manifest['base'], '-f', manifest['rollback'] if rollback else manifest['override']]


def prepare():
    web = inspect(WEB)
    assert web['State'].get('Health', {}).get('Status') == 'healthy', 'Live web is unhealthy'
    old_hash = live_hash('/usr/share/nginx/html/index.html')
    candidates = sorted(RELEASES.glob('*/frontend/dist/index.html'), reverse=True)
    source = next((p.parent.parent for p in candidates if hashlib.sha256(p.read_bytes()).hexdigest() == old_hash), None)
    assert source, 'No source snapshot matches live old HTML'
    image_config = json.loads(subprocess.check_output(['docker', 'image', 'inspect', web['Image']]))[0]['Config']
    for key in ['Env', 'Cmd', 'Entrypoint']:
        assert web['Config'][key] == image_config[key], 'Unexpected web override: ' + key
    assert not web['Mounts']
    assert list(web['NetworkSettings']['Networks']) == ['photobooth-net']
    assert web['HostConfig']['PortBindings'] == {'80/tcp': [{'HostIp': '', 'HostPort': '3000'}]}
    assert web['HostConfig']['RestartPolicy']['Name'] == 'unless-stopped'

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = RELEASES / ('customer-viewport-' + stamp)
    release.mkdir()
    target = release / 'frontend'
    shutil.copytree(source, target, ignore=shutil.ignore_patterns('node_modules', 'dist', '.env*', '.vite'))
    prior_manifest = json.loads((source.parent / 'manifest.json').read_text())
    incremental = 'src/customerViewport.css' in prior_manifest.get('changed_files', [])
    with (release / 'patch.log').open('w') as output:
        for name in PATCH_FILES:
            dest = target / name
            base = dest.read_text() if incremental else subprocess.check_output(['git', '-C', str(REPO), 'show', 'HEAD:frontend/' + name]).decode()
            diff = ''.join(difflib.unified_diff(base.splitlines(True), (REPO / 'frontend' / name).read_text().splitlines(True), fromfile=str(dest), tofile=str(dest)))
            assert diff or incremental, 'Expected task change missing: ' + name
            if diff:
                run(['patch', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', str(dest)], input=diff, text=True, stdout=output, stderr=subprocess.STDOUT)
        for name in NEW_FILES:
            dest = target / name
            assert not dest.exists() or incremental, 'Task file already present in live snapshot: ' + name
            shutil.copy2(REPO / 'frontend' / name, dest)
    (target / 'node_modules').symlink_to(REPO / 'frontend/node_modules')
    fixtures = release / 'backend/app/data'
    fixtures.mkdir(parents=True)
    for name in ['classic_event_frames.json', 'classic_original_strip_frames.json', 'classic_print_profile.json']:
        shutil.copy2(REPO / 'backend/app/data' / name, fixtures / name)
    (release / 'templates').symlink_to(REPO / 'templates')
    assets = subprocess.check_output(['docker', 'exec', WEB, 'sh', '-c', 'cat /usr/share/nginx/html/assets/*.js']).decode()
    client_ids = set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', assets))
    assert len(client_ids) == 1, 'Could not preserve public Google configuration'
    api_config = dict(value.split('=', 1) for value in inspect('photobooth-express')['Config']['Env'] if '=' in value)
    env = {**os.environ, 'VITE_GOOGLE_CLIENT_ID': next(iter(client_ids)),
        'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN': api_config.get('POSTHOG_PROJECT_TOKEN', ''),
        'VITE_PUBLIC_POSTHOG_HOST': api_config.get('POSTHOG_HOST', ''),
        'NXBOOTH_PLAYWRIGHT_MODULE': str(REPO / 'frontend-enhanced/node_modules/playwright/index.mjs')}
    shutil.copy2(REPO / 'frontend/scripts/customer-viewport-live-check.mjs', target / 'scripts/customer-viewport-live-check.mjs')
    for command, name in [(['npm', 'test'], 'tests'), (['npm', 'run', 'build'], 'build'),
                          (['node', 'scripts/customer-viewport-check.mjs'], 'browser')]:
        with (release / (name + '.log')).open('w') as output:
            run(command, cwd=target, env=env, stdout=output, stderr=subprocess.STDOUT)
    with (release / 'real-catalog-browser.log').open('w') as output:
        run(['node', 'scripts/customer-viewport-live-check.mjs'], cwd=target,
            env={**env, 'NXBOOTH_LIVE_DIST': str(target / 'dist')}, stdout=output, stderr=subprocess.STDOUT)
    context = release / 'web-image'
    context.mkdir()
    shutil.copytree(target / 'dist', context / 'dist', ignore=shutil.ignore_patterns('*.map'))
    (context / 'Dockerfile').write_text('FROM ' + web['Config']['Image'] + '\nCOPY dist/ /usr/share/nginx/html/\n')
    image = 'photobooth-web:customer-viewport-' + stamp
    base = release / 'compose.web-base.json'
    hc = web['Config']['Healthcheck']
    health = {'test': hc['Test'], 'retries': hc['Retries']}
    for key in ['Interval', 'Timeout', 'StartPeriod', 'StartInterval']:
        if key in hc:
            health[{'Interval': 'interval', 'Timeout': 'timeout', 'StartPeriod': 'start_period', 'StartInterval': 'start_interval'}[key]] = str(hc[key]) + 'ns'
    base.write_text(json.dumps({'services': {WEB: {'image': web['Config']['Image'], 'container_name': WEB,
        'restart': 'unless-stopped', 'ports': ['3000:80'], 'networks': ['photobooth'], 'healthcheck': health}},
        'networks': {'photobooth': {'external': True, 'name': 'photobooth-net'}}}, indent=2))
    override = release / 'compose.customer-viewport.yml'
    rollback = release / 'compose.rollback.yml'
    override.write_text('services:\n  photobooth-web:\n    image: ' + image + '\n')
    rollback.write_text('services:\n  photobooth-web:\n    image: ' + web['Config']['Image'] + '\n')
    manifest = {'release': str(release), 'image': image, 'previous_image': web['Config']['Image'], 'previous_id': web['Image'],
        'source_snapshot': str(source), 'base': str(base), 'override': str(override), 'rollback': str(rollback),
        'before': containers(), 'preserved_sha256': preserved_hash(), 'old_index_sha256': old_hash,
        'new_index_sha256': hashlib.sha256((target / 'dist/index.html').read_bytes()).hexdigest(),
        'changed_files': PATCH_FILES + NEW_FILES, 'source_sha256': {name: hashlib.sha256((target / name).read_bytes()).hexdigest() for name in PATCH_FILES + NEW_FILES}, 'deployed': False}
    (release / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    run(compose(manifest) + ['config', '--quiet'])
    with (release / 'docker-build.log').open('w') as output:
        run(['docker', 'build', '-t', image, str(context)], stdout=output, stderr=subprocess.STDOUT)
    run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'nginx', image, '-t'])
    assert preserved_hash(image) == manifest['preserved_sha256'], 'v2 or nginx changed'
    assert live_hash('/usr/share/nginx/html/index.html', image) == manifest['new_index_sha256']
    POINTER.write_text(str(release))
    print(json.dumps({'status': 'PASS', 'release': str(release), 'image': image, 'v2_nginx_preserved': True, 'deployed': False}))


def verify(manifest, rollback=False):
    for _ in range(45):
        web = inspect(WEB)
        if web['State']['Status'] == 'running' and web['State'].get('Health', {}).get('Status') == 'healthy':
            break
        time.sleep(1)
    else:
        raise RuntimeError('Web did not become healthy')
    assert web['RestartCount'] == 0, 'Web restarted unexpectedly'
    assert preserved_hash() == manifest['preserved_sha256'], 'v2 or nginx changed'
    expected = manifest['old_index_sha256'] if rollback else manifest['new_index_sha256']
    assert live_hash('/usr/share/nginx/html/index.html') == expected
    for path in ['/', '/create', '/api/health', '/api/classic/layouts', '/v2/', '/v2/admin/login', '/v2/kiosk/kiosk']:
        with urllib.request.urlopen('http://127.0.0.1:3000' + path, timeout=20) as response:
            assert response.status == 200
            if path in ['/', '/create']:
                assert hashlib.sha256(response.read()).hexdigest() == expected
    now = containers()
    changed = [name for name, ident in manifest['before'].items() if now.get(name) != ident]
    assert set(changed) <= {WEB}, 'Other containers changed: ' + str(changed)
    print(json.dumps({'status': 'PASS', 'changed_containers': changed, 'v2_nginx_preserved': True, 'restart_count': 0}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'deploy', 'rollback', 'status'])
    action = parser.parse_args().action
    if action == 'prepare':
        prepare()
        return
    release = Path(POINTER.read_text().strip())
    manifest = json.loads((release / 'manifest.json').read_text())
    command = compose(manifest, action == 'rollback')
    run(command + ['config', '--quiet'])
    if action == 'deploy':
        assert inspect(WEB)['Image'] == manifest['previous_id'], 'Live web changed since prepare'
    if action in ['deploy', 'rollback']:
        run(command + ['up', '-d', '--no-deps', '--no-build', WEB])
        verify(manifest, action == 'rollback')
        manifest['deployed'] = action == 'deploy'
        manifest['last_action_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (release / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    run(command + ['ps', WEB])


if __name__ == '__main__':
    main()
