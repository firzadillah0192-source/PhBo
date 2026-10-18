"""Stage/deploy the customer UI redesign (natural scroll, side panels, ID/EN language) over the live web image.

Only photobooth-web changes. Source is the live release snapshot plus the UI files listed below;
unrelated working-tree changes (api.js, customerSession.js, pricing, admin) are NOT shipped.
Usage: prepare | deploy | rollback | status. Owner approval is required for deploy.
"""
import argparse, datetime, hashlib, importlib.util, json, os, re, shutil, subprocess
from pathlib import Path

REPO = Path('/opt/photobooth')
RELEASES = Path('/srv/photobooth/releases')
POINTER = RELEASES / '.customer-ui-current'
spec = importlib.util.spec_from_file_location('viewport', REPO / 'scripts/deploy_customer_viewport.py')
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
C = 'src/components/customer/'
FILES = ['src/main.jsx', 'src/App.jsx', 'src/cameraAccess.js', 'src/generationMessages.js', 'src/i18n.js', 'src/i18n.test.js',
    'src/customerLayout.css', 'src/landing.test.js', 'src/threeModes.test.js', 'scripts/customer-viewport-check.mjs',
    *[C + n + '.jsx' for n in ['CustomerNav', 'PhotoStage', 'ReviewStage', 'ProcessingStage', 'ResultStage', 'AdvancedOptionsStage',
        'ModePickerModal', 'StudioModal', 'ClassicCaptureStage', 'AccountCenter', 'SubscriptionPlans', 'PaymentHistory', 'CreditTopUp',
        'CreditTopUpModal', 'PublicResultPage', 'StudioRail', 'LanguageSwitch']],
    *['src/components/home/' + n + '.jsx' for n in ['LandingPage', 'ModeCards', 'CreationChooser', 'LandingReel']]]
REMOVE = [C + 'ProgressRail.jsx']
# Codex's optional review "event name" field needs a backend that is not live yet: leave it out of this release.
STRIP = (re.compile(r' eventName=\{eventName\} onEventNameChange=\{value => \{ setEventName\(value\); updateCustomerFlow\(\{ eventName: value\.trim\(\) \|\| null \}\) \}\}'), '')


def prepare(only=None):
    global FILES, REMOVE
    if only: FILES, REMOVE = only, []
    web = v.inspect(v.WEB)
    assert web['State'].get('Health', {}).get('Status') == 'healthy', 'Live web is unhealthy'
    old_hash = v.live_hash('/usr/share/nginx/html/index.html')
    source = next((p.parent.parent for p in sorted(RELEASES.glob('*/frontend/dist/index.html'), reverse=True)
        if hashlib.sha256(p.read_bytes()).hexdigest() == old_hash), None)
    assert source, 'No source snapshot matches live HTML'
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release = RELEASES / ('customer-ui-' + stamp); release.mkdir()
    target = release / 'frontend'
    shutil.copytree(source / 'frontend' if (source / 'frontend').is_dir() else source, target,
        ignore=shutil.ignore_patterns('node_modules', 'dist', '.env*', '.vite'), symlinks=True)
    for name in FILES:
        dest = target / name; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(REPO / 'frontend' / name, dest)
    if 'src/App.jsx' in FILES:
        app = target / 'src/App.jsx'; text = app.read_text(); text, n = STRIP[0].subn(STRIP[1], text); assert n == 1, 'event-name prop not found'; app.write_text(text)
    for name in REMOVE: (target / name).unlink(missing_ok=True)
    (target / 'node_modules').symlink_to(REPO / 'frontend/node_modules')
    fixtures = release / 'backend/app/data'; fixtures.mkdir(parents=True)
    for name in ['classic_event_frames.json', 'classic_original_strip_frames.json', 'classic_print_profile.json']:
        shutil.copy2(REPO / 'backend/app/data' / name, fixtures / name)
    (release / 'templates').symlink_to(REPO / 'templates')
    assets = subprocess.check_output(['docker', 'exec', v.WEB, 'sh', '-c', 'cat /usr/share/nginx/html/assets/*.js']).decode()
    ids = set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com', assets)); assert len(ids) == 1
    api = dict(x.split('=', 1) for x in v.inspect('photobooth-express')['Config']['Env'] if '=' in x)
    env = {**os.environ, 'VITE_GOOGLE_CLIENT_ID': next(iter(ids)), 'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN': api.get('POSTHOG_PROJECT_TOKEN', ''),
        'VITE_PUBLIC_POSTHOG_HOST': api.get('POSTHOG_HOST', ''), 'NXBOOTH_PLAYWRIGHT_MODULE': str(REPO / 'frontend-enhanced/node_modules/playwright/index.mjs')}
    for cmd, name in [(['npm', 'test'], 'tests'), (['npm', 'run', 'build'], 'build'), (['node', 'scripts/customer-viewport-check.mjs'], 'browser')]:
        with (release / (name + '.log')).open('w') as out: v.run(cmd, cwd=target, env=env, stdout=out, stderr=subprocess.STDOUT)
    ctx = release / 'web-image'; ctx.mkdir()
    shutil.copytree(target / 'dist', ctx / 'dist', ignore=shutil.ignore_patterns('*.map'))
    (ctx / 'Dockerfile').write_text('FROM ' + web['Config']['Image'] + '\nCOPY dist/ /usr/share/nginx/html/\n')
    image = 'photobooth-web:customer-ui-' + stamp
    hc = web['Config']['Healthcheck']; health = {'test': hc['Test'], 'retries': hc['Retries']}
    for k, n in [('Interval', 'interval'), ('Timeout', 'timeout'), ('StartPeriod', 'start_period'), ('StartInterval', 'start_interval')]:
        if k in hc: health[n] = str(hc[k]) + 'ns'
    base = release / 'compose.web-base.json'
    base.write_text(json.dumps({'services': {v.WEB: {'image': web['Config']['Image'], 'container_name': v.WEB, 'restart': 'unless-stopped',
        'ports': ['3000:80'], 'networks': ['photobooth'], 'healthcheck': health}}, 'networks': {'photobooth': {'external': True, 'name': 'photobooth-net'}}}, indent=2))
    override = release / 'compose.customer-ui.yml'; rollback = release / 'compose.rollback.yml'
    override.write_text('services:\n  photobooth-web:\n    image: ' + image + '\n')
    rollback.write_text('services:\n  photobooth-web:\n    image: ' + web['Config']['Image'] + '\n')
    m = {'release': str(release), 'image': image, 'previous_image': web['Config']['Image'], 'previous_id': web['Image'], 'source_snapshot': str(source),
        'base': str(base), 'override': str(override), 'rollback': str(rollback), 'before': v.containers(), 'preserved_sha256': v.preserved_hash(),
        'old_index_sha256': old_hash, 'new_index_sha256': hashlib.sha256((target / 'dist/index.html').read_bytes()).hexdigest(), 'changed_files': FILES, 'removed_files': REMOVE, 'deployed': False}
    (release / 'manifest.json').write_text(json.dumps(m, indent=2))
    v.run(v.compose(m) + ['config', '--quiet'])
    with (release / 'docker-build.log').open('w') as out: v.run(['docker', 'build', '-t', image, str(ctx)], stdout=out, stderr=subprocess.STDOUT)
    v.run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'nginx', image, '-t'])
    assert v.preserved_hash(image) == m['preserved_sha256'], 'v2 or nginx changed'
    assert v.live_hash('/usr/share/nginx/html/index.html', image) == m['new_index_sha256']
    POINTER.write_text(str(release)); print(json.dumps({'status': 'PASS', 'release': str(release), 'image': image, 'deployed': False}))


def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('action', choices=['prepare', 'deploy', 'rollback', 'status'])
    p.add_argument('--only', nargs='+', help='prepare: overlay only these frontend-relative files on the live source')
    a = p.parse_args(); action = a.action
    if action == 'prepare': return prepare(a.only)
    release = Path(POINTER.read_text().strip()); m = json.loads((release / 'manifest.json').read_text())
    cmd = v.compose(m, action == 'rollback'); v.run(cmd + ['config', '--quiet'])
    if action == 'deploy': assert v.inspect(v.WEB)['Image'] == m['previous_id'], 'Live web changed since prepare'
    if action in ['deploy', 'rollback']:
        v.run(cmd + ['up', '-d', '--no-deps', '--no-build', v.WEB]); v.verify(m, action == 'rollback')
        m['deployed'] = action == 'deploy'; m['last_action_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        (release / 'manifest.json').write_text(json.dumps(m, indent=2))
    v.run(cmd + ['ps', v.WEB])


if __name__ == '__main__': main()
