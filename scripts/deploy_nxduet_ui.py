"""Stage/deploy the NXDuet UI refinement (file picker, retro theme, /create entry block) over the live web image.

Only photobooth-web changes; API, worker, SQL, v2 and nginx are untouched.
Owner approval is required for deploy. Compose definitions live in /srv/photobooth/releases.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import re
import time
import urllib.request

REPO = Path('/opt/photobooth')
RELEASES = Path('/srv/photobooth/releases')
POINTER = RELEASES / '.nxduet-ui-current'
WEB = 'photobooth-web'
FILES = ['src/components/customer/NXDuet.jsx', 'src/components/customer/nxduet.css',
    'src/components/home/CreationChooser.jsx', 'src/components/home/landing.css']


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
    assert source, 'No source snapshot matches live HTML'
    image_config = json.loads(subprocess.check_output(['docker', 'image', 'inspect', web['Image']]))[0]['Config']
    for key in ['Env', 'Cmd', 'Entrypoint']:
        assert web['Config'][key] == image_config[key], 'Unexpected web override: ' + key
    assert not web['Mounts']
    assert list(web['NetworkSettings']['Networks']) == ['photobooth-net']
    assert web['HostConfig']['PortBindings'] == {'80/tcp': [{'HostIp': '', 'HostPort': '3000'}]}

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = RELEASES / ('nxduet-ui-' + stamp)
    release.mkdir()
    target = release / 'frontend'
    shutil.copytree(source, target, ignore=shutil.ignore_patterns('node_modules', 'dist', '.env*', '.vite'))
    for name in FILES:
        shutil.copy2(REPO / 'frontend' / name, target / name)
    (target / 'node_modules').symlink_to(REPO / 'frontend/node_modules')
    (release / 'templates').symlink_to(REPO / 'templates')
    fixtures = release / 'backend/app/data'
    fixtures.mkdir(parents=True)
    for item in (REPO / 'backend/app/data').glob('classic_*.json'):
        shutil.copy2(item, fixtures / item.name)
    assets = subprocess.check_output(['docker', 'exec', WEB, 'sh', '-c', 'cat /usr/share/nginx/html/assets/*.js']).decode()
    client_ids = set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', assets))
    assert len(client_ids) == 1, 'Could not preserve public Google configuration'
    api_config = dict(value.split('=', 1) for value in inspect('photobooth-express')['Config']['Env'] if '=' in value)
    env = {**os.environ, 'VITE_GOOGLE_CLIENT_ID': next(iter(client_ids)),
        'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN': api_config.get('POSTHOG_PROJECT_TOKEN', ''),
        'VITE_PUBLIC_POSTHOG_HOST': api_config.get('POSTHOG_HOST', ''),
        'NXBOOTH_PLAYWRIGHT_MODULE': str(REPO / 'frontend-enhanced/node_modules/playwright/index.mjs')}
    for command, name in [(['npm', 'test'], 'tests'), (['npm', 'run', 'build'], 'build')]:
        with (release / (name + '.log')).open('w') as output:
            run(command, cwd=target, env=env, stdout=output, stderr=subprocess.STDOUT)
    with (release / 'browser.log').open('w') as output:
        run(['node', str(REPO / 'frontend/scripts/nxduet-browser-check.mjs')],
            env={**env, 'NXDUET_TEST_DIST': str(target / 'dist')}, stdout=output, stderr=subprocess.STDOUT)
    context = release / 'web-image'
    context.mkdir()
    shutil.copytree(target / 'dist', context / 'dist', ignore=shutil.ignore_patterns('*.map'))
    (context / 'Dockerfile').write_text('FROM ' + web['Config']['Image'] + '\nCOPY dist/ /usr/share/nginx/html/\n')
    image = 'photobooth-web:nxduet-ui-' + stamp
    # The live web container runs the previous release image; layer on top of it so older hashed assets remain.
    previous = web['Config']['Image']
    base = release / 'compose.web-base.json'
    hc = web['Config']['Healthcheck']
    health = {'test': hc['Test'], 'retries': hc['Retries']}
    for key, name in [('Interval', 'interval'), ('Timeout', 'timeout'), ('StartPeriod', 'start_period'), ('StartInterval', 'start_interval')]:
        if key in hc:
            health[name] = str(hc[key]) + 'ns'
    base.write_text(json.dumps({'services': {WEB: {'image': previous, 'container_name': WEB,
        'restart': 'unless-stopped', 'ports': ['3000:80'], 'networks': ['photobooth'], 'healthcheck': health}},
        'networks': {'photobooth': {'external': True, 'name': 'photobooth-net'}}}, indent=2))
    override = release / 'compose.nxduet-ui.yml'
    rollback = release / 'compose.rollback.yml'
    override.write_text('services:\n  photobooth-web:\n    image: ' + image + '\n')
    rollback.write_text('services:\n  photobooth-web:\n    image: ' + previous + '\n')
    manifest = {'release': str(release), 'image': image, 'previous_image': previous, 'previous_id': web['Image'],
        'source_snapshot': str(source), 'base': str(base), 'override': str(override), 'rollback': str(rollback),
        'before': containers(), 'preserved_sha256': preserved_hash(), 'old_index_sha256': old_hash,
        'new_index_sha256': hashlib.sha256((target / 'dist/index.html').read_bytes()).hexdigest(),
        'changed_files': FILES, 'deployed': False}
    (release / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    run(compose(manifest) + ['config', '--quiet'])
    with (release / 'docker-build.log').open('w') as output:
        run(['docker', 'build', '-t', image, str(context)], stdout=output, stderr=subprocess.STDOUT)
    run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'nginx', image, '-t'])
    assert preserved_hash(image) == manifest['preserved_sha256'], 'v2 or nginx changed'
    assert live_hash('/usr/share/nginx/html/index.html', image) == manifest['new_index_sha256']
    POINTER.write_text(str(release))
    print(json.dumps({'status': 'PASS', 'release': str(release), 'image': image, 'deployed': False}))


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
    for path in ['/', '/create', '/nxduet', '/api/health', '/api/nxduet/capabilities', '/v2/']:
        with urllib.request.urlopen('http://127.0.0.1:3000' + path, timeout=20) as response:
            assert response.status == 200, path
    now = containers()
    changed = [name for name, ident in manifest['before'].items() if now.get(name) != ident]
    assert set(changed) <= {WEB}, 'Other containers changed: ' + str(changed)
    print(json.dumps({'status': 'PASS', 'changed_containers': changed, 'restart_count': 0}))


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
