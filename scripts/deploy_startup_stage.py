"""Release: startup-stage error logging for photobooth-express and photobooth-express-worker.

Patches only the changed files onto the currently running images (pattern of deploy_floral_event.py)
and uses the persistent compose snapshot written by snapshot_express_compose.py.
Usage: deploy_startup_stage.py prepare|deploy|rollback|status   (deploy/rollback need user approval)
"""
import datetime, difflib, json, os, shutil, subprocess, sys
from pathlib import Path

REPO = Path('/opt/photobooth')
BASE_COMMIT = '13e30f2'  # parent of the change; baseline for the patch
POINTER = Path('/srv/photobooth/releases/.startup-stage-current')
SNAPSHOT = '/srv/photobooth/releases/express-base/compose.express-base.json'
FILES = {'api': ['src/migration-server.ts', 'src/lib/startup-stage.ts'], 'worker': ['src/migration-worker.ts', 'src/lib/startup-stage.ts']}  # only what each service runs
SERVICES = {'api': 'photobooth-express', 'worker': 'photobooth-express-worker'}


def run(args, **kw):
    return subprocess.run(args, check=True, **kw)


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]


def git_show(path):
    r = subprocess.run(['git', '-C', str(REPO), 'show', f'{BASE_COMMIT}:backend-express/{path}'], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def compose(m, rollback=False):
    key = dict(e.split('=', 1) for e in inspect('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY']
    os.environ['EXPRESS_IMAGE_ENGINE_KEY'] = key
    args = ['docker', 'compose', '--project-directory', str(REPO), '--env-file', str(REPO / '.env'), '-f', SNAPSHOT]
    return args + ['-f', m['rollback'] if rollback else m['override']]


def ps_ids():
    return {v['Names']: v['ID'] for v in map(json.loads, subprocess.check_output(['docker', 'ps', '--format', '{{json .}}']).decode().splitlines())}


def patch_file(live, new, target, log):
    base = git_show(live)
    if base is None:  # new file
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO / 'backend-express' / live, target)
        return
    assert target.exists(), f'live image lacks {live}'
    diff = ''.join(difflib.unified_diff(base.splitlines(True), (REPO / 'backend-express' / live).read_text().splitlines(True), fromfile=str(target), tofile=str(target)))
    if diff:
        run(['patch', '--batch', '--forward', '--no-backup-if-mismatch', str(target)], input=diff, text=True, stdout=log, stderr=subprocess.STDOUT)


action = sys.argv[1] if len(sys.argv) > 1 else ''
if action == 'prepare':
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    r = Path('/srv/photobooth/releases') / f'startup-stage-{stamp}'
    r.mkdir()
    POINTER.write_text(str(r))
    running = {k: inspect(n) for k, n in SERVICES.items()}
    images = {k: f'photobooth-express:startup-stage-{k}-{stamp}' for k in SERVICES}
    for key, name in SERVICES.items():
        src = r / f'{key}-source'
        src.mkdir()
        for f in ['src', 'prisma', 'package.json', 'tsconfig.json', 'tsconfig.build.json']:
            run(['docker', 'cp', f'{name}:/app/{f}', str(src / f)], stdout=subprocess.DEVNULL)
        with (r / f'{key}-patch.log').open('w') as log:
            for f in FILES[key]:
                patch_file(f, None, src / f, log)
        (src / 'node_modules').symlink_to(REPO / 'backend-express/node_modules')
        with (r / f'{key}-compile.log').open('w') as f:
            run(['node', str(REPO / 'backend-express/node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], cwd=src, stdout=f, stderr=subprocess.STDOUT)
        ctx = r / f'{key}-image'
        ctx.mkdir()
        for f in FILES[key]:
            for rel, root in [(f, src), ]:
                t = ctx / rel
                t.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(root / rel, t)
            js = Path('dist') / Path(f).relative_to('src').with_suffix('.js')
            for ext in ['.js', '.js.map']:
                s = src / str(js).replace('.js', ext) if ext == '.js' else src / (str(js) + '.map')
                t = ctx / str(js).replace('.js', ext) if ext == '.js' else ctx / (str(js) + '.map')
                t.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(s, t)
        (ctx / 'Dockerfile').write_text(f"FROM {running[key]['Config']['Image']}\nCOPY src/ /app/src/\nCOPY dist/ /app/dist/\n")
    override, rollback = r / 'compose.startup-stage.yml', r / 'compose.rollback.yml'
    override.write_text('services:\n' + ''.join(f'  {SERVICES[k]}:\n    image: {images[k]}\n' for k in SERVICES))
    rollback.write_text('services:\n' + ''.join(f"  {SERVICES[k]}:\n    image: {running[k]['Config']['Image']}\n" for k in SERVICES))
    m = {'release': str(r), 'services': SERVICES, 'previous': {k: v['Config']['Image'] for k, v in running.items()}, 'images': images,
         'override': str(override), 'rollback': str(rollback), 'before': ps_ids()}
    (r / 'manifest.json').write_text(json.dumps(m, indent=2))
    run(compose(m) + ['config', '--quiet'])
    for key in SERVICES:
        with (r / f'{key}-docker-build.log').open('w') as f:
            run(['docker', 'build', '-t', images[key], str(r / f'{key}-image')], stdout=f, stderr=subprocess.STDOUT)
    print(json.dumps({'release': str(r), 'builds': 'PASS', 'compose': 'PASS', 'deployed': False}))
elif action in ('deploy', 'rollback', 'status'):
    r = Path(POINTER.read_text().strip())
    m = json.loads((r / 'manifest.json').read_text())
    args = compose(m, action == 'rollback')
    run(args + ['config', '--quiet'])
    if action == 'deploy':
        for k, n in SERVICES.items():
            assert inspect(n)['Config']['Image'] == m['previous'][k], 'Live release changed since prepare'
    if action != 'status':
        run(args + ['up', '-d', '--no-deps', '--no-build', *SERVICES.values()])
    run(args + ['ps', *SERVICES.values()])
    now = ps_ids()
    changed = [n for n, i in m['before'].items() if now.get(n) != i]
    assert set(changed) <= set(SERVICES.values()), changed
    print(json.dumps({'status': 'PASS', 'changed_containers': changed}))
else:
    raise SystemExit('Use prepare/deploy/rollback/status')
