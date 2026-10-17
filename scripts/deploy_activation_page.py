"""Release: replace only /kiosk-activate.html in the live photobooth-web image.

Layers one static file on the RUNNING web image (nothing else in the image changes), keeps a rollback
override, and verifies the page and the rest of the site after the swap.

Usage: deploy_activation_page.py prepare|deploy|rollback|status
prepare builds and validates without touching production. deploy/rollback need explicit owner approval.
"""
import datetime, hashlib, json, shutil, subprocess, sys, time, urllib.request
from pathlib import Path

REPO = Path('/opt/photobooth')
RELEASES = Path('/srv/photobooth/releases')
POINTER = RELEASES / '.activation-page-current'
WEB = 'photobooth-web'
SOURCE = REPO / 'frontend/public/kiosk-activate.html'
URL = 'http://127.0.0.1:3000'


def run(args, **kw):
    return subprocess.run(args, check=True, **kw)


def out(args, **kw):
    return subprocess.check_output(args, **kw)


def inspect(name):
    return json.loads(out(['docker', 'inspect', name]))[0]


def http(path):
    try:
        with urllib.request.urlopen(URL + path, timeout=20) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def compose(m, rollback=False):
    return ['docker', 'compose', '--project-name', 'photobooth', '--project-directory', str(REPO), '-f', m['base'], '-f', m['rollback'] if rollback else m['override']]


def wait_healthy(seconds=90):
    for _ in range(seconds):
        s = inspect(WEB)['State']
        if s['Status'] == 'running' and s.get('Health', {}).get('Status') == 'healthy':
            return
        time.sleep(1)
    raise RuntimeError(f'{WEB} did not become healthy')


def prepare():
    web = inspect(WEB)
    assert web['State'].get('Health', {}).get('Status') == 'healthy', 'web is not healthy'
    page = SOURCE.read_text()
    assert 'data-cfasync="false"' in page and 'inputmode="latin"' not in page, 'unexpected page content'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    r = RELEASES / f'activation-page-{stamp}'
    ctx = r / 'web-image'
    ctx.mkdir(parents=True)
    shutil.copy2(SOURCE, ctx / 'kiosk-activate.html')
    image = f'photobooth-web:activation-page-{stamp}'
    (ctx / 'Dockerfile').write_text(f"FROM {web['Config']['Image']}\nCOPY kiosk-activate.html /usr/share/nginx/html/kiosk-activate.html\n")
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
    m = {'release': str(r), 'image': image, 'previous_image': web['Config']['Image'], 'previous_id': web['Image'], 'base': str(base), 'override': str(override),
         'rollback': str(rollback), 'page_sha256': hashlib.sha256(page.encode()).hexdigest(),
         'index_sha256': hashlib.sha256(http('/')[1]).hexdigest(), 'deployed': False}
    (r / 'manifest.json').write_text(json.dumps(m, indent=2))
    run(compose(m) + ['config', '--quiet'])
    with (r / 'docker-build.log').open('w') as f:
        run(['docker', 'build', '-t', image, str(ctx)], stdout=f, stderr=subprocess.STDOUT)
    run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'nginx', image, '-t'])
    POINTER.write_text(str(r))
    print(json.dumps({'status': 'PASS', 'release': str(r), 'image': image, 'deployed': False}))


def swap(m, rollback):
    run(compose(m, rollback) + ['up', '-d', '--no-deps', '--no-build', WEB])
    wait_healthy()
    assert inspect(WEB)['RestartCount'] == 0, 'web restarted'
    for path in ['/', '/create', '/admin', '/api/health', '/v2/', '/v2/admin/login', '/v2/kiosk/kiosk']:
        status, body = http(path)
        assert status == 200, f'{path} -> {status}'
        if path == '/':
            assert hashlib.sha256(body).hexdigest() == json.loads(Path(m['release'], 'manifest.json').read_text())['index_sha256'], 'site index changed'
    status, body = http('/kiosk-activate.html')
    assert status == 200 and b'Aktifkan kiosk' in body
    fixed = b'data-cfasync="false"' in body and b'inputmode="latin"' not in body
    assert fixed != rollback, 'activation page is not in the expected state'


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ''
    if action == 'prepare':
        return prepare()
    if action not in ('deploy', 'rollback', 'status'):
        raise SystemExit('Use prepare|deploy|rollback|status')
    r = Path(POINTER.read_text().strip())
    m = json.loads((r / 'manifest.json').read_text())
    if action == 'status':
        print(json.dumps({'release': str(r), 'deployed': m['deployed'], 'running_image': inspect(WEB)['Config']['Image']}, indent=2))
    elif action == 'deploy':
        assert inspect(WEB)['Image'] == m['previous_id'], 'Live web changed since prepare'
        try:
            swap(m, False)
        except Exception as error:
            print(f'FAILED: {error}; rolling back', file=sys.stderr)
            swap(m, True)
            raise
        m['deployed'] = True
        (r / 'manifest.json').write_text(json.dumps(m, indent=2))
        print(json.dumps({'status': 'PASS', 'image': m['image']}))
    else:
        swap(m, True)
        m['deployed'] = False
        (r / 'manifest.json').write_text(json.dumps(m, indent=2))
        print(json.dumps({'status': 'ROLLED_BACK'}))


if __name__ == '__main__':
    main()
