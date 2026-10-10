"""Build/release only the /kiosk visual preview over the active frontend snapshot."""
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

REPO = Path('/opt/photobooth')
SOURCE = Path(__file__).resolve().parents[1]
POINTER = Path('/tmp/photobooth-kiosk-preview-release-path')

def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]

def compose(manifest, rollback=False):
    # Required by existing Compose validation; kept only in process memory.
    helper = dict(v.split('=', 1) for v in inspect('photobooth-image-helper')['Config']['Env'] if '=' in v)
    if helper.get('AI_ENGINE_API_KEY'):
        os.environ.setdefault('EXPRESS_IMAGE_ENGINE_KEY', helper['AI_ENGINE_API_KEY'])
    args = ['docker', 'compose', '--project-directory', str(REPO), '--env-file', str(REPO / '.env')]
    for file in manifest['compose_files'] + [manifest['rollback'] if rollback else manifest['override']]:
        args += ['-f', file]
    return args

action = sys.argv[1]
if action == 'prepare':
    web, api = inspect('photobooth-web'), inspect('photobooth-express')
    files = web['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    snapshot = Path(files[-1]).parent / 'frontend'
    assert snapshot.is_dir(), 'Active frontend source snapshot is required'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = Path('/srv/photobooth/releases') / ('kiosk-preview-' + stamp)
    release.mkdir()
    frontend = release / 'frontend'
    shutil.copytree(snapshot, frontend, ignore=shutil.ignore_patterns('node_modules', 'dist', '.vite', '.env*'))
    shutil.copytree(SOURCE / 'frontend/src/components/kiosk', frontend / 'src/components/kiosk')
    shutil.copy2(SOURCE / 'frontend/scripts/kiosk-preview-check.mjs', frontend / 'scripts/kiosk-preview-check.mjs')
    # Preserve all deployed imports/styles, inserting only the new entry wrapper.
    entry = frontend / 'src/main.jsx'
    source = entry.read_text()
    assert '<App />' in source and 'KioskEntry' not in source, 'Unexpected entry snapshot'
    source = source.replace("import App from './App.jsx'", "import App from './App.jsx'\nimport KioskEntry from './components/kiosk/KioskEntry.jsx'")
    entry.write_text(source.replace('<App />', '<KioskEntry><App /></KioskEntry>'))
    (frontend / 'node_modules').symlink_to(REPO / 'frontend/node_modules')
    data = release / 'backend/app/data'
    data.mkdir(parents=True)
    for file in ['classic_event_frames.json', 'classic_original_strip_frames.json', 'classic_print_profile.json']:
        shutil.copy2(REPO / 'backend/app/data' / file, data / file)
    (release / 'templates').symlink_to(REPO / 'templates')
    assets = subprocess.check_output(['docker', 'exec', 'photobooth-web', 'sh', '-c', 'cat /usr/share/nginx/html/assets/*.js']).decode()
    google = set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', assets))
    assert len(google) <= 1, 'Ambiguous Google sign-in configuration'
    env = {**os.environ, 'VITE_GOOGLE_CLIENT_ID': next(iter(google), '')}
    for command, log in [(['npm', 'test'], 'tests.log'), (['npm', 'run', 'build'], 'build.log')]:
        with (release / log).open('w') as output:
            run(command, cwd=frontend, env=env, stdout=output, stderr=subprocess.STDOUT)
    image = 'photobooth-web:kiosk-preview-' + stamp
    context = release / 'image'
    context.mkdir()
    shutil.copytree(frontend / 'dist', context / 'dist')
    (context / 'Dockerfile').write_text(f"FROM {web['Config']['Image']}\nCOPY dist/ /usr/share/nginx/html/\n")
    override, rollback = release / 'compose.kiosk-preview.yml', release / 'compose.rollback.yml'
    override.write_text(f'services:\n  photobooth-web:\n    image: {image}\n')
    rollback.write_text(f"services:\n  photobooth-web:\n    image: {web['Config']['Image']}\n")
    before = {v['Names']: v['ID'] for v in map(json.loads, subprocess.check_output(['docker', 'ps', '--format', '{{json .}}']).decode().splitlines())}
    manifest = {'release': str(release), 'image': image, 'previous_image': web['Config']['Image'], 'compose_files': api['Config']['Labels']['com.docker.compose.project.config_files'].split(','), 'override': str(override), 'rollback': str(rollback), 'before_containers': before, 'google_sign_in_preserved': bool(google)}
    (release / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    POINTER.write_text(str(release))
    run(compose(manifest) + ['config', '--quiet'])
    with (release / 'docker-build.log').open('w') as log:
        run(['docker', 'build', '-t', image, str(context)], stdout=log, stderr=subprocess.STDOUT)
    print(json.dumps({'release': str(release), 'image': image, 'tests': 'PASS', 'build': 'PASS', 'compose_config': 'PASS'}))
elif action in ['deploy', 'rollback', 'status']:
    release = Path(POINTER.read_text().strip())
    manifest = json.loads((release / 'manifest.json').read_text())
    if action == 'deploy':
        assert inspect('photobooth-web')['Config']['Image'] == manifest['previous_image'], 'Frontend changed since prepare'
    args = compose(manifest, action == 'rollback')
    run(args + ['config', '--quiet'])
    if action != 'status':
        run(args + ['up', '-d', '--no-deps', '--no-build', 'photobooth-web'])
    run(args + ['ps', 'photobooth-web'])
    now = {v['Names']: v['ID'] for v in map(json.loads, subprocess.check_output(['docker', 'ps', '--format', '{{json .}}']).decode().splitlines())}
    changed = [name for name, id in manifest['before_containers'].items() if now.get(name) != id]
    assert set(changed).issubset({'photobooth-web'}), f'Unexpected container changes: {changed}'
    print(json.dumps({'status': 'PASS', 'changed_containers': changed, 'image': inspect('photobooth-web')['Config']['Image']}))
else:
    raise SystemExit('Use prepare, deploy, rollback, status')
