"""Release only the Express-compatible admin UI over the active credit-flow source snapshot."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

REPO = Path('/opt/photobooth')

def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]

def compose_args(manifest, extra=True):
    # Compose validates all services even for a frontend-only update. Reuse the
    # running helper's injected key in memory; never print or persist it.
    if not os.environ.get('EXPRESS_IMAGE_ENGINE_KEY'):
        engine_env = dict(item.split('=', 1) for item in inspect('photobooth-image-helper')['Config']['Env'] if '=' in item)
        if engine_env.get('AI_ENGINE_API_KEY'):
            os.environ['EXPRESS_IMAGE_ENGINE_KEY'] = engine_env['AI_ENGINE_API_KEY']
    args = ['docker', 'compose', '--project-directory', str(REPO), '--env-file', str(REPO / '.env')]
    for file in manifest['compose_files'] + ([manifest['override']] if extra else []):
        args += ['-f', file]
    return args

action = sys.argv[1]
if action == 'prepare':
    web = inspect('photobooth-web')
    latest = inspect('photobooth-express')
    source = Path('/srv/photobooth/releases/admin-20261007T045538Z/frontend')
    assert web['Config']['Image'] == 'photobooth-web:admin-20261007T045538Z', 'Active source snapshot mismatch'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = Path('/srv/photobooth/releases') / ('admin-' + stamp)
    release.mkdir(parents=True, exist_ok=False)
    frontend = release / 'frontend'
    shutil.copytree(source, frontend, ignore=shutil.ignore_patterns('node_modules', 'dist', '.vite', '.env*'))
    files = ['src/adminPlanPayload.js', 'src/adminPlanPayload.test.js', 'src/AdminPage.jsx', 'src/api.js', 'src/main.jsx', 'src/admin-retro.css', 'src/adminReadCache.js', 'src/adminReadCache.test.js', 'src/pricingDisplay.js', 'src/pricingDisplay.test.js', 'src/adminPricing.test.js', 'src/adminResultPhoto.test.js', 'src/components/admin/AdminShell.jsx', 'src/components/admin/AdminResultPhoto.jsx', 'src/components/admin/result-photo.css', 'src/components/admin/BasicTemplatePanel.jsx', 'src/components/admin/ThreeModesPanel.jsx', 'scripts/admin-retro-browser-check.mjs']
    for name in files:
        dest = frontend / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / 'frontend' / name, dest)
    shutil.copytree(REPO / 'frontend/public/fonts', frontend / 'public/fonts', dirs_exist_ok=True)
    (frontend / 'node_modules').symlink_to(REPO / 'frontend/node_modules')
    # The existing Classic tests read the published frame registry outside frontend.
    # Include this test fixture in the release snapshot; it is not added to the image.
    data = release / 'backend/app/data'
    data.mkdir(parents=True)
    for fixture in ['classic_event_frames.json', 'classic_original_strip_frames.json', 'classic_print_profile.json']:
        shutil.copy2(REPO / 'backend/app/data' / fixture, data / fixture)
    (release / 'templates').symlink_to(REPO / 'templates')
    script = subprocess.check_output(['docker', 'exec', 'photobooth-web', 'sh', '-c', 'cat /usr/share/nginx/html/assets/*.js']).decode()
    google_ids = set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', script))
    assert len(google_ids) <= 1, 'Ambiguous Google client configuration'
    env = {**os.environ, 'VITE_GOOGLE_CLIENT_ID': next(iter(google_ids), '')}
    run(['npm', 'test'], cwd=frontend, env=env, stdout=(release / 'tests.log').open('w'), stderr=subprocess.STDOUT)
    run(['npm', 'run', 'build'], cwd=frontend, env=env, stdout=(release / 'build.log').open('w'), stderr=subprocess.STDOUT)
    image = 'photobooth-web:admin-' + stamp
    backup_image = 'photobooth-web:before-admin-' + stamp
    build = release / 'image'
    build.mkdir()
    shutil.copytree(frontend / 'dist', build / 'dist')
    (build / 'Dockerfile').write_text(f"FROM {web['Config']['Image']}\nCOPY dist/ /usr/share/nginx/html/\n")
    override = release / 'compose.admin.yml'
    override.write_text(f'services:\n  photobooth-web:\n    image: {image}\n    build:\n      context: {build}\n      dockerfile: Dockerfile\n')
    rollback = release / 'compose.rollback.yml'
    rollback.write_text(f'services:\n  photobooth-web:\n    image: {backup_image}\n')
    containers = [json.loads(line) for line in subprocess.check_output(['docker', 'ps', '--format', '{{json .}}']).decode().splitlines()]
    manifest = {'release': str(release), 'image': image, 'previous_image': web['Config']['Image'],
                'previous_image_id': web['Image'], 'backup_image': backup_image,
                'compose_files': latest['Config']['Labels']['com.docker.compose.project.config_files'].split(','),
                'override': str(override), 'rollback_override': str(rollback),
                'before_containers': {item['Names']: item['ID'] for item in containers},
                'source_files': files, 'google_sign_in_preserved': bool(google_ids),
                'index_sha256': hashlib.sha256((frontend / 'dist/index.html').read_bytes()).hexdigest()}
    (release / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    Path('/tmp/photobooth-admin-release-path').write_text(str(release))
    run(compose_args(manifest) + ['config', '--quiet'], cwd=REPO)
    run(['docker', 'tag', web['Image'], backup_image])
    run(['docker', 'build', '-t', image, str(build)], stdout=(release / 'docker-build.log').open('w'), stderr=subprocess.STDOUT)
    print(json.dumps({'release': str(release), 'image': image, 'google_sign_in_preserved': bool(google_ids), 'build': 'PASS', 'tests': 'PASS', 'compose_config': 'PASS'}))
elif action in ('build', 'deploy', 'rollback', 'status'):
    release = Path(Path('/tmp/photobooth-admin-release-path').read_text().strip())
    manifest = json.loads((release / 'manifest.json').read_text())
    if action == 'rollback':
        manifest['override'] = manifest['rollback_override']
    args = compose_args(manifest)
    run(args + ['config', '--quiet'], cwd=REPO)
    if action == 'build':
        run(['docker', 'tag', manifest['previous_image_id'], manifest['backup_image']])
        run(['docker', 'build', '-t', manifest['image'], str(release / 'image')], stdout=(release / 'docker-build.log').open('w'), stderr=subprocess.STDOUT)
        print(json.dumps({'release': str(release), 'image': manifest['image'], 'compose_config': 'PASS', 'build': 'PASS'}))
        raise SystemExit(0)
    if action != 'status':
        if action == 'deploy':
            assert inspect('photobooth-web')['Image'] == manifest['previous_image_id'], 'Active frontend changed since preparation'
        run(args + ['up', '-d', '--no-deps', '--no-build', 'photobooth-web'], cwd=REPO)
    run(args + ['ps'], cwd=REPO)
    containers = subprocess.check_output(['docker', 'ps', '--format', '{{json .}}']).decode().splitlines()
    after = {item['Names']: item['ID'] for item in map(json.loads, containers)}
    assert all(after.get(name) == value for name, value in manifest['before_containers'].items() if name != 'photobooth-web'), 'A non-web container changed'
    print(json.dumps({'release': str(release), 'other_containers_unchanged': True, 'frontend_image': inspect('photobooth-web')['Config']['Image']}))
else:
    raise SystemExit('Use prepare, build, deploy, status or rollback')
