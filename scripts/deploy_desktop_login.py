"""Release: desktop update endpoint + kiosk device login (account login for desktop kiosks).

Three independent pieces, deployed in this order and rolled back in reverse:
  1. photobooth-express: patch only our files onto the RUNNING image (pattern of deploy_startup_stage.py).
     The worker is not touched. Uses the persistent express snapshot; `validate` must be PASS.
  2. gateways (control + media): new config dir with our route additions, applied as a diff onto the
     LIVE config; compose project `photobooth-gateway`.
  3. photobooth-web: rebuild from the source snapshot that matches the live HTML, with only our diff
     (admin role option) plus public/kiosk-activate.html.

Usage: deploy_desktop_login.py prepare|deploy|rollback|status
prepare builds and validates without touching production. deploy/rollback need explicit owner approval.
Uncommitted work of other agents is never included: patches are HEAD -> our version, applied to live files.
"""
import datetime, difflib, hashlib, json, os, re, shutil, subprocess, sys, time, urllib.request
from pathlib import Path

REPO = Path('/opt/photobooth')
RELEASES = Path('/srv/photobooth/releases')
POINTER = RELEASES / '.desktop-login-current'
SNAPSHOT = RELEASES / 'express-base/compose.express-base.json'
API, WEB, CONTROL, MEDIA = 'photobooth-express', 'photobooth-web', 'photobooth-control-gateway', 'photobooth-media-entry'
GATEWAY_COMPOSE = REPO / 'api-gateway/compose.production.yml'
SELF = 'desktop-login'

# Express: files patched onto the live image (relative to backend-express/). New files are copied whole.
API_PATCHED = ['src/migration-app.ts', 'src/migration-server.ts', 'src/migration-container.ts', 'src/services/native-kiosk.service.ts',
               'src/routes/native-kiosk.routes.ts', 'src/services/admin-operations.service.ts']
API_NEW = ['src/services/desktop-update.service.ts', 'src/routes/desktop-update.routes.ts', 'src/services/kiosk-device.service.ts',
           'src/models/kiosk-device.model.ts', 'src/routes/desktop-device.routes.ts']
# Lines that belong to someone else's uncommitted work and must not ship with this release.
FOREIGN_LINES = {'src/migration-container.ts': [('    autoBilling:true,scenarios:', '    scenarios:')]}
WEB_PATCHED = ['src/AdminPage.jsx']
WEB_NEW = ['public/kiosk-activate.html']
GATEWAY_FILES = {'control.conf': ('photobooth-control-gateway', '/etc/nginx/conf.d/default.conf'),
                 'proxy-control.conf': ('photobooth-control-gateway', '/etc/nginx/conf.d/proxy-control.inc'),
                 'media.conf': ('photobooth-media-entry', '/etc/nginx/conf.d/default.conf')}
GATEWAY_PATCHED = ['control.conf', 'media.conf']


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


def our_version(rel_repo_path, key=None, head_text=''):
    """Working-tree text with other agents' known uncommitted lines removed (only while HEAD still lacks them)."""
    text = (REPO / rel_repo_path).read_text()
    for old, new in FOREIGN_LINES.get(key or '', []):
        if old not in head_text:
            text = text.replace(old, new, 1)
    return text


def patch_text(live_path, head_text, new_text, log):
    diff = ''.join(difflib.unified_diff(head_text.splitlines(True), new_text.splitlines(True), fromfile=str(live_path), tofile=str(live_path)))
    if diff:
        run(['patch', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', str(live_path)], input=diff, text=True, stdout=log, stderr=subprocess.STDOUT)
    return bool(diff)


def express_validate():
    r = subprocess.run(['python3', '-I', str(REPO / 'scripts/snapshot_express_compose.py'), 'validate'], capture_output=True, text=True)
    return r.stdout + r.stderr, '"PASS"' in r.stdout or r.stdout.strip().endswith('PASS')


def express_compose(m, rollback=False):
    key = dict(e.split('=', 1) for e in inspect('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY']
    os.environ['EXPRESS_IMAGE_ENGINE_KEY'] = key
    return ['docker', 'compose', '--project-directory', str(REPO), '--env-file', str(REPO / '.env'), '-f', str(SNAPSHOT),
            '-f', m['api']['rollback'] if rollback else m['api']['override']]


def gateway_compose(m, rollback=False):
    g = m['gateway']
    env = {**os.environ, 'PHBO_GATEWAY_CONFIG_DIR': g['previous_dir'] if rollback else g['config_dir'],
           'PHBO_BIND_ADDRESS': g['bind'], 'PHBO_CONTROL_PORT': g['control_port'], 'PHBO_MEDIA_PORT': g['media_port']}
    return ['docker', 'compose', '--project-name', 'photobooth-gateway', '-f', str(GATEWAY_COMPOSE)], env


def web_compose(m, rollback=False):
    w = m['web']
    return ['docker', 'compose', '--project-name', 'photobooth', '--project-directory', str(REPO), '-f', w['base'], '-f', w['rollback'] if rollback else w['override']]


def wait_healthy(name, seconds=90):
    for _ in range(seconds):
        s = inspect(name)['State']
        if s['Status'] == 'running' and s.get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(1)
    raise RuntimeError(f'{name} did not become healthy')


def http(url, method='GET', data=None, headers=None):
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


# ------------------------------------------------------------------ prepare
def prepare_api(r, stamp, log_dir):
    running = inspect(API)
    src = r / 'api-source'
    src.mkdir()
    for f in ['src', 'prisma', 'package.json', 'tsconfig.json', 'tsconfig.build.json']:
        run(['docker', 'cp', f'{API}:/app/{f}', str(src / f)], stdout=subprocess.DEVNULL)
    with (log_dir / 'api-patch.log').open('w') as log:
        for rel in API_PATCHED:
            head = git_head(f'backend-express/{rel}')
            assert head is not None, f'{rel} is not tracked'
            assert (src / rel).exists(), f'live image lacks {rel}'
            assert patch_text(src / rel, head, our_version(f'backend-express/{rel}', rel, head), log), f'no change to ship in {rel}'
        for rel in API_NEW:
            assert not (src / rel).exists(), f'{rel} already exists in the live image'
            shutil.copy2(REPO / 'backend-express' / rel, src / rel)
    (src / 'node_modules').symlink_to(REPO / 'backend-express/node_modules')
    with (log_dir / 'api-compile.log').open('w') as f:
        run(['node', str(REPO / 'backend-express/node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], cwd=src, stdout=f, stderr=subprocess.STDOUT)
    ctx = r / 'api-image'
    for rel in API_PATCHED + API_NEW:
        js = Path('dist') / Path(rel).relative_to('src').with_suffix('.js')
        for source, target in [(src / rel, ctx / rel), (src / js, ctx / js), (src / (str(js) + '.map'), ctx / (str(js) + '.map'))]:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
    image = f'photobooth-express:{SELF}-{stamp}'
    (ctx / 'Dockerfile').write_text(f"FROM {running['Config']['Image']}\nCOPY src/ /app/src/\nCOPY dist/ /app/dist/\n")
    override, rollback = r / 'compose.api.yml', r / 'compose.api-rollback.yml'
    override.write_text(f'services:\n  {API}:\n    image: {image}\n')
    rollback.write_text(f"services:\n  {API}:\n    image: {running['Config']['Image']}\n")
    return {'image': image, 'previous_image': running['Config']['Image'], 'previous_id': running['Image'], 'override': str(override), 'rollback': str(rollback), 'ctx': str(ctx)}


def prepare_gateway(r):
    control = inspect(CONTROL)
    mount = next(m for m in control['Mounts'] if m['Destination'] == '/etc/nginx/conf.d/default.conf')
    ports = {'control': control['HostConfig']['PortBindings']['8080/tcp'][0], 'media': inspect(MEDIA)['HostConfig']['PortBindings']['8080/tcp'][0]}
    cfg = r / 'gateway-config'
    cfg.mkdir()
    for name, (container, path) in GATEWAY_FILES.items():
        (cfg / name).write_bytes(out(['docker', 'exec', container, 'cat', path]))
    with (r / 'gateway-patch.log').open('w') as log:
        for name in GATEWAY_PATCHED:
            head = git_head(f'api-gateway/{name}')
            assert patch_text(cfg / name, head, (REPO / 'api-gateway' / name).read_text(), log), f'no change to ship in {name}'
    for container_conf, extra in [('control.conf', ['-v', f'{cfg}/proxy-control.conf:/etc/nginx/conf.d/proxy-control.inc:ro']), ('media.conf', [])]:
        run(['docker', 'run', '--rm', '--network', 'none', '-v', f'{cfg}/{container_conf}:/etc/nginx/conf.d/default.conf:ro', *extra, 'nginx:1.28-alpine', 'nginx', '-t'])
    return {'config_dir': str(cfg), 'previous_dir': str(Path(mount['Source']).parent), 'bind': ports['control']['HostIp'] or '0.0.0.0',
            'control_port': ports['control']['HostPort'], 'media_port': ports['media']['HostPort'],
            'control_id': control['Id'], 'media_id': inspect(MEDIA)['Id']}


def prepare_web(r, stamp, log_dir):
    web = inspect(WEB)
    live_hash = hashlib.sha256(out(['docker', 'exec', WEB, 'cat', '/usr/share/nginx/html/index.html'])).hexdigest()
    source = next((p.parent.parent for p in sorted(RELEASES.glob('*/frontend/dist/index.html'), reverse=True) if hashlib.sha256(p.read_bytes()).hexdigest() == live_hash), None)
    assert source, 'No source snapshot matches the live web HTML (a newer release may not have kept its source)'
    target = r / 'frontend'
    shutil.copytree(source, target, ignore=shutil.ignore_patterns('node_modules', 'dist', '.env*', '.vite'))
    with (log_dir / 'web-patch.log').open('w') as log:
        for rel in WEB_PATCHED:
            head = git_head(f'frontend/{rel}')
            assert patch_text(target / rel, head, (REPO / 'frontend' / rel).read_text(), log), f'no change to ship in {rel}'
        for rel in WEB_NEW:
            assert not (target / rel).exists(), f'{rel} already in the live snapshot'
            shutil.copy2(REPO / 'frontend' / rel, target / rel)
    (target / 'node_modules').symlink_to(REPO / 'frontend/node_modules')
    # Frontend tests read ../../backend/app/data and ../../templates relative to the snapshot.
    fixtures = r / 'backend/app/data'
    fixtures.mkdir(parents=True)
    for name in ['classic_event_frames.json', 'classic_original_strip_frames.json', 'classic_print_profile.json']:
        shutil.copy2(REPO / 'backend/app/data' / name, fixtures / name)
    (r / 'templates').symlink_to(REPO / 'templates')
    assets = out(['docker', 'exec', WEB, 'sh', '-c', 'cat /usr/share/nginx/html/assets/*.js']).decode()
    ids = set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', assets))
    assert len(ids) == 1, 'Could not preserve the public Google configuration'
    api_env = dict(v.split('=', 1) for v in inspect(API)['Config']['Env'] if '=' in v)
    env = {**os.environ, 'VITE_GOOGLE_CLIENT_ID': next(iter(ids)), 'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN': api_env.get('POSTHOG_PROJECT_TOKEN', ''),
           'VITE_PUBLIC_POSTHOG_HOST': api_env.get('POSTHOG_HOST', '')}
    for command, name in [(['npm', 'test'], 'web-tests'), (['npm', 'run', 'build'], 'web-build')]:
        with (log_dir / f'{name}.log').open('w') as f:
            run(command, cwd=target, env=env, stdout=f, stderr=subprocess.STDOUT)
    assert (target / 'dist/kiosk-activate.html').exists(), 'activation page missing from build'
    ctx = r / 'web-image'
    ctx.mkdir()
    shutil.copytree(target / 'dist', ctx / 'dist', ignore=shutil.ignore_patterns('*.map'))
    image = f'photobooth-web:{SELF}-{stamp}'
    (ctx / 'Dockerfile').write_text(f"FROM {web['Config']['Image']}\nCOPY dist/ /usr/share/nginx/html/\n")
    hc = web['Config']['Healthcheck']
    health = {'test': hc['Test'], 'retries': hc['Retries']}
    for key, name in [('Interval', 'interval'), ('Timeout', 'timeout'), ('StartPeriod', 'start_period'), ('StartInterval', 'start_interval')]:
        if key in hc:
            health[name] = str(hc[key]) + 'ns'
    base, override, rollback = r / 'compose.web-base.json', r / 'compose.web.yml', r / 'compose.web-rollback.yml'
    base.write_text(json.dumps({'services': {WEB: {'image': web['Config']['Image'], 'container_name': WEB, 'restart': 'unless-stopped',
        'ports': ['3000:80'], 'networks': ['photobooth'], 'healthcheck': health}}, 'networks': {'photobooth': {'external': True, 'name': 'photobooth-net'}}}, indent=2))
    override.write_text(f'services:\n  {WEB}:\n    image: {image}\n')
    rollback.write_text(f"services:\n  {WEB}:\n    image: {web['Config']['Image']}\n")
    return {'image': image, 'previous_image': web['Config']['Image'], 'previous_id': web['Image'], 'base': str(base), 'override': str(override),
            'rollback': str(rollback), 'ctx': str(ctx), 'old_index_sha256': live_hash,
            'new_index_sha256': hashlib.sha256((target / 'dist/index.html').read_bytes()).hexdigest()}


def prepare():
    text, ok = express_validate()
    assert ok, 'snapshot_express_compose.py validate must be PASS before an express release:\n' + text
    for name in (API, WEB, CONTROL, MEDIA):
        assert inspect(name)['State'].get('Health', {}).get('Status') == 'healthy', f'{name} is not healthy'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    r = RELEASES / f'{SELF}-{stamp}'
    r.mkdir()
    (r / 'logs').mkdir()
    m = {'release': str(r), 'before': containers(), 'deployed': {}}
    m['api'] = prepare_api(r, stamp, r / 'logs')
    m['gateway'] = prepare_gateway(r)
    m['web'] = prepare_web(r, stamp, r / 'logs')
    (r / 'manifest.json').write_text(json.dumps(m, indent=2))
    run(express_compose(m) + ['config', '--quiet'])
    cmd, env = gateway_compose(m)
    run(cmd + ['config', '--quiet'], env=env)
    run(web_compose(m) + ['config', '--quiet'])
    for name, key in [('api', 'ctx'), ('web', 'ctx')]:
        with (r / 'logs' / f'{name}-docker-build.log').open('w') as f:
            run(['docker', 'build', '-t', m[name]['image'], m[name][key]], stdout=f, stderr=subprocess.STDOUT)
    run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'nginx', m['web']['image'], '-t'])
    POINTER.write_text(str(r))
    print(json.dumps({'status': 'PASS', 'release': str(r), 'api_image': m['api']['image'], 'web_image': m['web']['image'], 'deployed': False}))


# ------------------------------------------------------------------ deploy / rollback
def step_api(m, rollback):
    run(express_compose(m, rollback) + ['up', '-d', '--no-deps', '--no-build', API])
    wait_healthy(API)
    assert inspect(API)['RestartCount'] == 0, 'express restarted'
    assert http('http://127.0.0.1:3000/api/health')[0] == 200
    if not rollback:
        assert http('http://127.0.0.1:3000/api/v1/desktop/update?current=0.0.1')[0] == 401, 'update route should require credentials'
        assert http('http://127.0.0.1:3000/api/desktop-device/lookup', 'POST', b'{"user_code":"ABCD2345"}', {'Content-Type': 'application/json'})[0] == 401
    # Per AGENTS.md: regenerate and re-validate the persistent snapshot after an express deploy.
    run(['python3', '-I', str(REPO / 'scripts/snapshot_express_compose.py'), 'generate'])
    text, ok = express_validate()
    assert ok, 'snapshot validate after deploy: ' + text


def step_gateway(m, rollback):
    cmd, env = gateway_compose(m, rollback)
    run(cmd + ['up', '-d', '--force-recreate'], env=env)
    wait_healthy(CONTROL)
    wait_healthy(MEDIA)
    c, md = f"http://127.0.0.1:{m['gateway']['control_port']}", f"http://127.0.0.1:{m['gateway']['media_port']}"
    assert http(c + '/gateway/health')[0] == 200 and http(md + '/media/health')[0] == 200
    assert http(c + '/api/v1/frames')[0] == 200, 'existing control route broke'
    new_status = 404 if rollback else 401
    assert http(c + '/api/v1/desktop/update?current=0.0.1')[0] == new_status
    assert http(md + '/api/v1/desktop/update/download')[0] == new_status
    if not rollback:
        status, body = http(c + '/api/v1/desktop/device/code', 'POST', b'{"device_name":"deploy check"}', {'Content-Type': 'application/json'})
        assert status == 201 and json.loads(body)['data']['user_code'], 'device code route not reachable through the control gateway'


def step_web(m, rollback):
    run(web_compose(m, rollback) + ['up', '-d', '--no-deps', '--no-build', WEB])
    wait_healthy(WEB)
    assert inspect(WEB)['RestartCount'] == 0
    expected = m['web']['old_index_sha256'] if rollback else m['web']['new_index_sha256']
    for path in ['/', '/create', '/admin', '/api/health', '/v2/', '/v2/admin/login', '/v2/kiosk/kiosk']:
        status, body = http('http://127.0.0.1:3000' + path)
        assert status == 200, f'{path} -> {status}'
        if path == '/':
            assert hashlib.sha256(body).hexdigest() == expected
    status, body = http('http://127.0.0.1:3000/kiosk-activate.html')
    assert (status == 200 and b'Aktifkan kiosk' in body) != rollback, 'activation page state is wrong'


STEPS = [('api', step_api), ('gateway', step_gateway), ('web', step_web)]


def deploy(m, r):
    assert inspect(API)['Image'] == m['api']['previous_id'], 'Live express changed since prepare'
    assert inspect(WEB)['Image'] == m['web']['previous_id'], 'Live web changed since prepare'
    assert inspect(CONTROL)['Id'] == m['gateway']['control_id'] and inspect(MEDIA)['Id'] == m['gateway']['media_id'], 'Live gateways changed since prepare'
    text, ok = express_validate()
    assert ok, 'snapshot validate must be PASS:\n' + text
    done = []
    for name, step in STEPS:
        try:
            step(m, False)
            done.append(name)
            m['deployed'][name] = True
            (r / 'manifest.json').write_text(json.dumps(m, indent=2))
        except Exception as error:
            print(f'STEP {name} FAILED: {error}; rolling back {name} and earlier steps', file=sys.stderr)
            for undo in [n for n, _ in STEPS if n in done + [name]][::-1]:
                dict(STEPS)[undo](m, True)
                m['deployed'][undo] = False
            (r / 'manifest.json').write_text(json.dumps(m, indent=2))
            raise
    now = containers()
    changed = sorted(n for n, i in m['before'].items() if now.get(n) != i)
    assert set(changed) <= {API, WEB, CONTROL, MEDIA}, f'Unexpected containers changed: {changed}'
    print(json.dumps({'status': 'PASS', 'changed_containers': changed}))


def rollback(m, r):
    for name, step in STEPS[::-1]:
        if m['deployed'].get(name):
            step(m, True)
            m['deployed'][name] = False
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
        print(json.dumps({'release': str(r), 'deployed': m['deployed'], 'running': {k: v for k, v in containers().items() if k.startswith('photobooth-')}}, indent=2))
    elif action == 'deploy':
        deploy(m, r)
    else:
        rollback(m, r)


if __name__ == '__main__':
    main()
