"""Prepare isolated Duitku API/web images from live sources; never deploy or migrate.

Usage: python3 -I scripts/prepare_duitku_sandbox.py prepare|status
Compose and rollback definitions are stored only in /srv/photobooth/releases/.
Shared dirty source files contribute payment-only patches, not whole-file copies.
"""
import datetime
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

REPO = Path('/opt/photobooth')
RELEASES = Path('/srv/photobooth/releases')
POINTER = RELEASES / '.duitku-sandbox-prepared'
SNAPSHOT = RELEASES / 'express-base/compose.express-base.json'
API_FILES = ['src/config/migration-env.ts', 'src/controllers/customer-account.controller.ts', 'src/services/customer-account.service.ts',
    'src/routes/customer-account.routes.ts', 'src/controllers/admin.controller.ts', 'src/routes/admin.routes.ts',
    'src/migration-container.ts', 'src/migration-app.ts', 'src/migration-server.ts', 'src/models/payment.model.ts',
    'src/services/payment.service.ts', 'src/services/duitku-sandbox.service.ts', 'src/routes/payment.routes.ts']
WEB_FILES = ['src/api.js', 'src/AdminPage.jsx', 'src/components/admin/AdminShell.jsx', 'src/components/admin/PaymentsPanel.jsx',
    'src/components/customer/CreditTopUp.jsx', 'src/components/customer/PaymentHistory.jsx', 'src/components/customer/SandboxTopUp.jsx',
    'public/payment-return.html', 'public/payment-return.css', 'public/payment-return.js']


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def baseline(path, current):
    if path == 'backend-express/src/migration-container.ts':
        # Reconstruct the pre-task file without discarding other agents' changes.
        text = '\n'.join(line for line in current.split('\n') if not line.startswith('import { PaymentModel }')
            and not line.startswith('import { PaymentService }') and not line.startswith('import { DuitkuSandboxGateway }')
            and not line.startswith('  const payments=new PaymentService('))
        return text.replace(',assets,payments);', ',assets);').replace(',previews,lab,payments};', ',previews,lab};')
    if path == 'frontend/src/api.js':
        text = current.split('\n// Payment reads deliberately bypass')[0]
        return re.sub(r'^export function createTopUpCheckout\(.*$',
            "export function createTopUpCheckout(credits) { return request('/account/topups/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credits }) }) }", text, flags=re.M)
    result = subprocess.run(['git', '-C', str(REPO), 'show', 'HEAD:' + path], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


def overlay(root, folder, files, log):
    for name in files:
        source = REPO / folder / name
        target = root / name
        current = source.read_text()
        before = baseline(folder + '/' + name, current)
        if before is None:
            assert not target.exists(), f'New task file already exists: {name}'
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(current)
        else:
            assert target.exists(), f'Live source missing: {name}'
            patch = ''.join(difflib.unified_diff(before.splitlines(True), current.splitlines(True), fromfile=name, tofile=name))
            assert patch, f'No task patch: {name}'
            # Context-only drift can be handled by patch offset. No fuzzy matching.
            run(['patch', '--batch', '--forward', '--fuzz=0', '--no-backup-if-mismatch', str(target)], input=patch,
                text=True, stdout=log, stderr=subprocess.STDOUT)


def prepare():
    run([sys.executable, '-I', str(REPO / 'scripts/snapshot_express_compose.py'), 'validate'])
    before = {name: inspect(name) for name in ['photobooth-express', 'photobooth-web']}
    for value in before.values():
        assert value['State'].get('Health', {}).get('Status') == 'healthy', 'Live service unhealthy'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = RELEASES / ('duitku-sandbox-prepared-' + stamp)
    release.mkdir()
    with (release / 'prepare.log').open('w') as log:
        api = release / 'api-source'; api.mkdir()
        for name in ['src', 'prisma', 'package.json', 'tsconfig.json', 'tsconfig.build.json']:
            run(['docker', 'cp', 'photobooth-express:/app/' + name, str(api / name)], stdout=log, stderr=subprocess.STDOUT)
        overlay(api, 'backend-express', API_FILES, log)
        (api / 'node_modules').symlink_to(REPO / 'backend-express/node_modules')
        run(['node', str(REPO / 'backend-express/node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], cwd=api, stdout=log, stderr=subprocess.STDOUT)
        (api / 'test').mkdir()
        shutil.copy2(REPO / 'backend-express/test/duitku-payment.test.ts', api / 'test/duitku-payment.test.ts')
        run(['node', '--import', 'tsx', '--test', 'test/duitku-payment.test.ts'], cwd=api, stdout=log, stderr=subprocess.STDOUT)
        api_context = release / 'api-image'; api_context.mkdir()
        for name in API_FILES:
            for path in [Path(name), Path('dist') / Path(name).relative_to('src').with_suffix('.js'), Path('dist') / Path(name).relative_to('src').with_suffix('.js.map')]:
                target = api_context / path; target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(api / path, target)
        (api_context / 'Dockerfile').write_text(f"FROM {before['photobooth-express']['Config']['Image']}\nCOPY src/ /app/src/\nCOPY dist/ /app/dist/\n")
        live_html = subprocess.check_output(['docker', 'exec', 'photobooth-web', 'cat', '/usr/share/nginx/html/index.html'])
        sources = sorted(RELEASES.glob('*/frontend/dist/index.html'), reverse=True)
        source = next((p.parent.parent for p in sources if hashlib.sha256(p.read_bytes()).digest() == hashlib.sha256(live_html).digest()), None)
        assert source, 'No frontend source snapshot matches live index.html'
        web = release / 'frontend'
        shutil.copytree(source, web, ignore=shutil.ignore_patterns('node_modules', 'dist', '.env*', '.vite'))
        overlay(web, 'frontend', WEB_FILES, log)
        (web / 'node_modules').symlink_to(REPO / 'frontend/node_modules')
        (release / 'templates').symlink_to(REPO / 'templates')
        data = release / 'backend/app/data'; data.mkdir(parents=True)
        for name in ['classic_event_frames.json', 'classic_original_strip_frames.json', 'classic_print_profile.json']:
            shutil.copy2(REPO / 'backend/app/data' / name, data / name)
        public_assets = subprocess.check_output(['docker', 'exec', 'photobooth-web', 'sh', '-c', 'cat /usr/share/nginx/html/assets/*.js']).decode()
        ids = set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', public_assets))
        assert len(ids) == 1, 'Could not preserve public Google client ID'
        environment = dict(v.split('=', 1) for v in before['photobooth-express']['Config']['Env'] if '=' in v)
        env = {**os.environ, 'VITE_GOOGLE_CLIENT_ID': next(iter(ids)), 'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN': environment.get('POSTHOG_PROJECT_TOKEN', ''), 'VITE_PUBLIC_POSTHOG_HOST': environment.get('POSTHOG_HOST', '')}
        run(['npm', 'run', 'build'], cwd=web, env=env, stdout=log, stderr=subprocess.STDOUT)
        web_context = release / 'web-image'; web_context.mkdir(); shutil.copytree(web / 'dist', web_context / 'dist')
        (web_context / 'Dockerfile').write_text(f"FROM {before['photobooth-web']['Config']['Image']}\nCOPY dist/ /usr/share/nginx/html/\n")
        web_base_source = source.parent / 'compose.web-base.json'
        assert web_base_source.is_file(), 'Missing persistent web base definition'
        shutil.copy2(web_base_source, release / 'compose.web-base.json')
        images = {'photobooth-express': 'photobooth-express:duitku-sandbox-' + stamp, 'photobooth-web': 'photobooth-web:duitku-sandbox-' + stamp}
        override = {'services': {name: {'image': tag} for name, tag in images.items()}}
        override['services']['photobooth-express']['environment'] = {'DUITKU_ENABLED': 'true', 'DUITKU_ENVIRONMENT': 'sandbox',
            'DUITKU_MERCHANT_CODE': '${DUITKU_MERCHANT_CODE:?Set privately in .env}', 'DUITKU_API_KEY': '${DUITKU_API_KEY:?Set privately in .env}',
            'DUITKU_PUBLIC_ORIGIN': 'https://nxbooth.gennexbyte.com'}
        (release / 'compose.duitku-sandbox.json').write_text(json.dumps(override, indent=2))
        rollback = {'services': {name: {'image': value['Config']['Image']} for name, value in before.items()}}
        (release / 'compose.rollback.json').write_text(json.dumps(rollback, indent=2))
        # Configuration is validated without printing resolved credentials.
        helper = inspect('photobooth-image-helper')
        engine_key = dict(v.split('=',1) for v in helper['Config']['Env'] if '=' in v)['AI_ENGINE_API_KEY']
        compose = ['docker', 'compose', '--project-name', 'photobooth', '--project-directory', str(REPO), '--env-file', str(REPO / '.env'),
            '-f', str(SNAPSHOT), '-f', str(release / 'compose.web-base.json'), '-f', str(release / 'compose.duitku-sandbox.json'), 'config', '--quiet']
        run(compose, env={**os.environ, 'EXPRESS_IMAGE_ENGINE_KEY': engine_key}, stdout=log, stderr=subprocess.STDOUT)
        for name, context in [('photobooth-express', api_context), ('photobooth-web', web_context)]:
            run(['docker', 'build', '--network', 'none', '-t', images[name], str(context)], stdout=log, stderr=subprocess.STDOUT)
    for name, value in before.items():
        assert inspect(name)['Id'] == value['Id'], 'Live service changed during preparation'
    shutil.copy2(REPO / 'backend/migrations/023_duitku_sandbox_payments.sql', release / '023_duitku_sandbox_payments.sql')
    manifest = {'release': str(release), 'status': 'PREPARED', 'deployed': False, 'production_sql_applied': False,
        'images': images, 'previous_images': {name: value['Config']['Image'] for name, value in before.items()},
        'previous_container_ids': {name: value['Id'] for name, value in before.items()}, 'frontend_source_snapshot': str(source),
        'changed_files': {'backend-express': API_FILES, 'frontend': WEB_FILES},
        'source_sha256': {folder + '/' + name: digest(REPO / folder / name) for folder, files in [('backend-express', API_FILES), ('frontend', WEB_FILES)] for name in files},
        'notes': ['Sandbox balances only; no production credit grants', 'Inherited /v2 files and nginx retained', 'No live Duitku transaction or external callback acceptance performed', 'Deploy/migration need separate owner approval and DB backup']}
    (release / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    POINTER.write_text(str(release))
    print(json.dumps({'status': 'PASS', 'release': str(release), 'deployed': False, 'production_sql_applied': False}))


if __name__ == '__main__':
    action = sys.argv[1] if len(sys.argv) > 1 else ''
    if action == 'prepare': prepare()
    elif action == 'status':
        if not POINTER.exists(): raise SystemExit('No prepared release')
        manifest = json.loads((Path(POINTER.read_text().strip()) / 'manifest.json').read_text())
        print(json.dumps({key: manifest[key] for key in ['status', 'release', 'deployed', 'production_sql_applied', 'images']}, indent=2))
    else: raise SystemExit('Use prepare|status. This tool never deploys or applies SQL.')
