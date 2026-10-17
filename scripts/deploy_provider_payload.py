"""Release: production image provider call without `response_format` for gpt-image models + redacted upstream error detail.

The generation worker (photobooth-express-worker) makes the provider calls, so BOTH the worker and the API image get the same two
patched files (the API also builds the provider for admin previews). Each image is the RUNNING image plus our diff (HEAD -> working
tree of only these files), compiled and layered; nothing else in them changes. Uses the persistent express snapshot.

Usage: deploy_provider_payload.py prepare|deploy|rollback|status
prepare builds and validates without touching production. deploy/rollback need explicit owner approval.
"""
import datetime, difflib, json, os, shutil, subprocess, sys, time, urllib.request
from pathlib import Path

REPO = Path('/opt/photobooth')
RELEASES = Path('/srv/photobooth/releases')
POINTER = RELEASES / '.provider-payload-current'
SNAPSHOT = RELEASES / 'express-base/compose.express-base.json'
API, WORKER = 'photobooth-express', 'photobooth-express-worker'
SELF = 'provider-payload'
PATCHED = ['src/services/native-provider.service.ts', 'src/models/provider-run.model.ts']
MARKER = ('dist/services/native-provider.service.js', 'returnsBase64ByDefault')


def run(args, **kw):
    return subprocess.run(args, check=True, **kw)


def out(args, **kw):
    return subprocess.check_output(args, **kw)


def inspect(name):
    return json.loads(out(['docker', 'inspect', name]))[0]


def containers():
    return {v['Names']: v['ID'] for v in map(json.loads, out(['docker', 'ps', '--format', '{{json .}}']).decode().splitlines())}


def git_head(path):
    r = subprocess.run(['git', '-C', str(REPO), 'show', f'HEAD:{path}'], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def express_validate():
    r = subprocess.run(['python3', '-I', str(REPO / 'scripts/snapshot_express_compose.py'), 'validate'], capture_output=True, text=True)
    return r.stdout + r.stderr, '"PASS"' in r.stdout or r.stdout.strip().endswith('PASS')


def compose(m, service, rollback=False):
    key = dict(e.split('=', 1) for e in inspect('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY']
    os.environ['EXPRESS_IMAGE_ENGINE_KEY'] = key
    s = m[service]
    return ['docker', 'compose', '--project-directory', str(REPO), '--env-file', str(REPO / '.env'), '-f', str(SNAPSHOT), '-f', s['rollback'] if rollback else s['override']]


def http(url):
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def prepare_image(name, r, stamp, log_dir):
    running = inspect(name)
    src = r / f'{name}-source'
    src.mkdir()
    for f in ['src', 'prisma', 'package.json', 'tsconfig.json', 'tsconfig.build.json']:
        run(['docker', 'cp', f'{name}:/app/{f}', str(src / f)], stdout=subprocess.DEVNULL)
    with (log_dir / f'{name}-patch.log').open('w') as log:
        for rel in PATCHED:
            head = git_head(f'backend-express/{rel}')
            assert head is not None, f'{rel} is not tracked'
            live = (src / rel).read_text()
            assert live == head, f'{rel} in {name} differs from HEAD; refusing to patch blindly'
            new = (REPO / 'backend-express' / rel).read_text()
            diff = ''.join(difflib.unified_diff(head.splitlines(True), new.splitlines(True), fromfile=str(src / rel), tofile=str(src / rel)))
            assert diff, f'no change to ship in {rel}'
            run(['patch', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', str(src / rel)], input=diff, text=True, stdout=log, stderr=subprocess.STDOUT)
    (src / 'node_modules').symlink_to(REPO / 'backend-express/node_modules')
    with (log_dir / f'{name}-compile.log').open('w') as f:
        run(['node', str(REPO / 'backend-express/node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], cwd=src, stdout=f, stderr=subprocess.STDOUT)
    ctx = r / f'{name}-image'
    for rel in PATCHED:
        js = Path('dist') / Path(rel).relative_to('src').with_suffix('.js')
        for source, target in [(src / rel, ctx / rel), (src / js, ctx / js), (src / (str(js) + '.map'), ctx / (str(js) + '.map'))]:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    image = f'photobooth-express:{SELF}-{"worker" if name == WORKER else "api"}-{stamp}'
    (ctx / 'Dockerfile').write_text(f"FROM {running['Config']['Image']}\nCOPY src/ /app/src/\nCOPY dist/ /app/dist/\n")
    override, rollback = r / f'compose.{name}.yml', r / f'compose.{name}-rollback.yml'
    override.write_text(f'services:\n  {name}:\n    image: {image}\n')
    rollback.write_text(f"services:\n  {name}:\n    image: {running['Config']['Image']}\n")
    return {'image': image, 'previous_image': running['Config']['Image'], 'previous_id': running['Image'], 'override': str(override), 'rollback': str(rollback), 'ctx': str(ctx)}


def prepare():
    text, ok = express_validate()
    assert ok, 'snapshot_express_compose.py validate must be PASS before an express release:\n' + text
    assert inspect(API)['State'].get('Health', {}).get('Status') == 'healthy', 'api is not healthy'
    assert inspect(WORKER)['State']['Status'] == 'running', 'worker is not running'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    r = RELEASES / f'{SELF}-{stamp}'
    r.mkdir()
    (r / 'logs').mkdir()
    m = {'release': str(r), 'before': containers(), 'deployed': {}}
    for name in (WORKER, API):
        m[name] = prepare_image(name, r, stamp, r / 'logs')
    (r / 'manifest.json').write_text(json.dumps(m, indent=2))
    for name in (WORKER, API):
        run(compose(m, name) + ['config', '--quiet'])
        with (r / 'logs' / f'{name}-docker-build.log').open('w') as f:
            run(['docker', 'build', '-t', m[name]['image'], m[name]['ctx']], stdout=f, stderr=subprocess.STDOUT)
        got = out(['docker', 'run', '--rm', '--entrypoint', 'sh', m[name]['image'], '-c', f'grep -c {MARKER[1]} /app/{MARKER[0]}']).decode().strip()
        assert int(got) >= 1, f'{name}: new code missing from the built image'
    POINTER.write_text(str(r))
    print(json.dumps({'status': 'PASS', 'release': str(r), 'worker_image': m[WORKER]['image'], 'api_image': m[API]['image'], 'deployed': False}))


def step(name, m, rollback):
    run(compose(m, name, rollback) + ['up', '-d', '--no-deps', '--no-build', name])
    deadline = time.time() + 90
    while time.time() < deadline:
        s = inspect(name)['State']
        if s['Status'] == 'running' and (name == WORKER or s.get('Health', {}).get('Status') == 'healthy'):
            break
        time.sleep(1)
    else:
        raise RuntimeError(f'{name} did not become ready')
    time.sleep(8 if name == WORKER else 0)  # the worker has no healthcheck: make sure it stays up
    assert inspect(name)['State']['Status'] == 'running' and inspect(name)['RestartCount'] == 0, f'{name} restarted'
    has = out(['docker', 'exec', name, 'sh', '-c', f'grep -c {MARKER[1]} /app/{MARKER[0]} || true']).decode().strip()
    assert (int(has) == 0) == rollback, f'{name}: unexpected code state ({has})'
    if name == API:
        assert http('http://127.0.0.1:3000/api/health') == 200, 'health through the web port failed'
        assert http('http://127.0.0.1:3000/api/v1/desktop/update?current=0.0.1') == 401


STEPS = [WORKER, API]


def regenerate_snapshot():
    run(['python3', '-I', str(REPO / 'scripts/snapshot_express_compose.py'), 'generate'])
    text, ok = express_validate()
    assert ok, 'snapshot validate after deploy: ' + text


def deploy(m, r):
    for name in STEPS:
        assert inspect(name)['Image'] == m[name]['previous_id'], f'Live {name} changed since prepare'
    text, ok = express_validate()
    assert ok, 'snapshot validate must be PASS:\n' + text
    done = []
    for name in STEPS:
        try:
            step(name, m, False)
            done.append(name)
            m['deployed'][name] = True
            (r / 'manifest.json').write_text(json.dumps(m, indent=2))
        except Exception as error:
            print(f'STEP {name} FAILED: {error}; rolling back', file=sys.stderr)
            for undo in [n for n in STEPS if n in done + [name]][::-1]:
                step(undo, m, True)
                m['deployed'][undo] = False
            (r / 'manifest.json').write_text(json.dumps(m, indent=2))
            raise
    regenerate_snapshot()
    changed = sorted(n for n, i in m['before'].items() if containers().get(n) != i)
    assert set(changed) <= {API, WORKER}, f'Unexpected containers changed: {changed}'
    print(json.dumps({'status': 'PASS', 'changed_containers': changed}))


def rollback(m, r):
    for name in STEPS[::-1]:
        if m['deployed'].get(name):
            step(name, m, True)
            m['deployed'][name] = False
    regenerate_snapshot()
    (r / 'manifest.json').write_text(json.dumps(m, indent=2))
    print(json.dumps({'status': 'ROLLED_BACK', 'deployed': m['deployed']}))


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ''
    if action == 'prepare':
        return prepare()
    if action not in ('deploy', 'rollback', 'status'):
        raise SystemExit('Use prepare|deploy|rollback|status')
    r = Path(POINTER.read_text().strip())
    m = json.loads((r / 'manifest.json').read_text())
    if action == 'status':
        print(json.dumps({'release': str(r), 'deployed': m['deployed'], 'running': {k: v for k, v in containers().items() if k.startswith('photobooth-express')}}, indent=2))
    elif action == 'deploy':
        deploy(m, r)
    else:
        rollback(m, r)


if __name__ == '__main__':
    main()
