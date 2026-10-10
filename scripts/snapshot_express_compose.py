"""Persistent compose definition for photobooth-express, -express-worker and -image-helper.

Why: the original definitions lived in ~9 override files under /tmp that vanished on reboot,
so a deploy would have recreated these containers without mounts, command or network.
`generate` writes a self-contained definition derived from the RUNNING containers;
`validate` proves the resolved compose config equals what is running. No secret values
are written: secrets are `${VAR}` placeholders resolved from /opt/photobooth/.env at deploy time
(AI_ENGINE_API_KEY comes from EXPRESS_IMAGE_ENGINE_KEY, read from the live helper by the deploy script).

Usage: snapshot_express_compose.py generate|validate
"""
import json, os, re, subprocess, sys
from pathlib import Path

REPO = Path('/opt/photobooth')
OUT = Path('/srv/photobooth/releases/express-base')
FILE = OUT / 'compose.express-base.json'
SERVICES = ['photobooth-express', 'photobooth-express-worker', 'photobooth-image-helper']
SECRET = re.compile(r'KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL|REDIS_URL', re.I)
DB_URL = 'postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@photobooth-postgres:5432/${POSTGRES_DB}'
FULL_ENV_FILE = {'photobooth-express', 'photobooth-express-worker'}  # the helper deliberately gets a subset


def dotenv():
    env = {}
    for line in (REPO / '.env').read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            env[k] = v.strip().strip('"').strip("'")
    return env


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]


def image_env(i):
    cfg = json.loads(subprocess.check_output(['docker', 'image', 'inspect', i['Image']]))[0]['Config']
    return dict(e.split('=', 1) for e in cfg.get('Env') or [])


def ns(d):  # healthcheck nanoseconds -> compose duration
    return f'{int(d / 1e9)}s'


def service_def(name, env_file):
    i = inspect(name)
    c, h = i['Config'], i['HostConfig']
    env = dict(e.split('=', 1) for e in c['Env'])
    baked = image_env(i)
    s = {'image': c['Image'], 'container_name': name, 'restart': h['RestartPolicy']['Name'],
         'user': c['User'], 'working_dir': c['WorkingDir'], 'command': c['Cmd'],
         'volumes': [b.replace(':rw', '') for b in h['Binds']],
         'networks': ['photobooth']}
    if h.get('ExtraHosts'):
        s['extra_hosts'] = [x.replace(':', '=', 1) for x in h['ExtraHosts']]
    hc = c.get('Healthcheck')
    if hc:
        s['healthcheck'] = {'test': hc['Test'], 'interval': ns(hc['Interval']), 'timeout': ns(hc['Timeout']),
                            'start_period': ns(hc['StartPeriod']), 'retries': hc['Retries']}
    dep = c['Labels'].get('com.docker.compose.depends_on', '')
    if dep:
        s['depends_on'] = {p.split(':')[0]: {'condition': p.split(':')[1]} for p in dep.split(',') if p}
    environment = {}
    for k, v in env.items():
        if k in baked and baked[k] == v:
            continue
        if k in env_file and env_file[k] == v and name not in FULL_ENV_FILE:
            environment[k] = '${%s-}' % k
        elif k == 'DATABASE_URL':
            assert v == DB_URL.replace('${POSTGRES_USER}', env_file['POSTGRES_USER']).replace('${POSTGRES_PASSWORD}', env_file['POSTGRES_PASSWORD']).replace('${POSTGRES_DB}', env_file['POSTGRES_DB'])
            environment[k] = DB_URL
        elif k == 'AI_ENGINE_API_KEY':
            environment[k] = '${EXPRESS_IMAGE_ENGINE_KEY:?set from the live image helper}'
        elif k in env_file and env_file[k] == v:
            pass  # supplied by env_file
        else:
            assert not SECRET.search(k), f'unhandled secret {k}'
            environment[k] = v
    if name in FULL_ENV_FILE:
        s['env_file'] = [str(REPO / '.env')]
    s['environment'] = dict(sorted(environment.items()))  # docker returns env in arbitrary order; keep diffs stable
    return s


def generate():
    env_file = dotenv()
    doc = {'services': {n: service_def(n, env_file) for n in SERVICES},
           'networks': {'photobooth': {'external': True, 'name': 'photobooth-net'}}}
    OUT.mkdir(parents=True, exist_ok=True)
    FILE.write_text(json.dumps(doc, indent=2) + '\n')
    assert not re.search(r'AKIA|sk-[A-Za-z0-9]{10}', FILE.read_text())
    print('written', FILE)


def compose_json():
    key = dict(e.split('=', 1) for e in inspect('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY']
    e = {**os.environ, 'EXPRESS_IMAGE_ENGINE_KEY': key}
    out = subprocess.check_output(['docker', 'compose', '--project-directory', str(REPO), '--env-file', str(REPO / '.env'),
                                   '-f', str(FILE), 'config', '--format', 'json'], env=e)
    return json.loads(out)['services']


def validate():
    cfg = compose_json()
    problems = []
    for n in SERVICES:
        c, i = cfg[n], inspect(n)
        cc, h = i['Config'], i['HostConfig']
        run_env = dict(x.split('=', 1) for x in cc['Env'])
        baked = image_env(i)
        want_env = {k: v for k, v in c.get('environment', {}).items()}
        for k, v in run_env.items():
            if baked.get(k) == v:
                continue
            if want_env.get(k) != v:
                problems.append(f'{n}: env {k} mismatch/missing')
        for k in want_env:
            if k not in run_env:
                problems.append(f'{n}: env {k} not in running container')
        checks = {
            'image': (c['image'], cc['Image']), 'user': (c.get('user'), cc['User']), 'workdir': (c.get('working_dir'), cc['WorkingDir']),
            'command': (c.get('command'), cc['Cmd']), 'restart': (c.get('restart'), h['RestartPolicy']['Name']),
            'volumes': (sorted((v['source'], v['target'], bool(v.get('read_only'))) for v in c['volumes']),
                        sorted((m['Source'], m['Destination'], not m['RW']) for m in i['Mounts'])),
            'extra_hosts': (sorted(c.get('extra_hosts', {}).items()) if isinstance(c.get('extra_hosts'), dict) else sorted(c.get('extra_hosts') or []),
                            sorted(tuple(x.split(':', 1)) for x in h.get('ExtraHosts') or [])),
            'network': (sorted(c['networks']), ['photobooth']),
        }
        checks['extra_hosts'] = (sorted(map(tuple, ([x.split('=', 1) for x in c['extra_hosts']] if isinstance(c.get('extra_hosts'), list) else c.get('extra_hosts', {}).items()))),
                                 sorted(tuple(x.split(':', 1)) for x in h.get('ExtraHosts') or []))
        for k, (a, b) in checks.items():
            if a != b:
                problems.append(f'{n}: {k} differs')
        hc = cc.get('Healthcheck')
        if bool(hc) != bool(c.get('healthcheck')):
            problems.append(f'{n}: healthcheck presence differs')
        elif hc and c['healthcheck']['test'] != hc['Test']:
            problems.append(f'{n}: healthcheck test differs')
        if i['NetworkSettings']['Networks'].keys() != {'photobooth-net'}:
            problems.append(f'{n}: running network set differs')
    print(json.dumps({'status': 'PASS' if not problems else 'FAIL', 'problems': problems}, indent=1))
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    {'generate': generate, 'validate': validate}[sys.argv[1]]()
