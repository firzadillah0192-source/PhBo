"""Release: AI Provider Lab (admin-only) for photobooth-web and photobooth-express.

Patches only the changed files onto the currently running images (pattern of deploy_startup_stage.py and
deploy_customer_viewport.py). The worker, image helper, database and all other containers are untouched.
Express reads LAB_ENCRYPTION_KEY from /opt/photobooth/.env (env_file) when recreated. The SQL migration
backend/migrations/022_ai_provider_lab.sql is NOT applied by this script (separate owner approval + backup).
Usage: deploy_ai_lab.py prepare [--api-only]|deploy|rollback|status   (deploy/rollback need owner approval)
--api-only: express-only follow-up release; patches the files that differ from HEAD (git diff) onto the live source.
--incremental: follow-up release for express AND web; patches only the Lab files that differ from HEAD onto the live sources.
"""
import datetime, difflib, hashlib, json, os, re, shutil, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path

REPO = Path('/opt/photobooth')
RELEASES = Path('/srv/photobooth/releases')
POINTER = RELEASES / '.ai-lab-current'
SNAPSHOT = str(RELEASES / 'express-base/compose.express-base.json')
WEB, API = 'photobooth-web', 'photobooth-express'
API_MODIFIED = ['src/config/migration-env.ts', 'src/controllers/admin.controller.ts', 'src/routes/admin.routes.ts', 'src/migration-container.ts']
API_NEW = sorted(str(p.relative_to(REPO / 'backend-express')) for d in ('src/lab', 'src/lab-bridge') for p in (REPO / 'backend-express' / d).rglob('*.ts'))
WEB_MODIFIED = ['src/AdminPage.jsx', 'src/api.js', 'src/admin-retro.css', 'src/components/admin/AdminShell.jsx']
WEB_NEW = ['src/labModel.js', 'src/components/admin/AiProviderLab.jsx']


def run(args, **kw):
    return subprocess.run(args, check=True, **kw)


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]


def containers():
    return {v['Names']: v['ID'] for v in map(json.loads, subprocess.check_output(['docker', 'ps', '--format', '{{json .}}']).decode().splitlines())}


def git_head(path):
    r = subprocess.run(['git', '-C', str(REPO), 'show', f'HEAD:{path}'], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def apply_diff(base_text, new_path, target, log):
    diff = ''.join(difflib.unified_diff(base_text.splitlines(True), new_path.read_text().splitlines(True), fromfile=str(target), tofile=str(target)))
    assert diff, f'no change for {target}'
    run(['patch', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', str(target)], input=diff, text=True, stdout=log, stderr=subprocess.STDOUT)


def live_hash(path, image=None):
    cmd = ['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'cat', image] if image else ['docker', 'exec', WEB, 'cat']
    return hashlib.sha256(subprocess.check_output(cmd + [path])).hexdigest()


def preserved_hash(image=None):
    cmd = ['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'sh', image] if image else ['docker', 'exec', WEB, 'sh']
    return hashlib.sha256(subprocess.check_output(cmd + ['-c', 'find /usr/share/nginx/html/v2 /etc/nginx -type f -exec sha256sum {} \\; | sort'])).hexdigest()


def api_compose(m, rollback=False):
    key = dict(e.split('=', 1) for e in inspect('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY']
    os.environ['EXPRESS_IMAGE_ENGINE_KEY'] = key
    return ['docker', 'compose', '--project-directory', str(REPO), '--env-file', str(REPO / '.env'), '-f', SNAPSHOT, '-f', m['api_rollback'] if rollback else m['api_override']]


def web_compose(m, rollback=False):
    return ['docker', 'compose', '--project-name', 'photobooth', '--project-directory', str(REPO), '-f', m['web_base'], '-f', m['web_rollback'] if rollback else m['web_override']]


def changed_api_files():
    out = lambda *a: subprocess.check_output(['git', '-C', str(REPO), *a], text=True).split()
    mod = [f.removeprefix('backend-express/') for f in out('diff', '--name-only', 'HEAD', '--', 'backend-express/src')]
    new = [f.removeprefix('backend-express/') for f in out('ls-files', '--others', '--exclude-standard', '--', 'backend-express/src')]
    return mod, new


WEB_PATHSPEC = ['frontend/src/api.js', 'frontend/src/admin-retro.css', 'frontend/src/components/admin', 'frontend/src/labModel.js', 'frontend/src/labModel.test.js']


def changed_web_files():
    out = lambda *a: subprocess.check_output(['git', '-C', str(REPO), *a], text=True).split()
    return ([f.removeprefix('frontend/') for f in out('diff', '--name-only', 'HEAD', '--', *WEB_PATHSPEC)],
            [f.removeprefix('frontend/') for f in out('ls-files', '--others', '--exclude-standard', '--', *WEB_PATHSPEC)])


def prepare(api_only=False, incremental=False):
    global API_MODIFIED, API_NEW, WEB_MODIFIED, WEB_NEW
    if incremental:
        WEB_MODIFIED, WEB_NEW = changed_web_files()
        print('web files:', WEB_MODIFIED + WEB_NEW)
    if api_only or incremental:
        API_MODIFIED, API_NEW = changed_api_files()
        assert API_MODIFIED or API_NEW, 'nothing to deploy'
        print('api files:', API_MODIFIED + API_NEW)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    r = RELEASES / f'ai-lab-{stamp}'
    r.mkdir()
    web, api = inspect(WEB), inspect(API)
    assert web['State']['Health']['Status'] == 'healthy' and api['State']['Health']['Status'] == 'healthy', 'live containers unhealthy'
    # ---- express: patch changed files onto the live source, compile, build a thin image
    src = r / 'api-source'
    src.mkdir()
    for f in ['src', 'prisma', 'package.json', 'tsconfig.json', 'tsconfig.build.json']:
        run(['docker', 'cp', f'{API}:/app/{f}', str(src / f)], stdout=subprocess.DEVNULL)
    with (r / 'api-patch.log').open('w') as log:
        for f in API_MODIFIED:
            if f.startswith(('src/lab/', 'src/lab-bridge/')):  # Lab-owned files: replace the whole file (live may be ahead of the last commit)
                shutil.copy2(REPO / 'backend-express' / f, src / f)
                continue
            if (src / f).read_text() == (REPO / 'backend-express' / f).read_text():  # already live (deployed before it was committed)
                continue
            base = git_head(f'backend-express/{f}')
            assert base is not None
            apply_diff(base, REPO / 'backend-express' / f, src / f, log)
        for f in API_NEW:
            (src / f).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(REPO / 'backend-express' / f, src / f)
    (src / 'node_modules').symlink_to(REPO / 'backend-express/node_modules')
    with (r / 'api-compile.log').open('w') as f:
        run(['node', str(REPO / 'backend-express/node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], cwd=src, stdout=f, stderr=subprocess.STDOUT)
    ctx = r / 'api-image'
    for f in API_MODIFIED + API_NEW:
        js = Path('dist') / Path(f).relative_to('src').with_suffix('.js')
        for rel in (Path(f), js, Path(str(js) + '.map')):
            (ctx / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src / rel, ctx / rel)
    api_image = f'photobooth-express:ai-lab-{stamp}'
    (ctx / 'Dockerfile').write_text(f"FROM {api['Config']['Image']}\nCOPY src/ /app/src/\nCOPY dist/ /app/dist/\n")
    m_web = {}
    if not api_only:
        # ---- web: overlay the admin files on the source snapshot that matches the live bundle
        old_hash = live_hash('/usr/share/nginx/html/index.html')
        source = next((p.parent.parent for p in sorted(RELEASES.glob('*/frontend/dist/index.html'), reverse=True) if hashlib.sha256(p.read_bytes()).hexdigest() == old_hash), None)
        assert source, 'No source snapshot matches the live web HTML'
        target = r / 'frontend'
        shutil.copytree(source, target, ignore=shutil.ignore_patterns('node_modules', 'dist', '.env*', '.vite'))
        with (r / 'web-patch.log').open('w') as log:
            for f in WEB_MODIFIED:
                if f in ('src/components/admin/AiProviderLab.jsx', 'src/labModel.js', 'src/labModel.test.js'):  # Lab-owned files
                    shutil.copy2(REPO / 'frontend' / f, target / f)
                    continue
                if (target / f).read_text() == (REPO / 'frontend' / f).read_text():  # already live (deployed before it was committed)
                    continue
                apply_diff(git_head(f'frontend/{f}'), REPO / 'frontend' / f, target / f, log)
            for f in WEB_NEW:
                assert not (target / f).exists()
                shutil.copy2(REPO / 'frontend' / f, target / f)
        (target / 'node_modules').symlink_to(REPO / 'frontend/node_modules')
        fixtures = r / 'backend/app/data'  # read by classicThemes.test.js relative to the snapshot
        fixtures.mkdir(parents=True)
        for name in ['classic_event_frames.json', 'classic_original_strip_frames.json', 'classic_print_profile.json']:
            shutil.copy2(REPO / 'backend/app/data' / name, fixtures / name)
        (r / 'templates').symlink_to(REPO / 'templates')
        assets = subprocess.check_output(['docker', 'exec', WEB, 'sh', '-c', 'cat /usr/share/nginx/html/assets/*.js']).decode()
        ids = set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', assets))
        assert len(ids) == 1, 'Could not preserve public Google configuration'
        cfg = dict(v.split('=', 1) for v in api['Config']['Env'] if '=' in v)
        env = {**os.environ, 'VITE_GOOGLE_CLIENT_ID': next(iter(ids)), 'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN': cfg.get('POSTHOG_PROJECT_TOKEN', ''), 'VITE_PUBLIC_POSTHOG_HOST': cfg.get('POSTHOG_HOST', '')}
        for cmd, name in [(['npm', 'test'], 'web-tests'), (['npm', 'run', 'build'], 'web-build')]:
            with (r / f'{name}.log').open('w') as f:
                run(cmd, cwd=target, env=env, stdout=f, stderr=subprocess.STDOUT)
        assert 'AI Provider Lab' in ''.join(p.read_text(errors='ignore') for p in (target / 'dist/assets').glob('*.js')), 'Lab missing from bundle'
        wctx = r / 'web-image'
        wctx.mkdir()
        shutil.copytree(target / 'dist', wctx / 'dist', ignore=shutil.ignore_patterns('*.map'))
        (wctx / 'Dockerfile').write_text('FROM ' + web['Config']['Image'] + '\nCOPY dist/ /usr/share/nginx/html/\n')
        web_image = f'photobooth-web:ai-lab-{stamp}'
        hc = web['Config']['Healthcheck']
        health = {'test': hc['Test'], 'retries': hc['Retries']}
        for k, n in {'Interval': 'interval', 'Timeout': 'timeout', 'StartPeriod': 'start_period', 'StartInterval': 'start_interval'}.items():
            if k in hc:
                health[n] = str(hc[k]) + 'ns'
        web_base = r / 'compose.web-base.json'
        web_base.write_text(json.dumps({'services': {WEB: {'image': web['Config']['Image'], 'container_name': WEB, 'restart': 'unless-stopped', 'ports': ['3000:80'], 'networks': ['photobooth'], 'healthcheck': health}},
                                        'networks': {'photobooth': {'external': True, 'name': 'photobooth-net'}}}, indent=2))
    else:
        old_hash = web_image = None
    files = {'api_override': ('compose.ai-lab-api.yml', f'services:\n  {API}:\n    image: {api_image}\n'),
             'api_rollback': ('compose.rollback-api.yml', f"services:\n  {API}:\n    image: {api['Config']['Image']}\n")}
    m = {'release': str(r), 'api_image': api_image, 'api_previous': api['Config']['Image'], 'api_previous_id': api['Image'], 'api_only': api_only,
         'before': containers(), 'deployed': False}
    if not api_only:
        files |= {'web_override': ('compose.ai-lab-web.yml', f'services:\n  {WEB}:\n    image: {web_image}\n'),
                  'web_rollback': ('compose.rollback-web.yml', f"services:\n  {WEB}:\n    image: {web['Config']['Image']}\n")}
        m |= {'web_image': web_image, 'web_previous': web['Config']['Image'], 'web_previous_id': web['Image'], 'web_base': str(web_base),
              'preserved_sha256': preserved_hash(), 'old_index_sha256': old_hash, 'new_index_sha256': hashlib.sha256((target / 'dist/index.html').read_bytes()).hexdigest()}
    for k, (name, text) in files.items():
        (r / name).write_text(text)
        m[k] = str(r / name)
    (r / 'manifest.json').write_text(json.dumps(m, indent=2))
    run(api_compose(m) + ['config', '--quiet'])
    builds = [('api', api_image, ctx)]
    if not api_only:
        run(web_compose(m) + ['config', '--quiet'])
        builds.append(('web', web_image, wctx))
    for name, image, context in builds:
        with (r / f'{name}-docker-build.log').open('w') as f:
            run(['docker', 'build', '-t', image, str(context)], stdout=f, stderr=subprocess.STDOUT)
    if not api_only:
        run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'nginx', web_image, '-t'])
        assert preserved_hash(web_image) == m['preserved_sha256'], 'v2 or nginx changed'
    # the new express image must at least load the compiled Lab modules
    run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node', api_image, '-e', "import('/app/dist/lab/service.js').then(()=>import('/app/dist/lab-bridge/nx-scenarios.js')).then(()=>console.log('lab modules load'))"])
    POINTER.write_text(str(r))
    print(json.dumps({'status': 'PASS', 'release': str(r), 'deployed': False}))


def wait_healthy(name, seconds=90):
    for _ in range(seconds):
        i = inspect(name)
        if i['State']['Status'] == 'running' and i['State'].get('Health', {}).get('Status') == 'healthy':
            return i
        time.sleep(1)
    raise RuntimeError(f'{name} did not become healthy')


def get(path, expect=200):
    try:
        with urllib.request.urlopen('http://127.0.0.1:3000' + path, timeout=20) as resp:
            assert resp.status == expect, (path, resp.status)
            return resp.read()
    except urllib.error.HTTPError as e:
        assert e.code == expect, (path, e.code)
        return b''


def verify(m, rollback=False):
    wait_healthy(API); wait_healthy(WEB)
    assert inspect(API)['RestartCount'] == 0 and inspect(WEB)['RestartCount'] == 0, 'restart loop'
    if not m.get('api_only'):
        assert preserved_hash() == m['preserved_sha256'], 'v2 or nginx changed'
        expected = m['old_index_sha256'] if rollback else m['new_index_sha256']
        assert live_hash('/usr/share/nginx/html/index.html') == expected
    for p in ['/', '/create', '/admin', '/api/health', '/v2/']:
        get(p)
    get('/api/admin/lab/overview', 404 if rollback and not m.get('api_only') else 401)  # guarded when present
    now = containers()
    changed = [n for n, i in m['before'].items() if now.get(n) != i]
    assert set(changed) <= ({API} if m.get('api_only') else {WEB, API}), 'Other containers changed: ' + str(changed)
    print(json.dumps({'status': 'PASS', 'changed_containers': changed}))


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else ''
    if action == 'prepare':
        return prepare('--api-only' in sys.argv, '--incremental' in sys.argv)
    r = Path(POINTER.read_text().strip())
    m = json.loads((r / 'manifest.json').read_text())
    if action == 'deploy':
        assert inspect(API)['Image'] == m['api_previous_id'] and (m.get('api_only') or inspect(WEB)['Image'] == m['web_previous_id']), 'Live release changed since prepare'
        run(api_compose(m) + ['up', '-d', '--no-deps', '--no-build', API])
        try:
            wait_healthy(API)
        except Exception:
            run(api_compose(m, True) + ['up', '-d', '--no-deps', '--no-build', API])
            raise
        if not m.get('api_only'):
            run(web_compose(m) + ['up', '-d', '--no-deps', '--no-build', WEB])
        verify(m)
        m['deployed'] = True
    elif action == 'rollback':
        run(api_compose(m, True) + ['up', '-d', '--no-deps', '--no-build', API])
        if not m.get('api_only'):
            run(web_compose(m, True) + ['up', '-d', '--no-deps', '--no-build', WEB])
        verify(m, True)
        m['deployed'] = False
    elif action != 'status':
        raise SystemExit('Use prepare/deploy/rollback/status')
    (r / 'manifest.json').write_text(json.dumps(m, indent=2))
    run(api_compose(m) + ['ps', API])


if __name__ == '__main__':
    main()
