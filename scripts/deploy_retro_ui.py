"""Release: unified retro typography + side decoration for photobooth-web (web only).

Patches only the diff of commit 99946e3 over the frontend source that is currently live, so uncommitted work
from other agents in /opt/photobooth/frontend is never shipped. Reuses the compose chain the live web container
was started with (its labels) and appends a web-only image override. Usage: deploy_retro_ui.py prepare|deploy|rollback|status
"""
import datetime, difflib, json, os, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path('/opt/photobooth')
POINTER = Path('/srv/photobooth/releases/.retro-ui-current')
BASE_COMMIT, NEW_COMMIT = '861d1b8', '99946e3'
FILES = ['src/retro.css', 'src/retro-decor.css', 'src/main.jsx', 'src/components/home/landing.css', 'src/components/home/home.css',
         'src/components/customer/classicFrames.css', 'src/components/customer/publicResult.css']


def run(args, **kw):
    return subprocess.run(args, check=True, **kw)


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]


def git_show(commit, path):
    r = subprocess.run(['git', '-C', str(ROOT), 'show', f'{commit}:frontend/{path}'], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def compose(m, rollback=False):
    key = dict(e.split('=', 1) for e in inspect('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY']
    os.environ['EXPRESS_IMAGE_ENGINE_KEY'] = key
    args = ['docker', 'compose', '--project-name', 'photobooth', '--project-directory', str(ROOT)]
    for f in m['compose_files'] + [m['rollback'] if rollback else m['override']]:
        args += ['-f', f]
    return args


def ps_ids():
    return {r['Names']: r['ID'] for r in map(json.loads, subprocess.check_output(['docker', 'ps', '--format', '{{json .}}']).decode().splitlines())}


action = sys.argv[1] if len(sys.argv) > 1 else ''
if action == 'prepare':
    web, api = inspect('photobooth-web'), inspect('photobooth-express')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = Path('/srv/photobooth/releases') / f'retro-ui-{stamp}'
    release.mkdir()
    files = web['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    source = Path(files[-1]).parent / 'frontend'
    assert source.is_dir(), 'live frontend snapshot not found'
    target = release / 'frontend'
    shutil.copytree(source, target, ignore=shutil.ignore_patterns('node_modules', 'dist', '.env*', '.vite'))
    drift = {}
    with (release / 'patch.log').open('w') as log:
        for f in FILES:
            base, new = git_show(BASE_COMMIT, f), git_show(NEW_COMMIT, f)
            dest = target / f
            if base is None:  # new file
                shutil.copy2(ROOT / 'frontend' / f, dest) if not dest.exists() else None
            else:
                diff = ''.join(difflib.unified_diff(base.splitlines(True), new.splitlines(True), fromfile=str(dest), tofile=str(dest)))
                run(['patch', '--batch', '--forward', '--no-backup-if-mismatch', str(dest)], input=diff, text=True, stdout=log, stderr=subprocess.STDOUT)
            drift[f] = dest.read_text() == new  # False means live source differed from the commit base in unrelated ways
    (target / 'node_modules').symlink_to(ROOT / 'frontend/node_modules')
    fixtures = release / 'backend/app/data'
    fixtures.mkdir(parents=True)
    for n in ['classic_event_frames.json', 'classic_original_strip_frames.json', 'classic_print_profile.json']:
        shutil.copy2(ROOT / 'backend/app/data' / n, fixtures / n)
    (release / 'templates').symlink_to(ROOT / 'templates')
    assets = subprocess.check_output(['docker', 'exec', 'photobooth-web', 'sh', '-c', 'cat /usr/share/nginx/html/assets/*.js']).decode()
    ids = set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', assets))
    assert len(ids) == 1
    env = dict(v.split('=', 1) for v in api['Config']['Env'] if '=' in v)
    build_env = {**os.environ, 'VITE_GOOGLE_CLIENT_ID': next(iter(ids)), 'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN': env.get('POSTHOG_PROJECT_TOKEN', ''), 'VITE_PUBLIC_POSTHOG_HOST': env.get('POSTHOG_HOST', '')}
    for command, log in [(['npm', 'test'], 'tests.log'), (['npm', 'run', 'build'], 'build.log')]:
        with (release / log).open('w') as out:
            run(command, cwd=target, env=build_env, stdout=out, stderr=subprocess.STDOUT)
    image = f'photobooth-web:retro-ui-{stamp}'
    ctx = release / 'image'
    ctx.mkdir()
    shutil.copytree(target / 'dist', ctx / 'dist')
    (ctx / 'Dockerfile').write_text(f"FROM {web['Config']['Image']}\nCOPY dist/ /usr/share/nginx/html/\n")
    # Same persistent, web-only definition the frame-preview release verified against the running container.
    image_cfg = json.loads(subprocess.check_output(['docker', 'image', 'inspect', web['Image']]))[0]['Config']
    for k in ['Env', 'Cmd', 'Entrypoint']:
        assert web['Config'][k] == image_cfg[k], 'Unexpected container override: ' + k
    assert not web['Mounts'] and list(web['NetworkSettings']['Networks']) == ['photobooth-net']
    assert web['HostConfig']['PortBindings'] == {'80/tcp': [{'HostIp': '', 'HostPort': '3000'}]}
    assert web['HostConfig']['RestartPolicy']['Name'] == 'unless-stopped'
    override, rollback = release / 'compose.retro-ui.yml', release / 'compose.rollback.yml'
    override.write_text(f'services:\n  photobooth-web:\n    image: {image}\n')
    rollback.write_text(f"services:\n  photobooth-web:\n    image: {web['Config']['Image']}\n")
    m = {'image': image, 'previous_image': web['Config']['Image'], 'previous_id': web['Image'], 'compose_files': files,
         'override': str(override), 'rollback': str(rollback), 'before': ps_ids(), 'matches_commit': drift}
    (release / 'manifest.json').write_text(json.dumps(m, indent=2))
    POINTER.write_text(str(release))
    run(compose(m) + ['config', '--quiet'])
    with (release / 'docker-build.log').open('w') as out:
        run(['docker', 'build', '-t', image, str(ctx)], stdout=out, stderr=subprocess.STDOUT)
    print(json.dumps({'status': 'PASS', 'prepared': str(release), 'files_identical_to_commit': drift, 'deployed': False}, indent=1))
elif action in ('deploy', 'rollback', 'status'):
    release = Path(POINTER.read_text().strip())
    m = json.loads((release / 'manifest.json').read_text())
    args = compose(m, action == 'rollback')
    run(args + ['config', '--quiet'])
    if action == 'deploy':
        assert inspect('photobooth-web')['Image'] == m['previous_id'], 'Frontend changed since prepare'
    if action != 'status':
        run(args + ['up', '-d', '--no-deps', '--no-build', 'photobooth-web'])
    run(args + ['ps', 'photobooth-web'])
    now = ps_ids()
    assert all(now.get(n) == i for n, i in m['before'].items() if n != 'photobooth-web'), 'Non-web container changed'
    print(json.dumps({'status': 'PASS', 'image': inspect('photobooth-web')['Config']['Image'], 'other_containers_unchanged': True}))
else:
    raise SystemExit('Use prepare/deploy/rollback/status')
