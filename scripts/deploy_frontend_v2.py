"""Prepare an additive /v2 frontend release on the live web image. Deploy only on approval.

No API, worker, storage, database, ports or host proxy changes. The old web bundle
is inherited byte-for-byte. Compose and rollback definitions are persistent.
"""
import argparse
import datetime
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
POINTER = Path('/srv/photobooth/tmp/frontend-v2-release-path')
WEB = 'photobooth-web'


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]


def containers():
    return {row['Names']: row['ID'] for row in map(json.loads, subprocess.check_output(['docker', 'ps', '--format', '{{json .}}']).decode().splitlines())}


def old_index():
    return hashlib.sha256(subprocess.check_output(['docker', 'exec', WEB, 'cat', '/usr/share/nginx/html/index.html'])).hexdigest()


def patch_nginx(source):
    if 'location /v2/' in source or 'location ^~ /v2/' in source:
        raise RuntimeError('A v2 release is already present; inspect it before preparing another.')
    source = source.replace('    default                $request_uri;', '    ~^/v2/(r|claim)/       /v2/shared/[REDACTED];\n    default                $request_uri;')
    # Claim pages carry bearer credentials. Also redact them in asset/API referrers.
    referrer = '''map $http_referer $photobooth_v2_safe_referrer {
    ~*/v2/(r|claim)/ /v2/shared/[REDACTED];
    default $http_referer;
}

'''
    source = source.replace('log_format photobooth_safe', referrer + 'log_format photobooth_safe', 1)
    source = source.replace('"$http_referer"', '"$photobooth_v2_safe_referrer"')
    locations = '''    # V2 is additive: the original root bundle and all /api routes are preserved.
    location = /v2 { return 302 /v2/; }
    location = /v2/admin { return 302 /v2/admin/; }
    location = /v2/kiosk { return 302 /v2/kiosk/; }
'''
    for prefix in ['/v2', '/v2/admin', '/v2/kiosk']:
        locations += f'''    location ^~ {prefix}/assets/ {{
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
        try_files $uri =404;
    }}
    location ^~ {prefix}/ {{
        add_header Cache-Control "no-store, no-cache, must-revalidate";
        add_header Referrer-Policy "no-referrer" always;
        access_log off;
        try_files $uri $uri/ {prefix}/index.html;
    }}
'''
    marker = '    location / {\n'
    if source.count(marker) != 1:
        raise RuntimeError('Unexpected live nginx routing; review before patching.')
    return source.replace(marker, locations + '\n' + marker)


def ensure_nginx(source):
    """Refresh path: keep nginx as is when every v2 route is already live; patch it when none is."""
    routes = ['location ^~ /v2/assets/', 'location ^~ /v2/admin/assets/', 'location ^~ /v2/kiosk/assets/', 'try_files $uri $uri/ /v2/index.html;', 'try_files $uri $uri/ /v2/admin/index.html;', 'try_files $uri $uri/ /v2/kiosk/index.html;']
    present = [route in source for route in routes]
    if all(present):
        return source
    if any(present):
        raise RuntimeError('Live nginx has only part of the v2 routing; inspect it before preparing.')
    return patch_nginx(source)


def compose(manifest, rollback=False):
    helper = dict(value.split('=', 1) for value in inspect('photobooth-image-helper')['Config']['Env'] if '=' in value)
    if helper.get('AI_ENGINE_API_KEY'):
        os.environ.setdefault('EXPRESS_IMAGE_ENGINE_KEY', helper['AI_ENGINE_API_KEY'])
    args = ['docker', 'compose', '--project-directory', str(REPO), '--env-file', str(REPO / '.env')]
    for file in manifest['compose_files'] + [manifest['rollback'] if rollback else manifest['override']]:
        args += ['-f', file]
    return args


def prepare():
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = RELEASES / ('frontend-v2-' + stamp)
    release.mkdir()
    web = inspect(WEB)
    api = inspect('photobooth-express')
    if web['State'].get('Health', {}).get('Status') != 'healthy':
        raise RuntimeError('Live web must be healthy before preparing v2.')
    files = list(dict.fromkeys(api['Config']['Labels']['com.docker.compose.project.config_files'].split(',') + web['Config']['Labels']['com.docker.compose.project.config_files'].split(',')))
    source = release / 'frontend-enhanced'
    shutil.copytree(REPO / 'frontend-enhanced', source, ignore=shutil.ignore_patterns('node_modules', 'dist', '.vite', '.env*'))
    (source / 'node_modules').symlink_to(REPO / 'frontend-enhanced/node_modules')
    for app in ['customer', 'admin', 'kiosk']:
        if (REPO / 'frontend-enhanced' / app / 'node_modules').exists():
            (source / app / 'node_modules').symlink_to(REPO / 'frontend-enhanced' / app / 'node_modules')
    # The v2 clients reuse the existing JS contract and its idempotency/analytics modules.
    shutil.copytree(REPO / 'frontend/src', release / 'frontend/src')
    (release / 'frontend/node_modules').symlink_to(REPO / 'frontend/node_modules')
    assets = subprocess.check_output(['docker', 'exec', WEB, 'sh', '-c', 'cat /usr/share/nginx/html/assets/*.js']).decode()
    ids = set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', assets))
    if len(ids) != 1:
        raise RuntimeError('Cannot determine the configured public Google client ID.')
    config = dict(value.split('=', 1) for value in api['Config']['Env'] if '=' in value)
    env = {**os.environ, 'VITE_GOOGLE_CLIENT_ID': next(iter(ids)), 'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN': config.get('POSTHOG_PROJECT_TOKEN', ''), 'VITE_PUBLIC_POSTHOG_HOST': config.get('POSTHOG_HOST', '')}
    for name, args in [('typecheck', ['npm', 'run', 'typecheck']), ('unit-tests', ['npm', 'test']), ('build', ['npm', 'run', 'build']), ('browser-tests', ['node', 'scripts/browser-check.mjs'])]:
        with (release / (name + '.log')).open('w') as output:
            run(args, cwd=source, env=env, stdout=output, stderr=subprocess.STDOUT)
    context = release / 'web-image'
    context.mkdir()
    for app, target in [('customer', 'v2'), ('admin', 'v2/admin'), ('kiosk', 'v2/kiosk')]:
        shutil.copytree(source / app / 'dist', context / target, dirs_exist_ok=True)
    nginx = subprocess.check_output(['docker', 'exec', WEB, 'cat', '/etc/nginx/conf.d/photobooth.conf']).decode()
    (release / 'nginx.previous.conf').write_text(nginx)
    (context / 'photobooth.conf').write_text(ensure_nginx(nginx))
    image = 'photobooth-web:frontend-v2-' + stamp
    (context / 'Dockerfile').write_text('FROM ' + web['Config']['Image'] + '\nRUN rm -rf /usr/share/nginx/html/v2\nCOPY v2/ /usr/share/nginx/html/v2/\nCOPY photobooth.conf /etc/nginx/conf.d/photobooth.conf\n')
    override = release / 'compose.frontend-v2.yml'
    rollback = release / 'compose.rollback.yml'
    override.write_text('services:\n  photobooth-web:\n    image: ' + image + '\n')
    rollback.write_text('services:\n  photobooth-web:\n    image: ' + web['Config']['Image'] + '\n')
    manifest = {'release': str(release), 'previous_image': web['Config']['Image'], 'image': image, 'compose_files': files, 'override': str(override), 'rollback': str(rollback), 'before': containers(), 'old_index_sha256': old_index(), 'upstream_export': 'origin/frontend-enhance@68bcdaf', 'deployed': False}
    (release / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    run(compose(manifest) + ['config', '--quiet'])
    with (release / 'docker-build.log').open('w') as output:
        run(['docker', 'build', '-t', image, str(context)], stdout=output, stderr=subprocess.STDOUT)
    run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'nginx', image, '-t'])
    inherited = subprocess.check_output(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'sha256sum', image, '/usr/share/nginx/html/index.html']).decode().split()[0]
    if inherited != manifest['old_index_sha256']:
        raise RuntimeError('The old UI index changed unexpectedly.')
    POINTER.write_text(str(release))
    print(json.dumps({'status': 'PASS', 'release': str(release), 'image': image, 'old_ui_preserved': True, 'deployed': False}))


def verify(manifest, rollback=False):
    for _ in range(45):
        web = inspect(WEB)
        if web['State']['Status'] == 'running' and web['State'].get('Health', {}).get('Status') == 'healthy':
            break
        time.sleep(1)
    else:
        raise RuntimeError('Web release is not healthy; inspect logs and rollback.')
    assert web['RestartCount'] == 0, 'Restart-looping release'
    assert old_index() == manifest['old_index_sha256'], 'Old UI changed'
    for path in ['/', '/api/health'] + ([] if rollback else ['/v2/', '/v2/app/create/photo', '/v2/admin/login', '/v2/kiosk/kiosk']):
        with urllib.request.urlopen('http://127.0.0.1:3000' + path, timeout=15) as response:
            assert response.status == 200
    changed = [name for name, ident in manifest['before'].items() if containers().get(name) != ident]
    assert set(changed) <= {WEB}, changed
    run(['docker', 'logs', '--tail', '10', WEB])
    print(json.dumps({'status': 'PASS', 'changed_containers': changed, 'old_ui_preserved': True}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'deploy', 'rollback', 'status'])
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare()
        return
    release = Path(POINTER.read_text().strip())
    manifest = json.loads((release / 'manifest.json').read_text())
    command = compose(manifest, args.action == 'rollback')
    run(command + ['config', '--quiet'])
    if args.action == 'deploy':
        assert inspect(WEB)['Config']['Image'] == manifest['previous_image'], 'Live web changed since preparation; prepare again'
    if args.action in ['deploy', 'rollback']:
        run(command + ['up', '-d', '--no-deps', '--no-build', 'photobooth-web'])
        verify(manifest, args.action == 'rollback')
        manifest['deployed'] = args.action == 'deploy'
        (release / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    run(command + ['ps', 'photobooth-web'])


if __name__ == '__main__':
    main()
