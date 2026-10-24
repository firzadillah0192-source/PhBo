"""Deploy prepared Duitku Sandbox API/web after explicit owner approval.

Backs up metadata, applies only additive SQL023, and retains persistent rollback.
Never touches worker/helper/provider, customer photos, or other compose projects.
Usage: python3 -I scripts/deploy_duitku_sandbox.py deploy|repair-transport|rollback|status
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

REPO = Path('/opt/photobooth')
RELEASES = Path('/srv/photobooth/releases')
POINTER = RELEASES / '.duitku-sandbox-prepared'
SNAPSHOT = RELEASES / 'express-base/compose.express-base.json'
TARGETS = ['photobooth-express', 'photobooth-web']


def run(args, **kwargs): return subprocess.run(args, check=True, **kwargs)
def inspect(name): return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
def save(path, data): path.write_text(json.dumps(data, indent=2) + '\n')


def containers():
    return {row['Names']: row['ID'] for row in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())}


def validate_snapshot():
    result = subprocess.run([sys.executable,'-I',str(REPO/'scripts/snapshot_express_compose.py'),'validate'],capture_output=True,text=True)
    assert result.returncode == 0 and json.loads(result.stdout)['status'] == 'PASS', 'Express snapshot validation failed'


def regenerate():
    run([sys.executable,'-I',str(REPO/'scripts/snapshot_express_compose.py'),'generate'])
    validate_snapshot()


def compose(release, rollback=False):
    helper = inspect('photobooth-image-helper')
    key = dict(value.split('=',1) for value in helper['Config']['Env'] if '=' in value)['AI_ENGINE_API_KEY']
    env = {**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':key}
    args = ['docker','compose','--project-name','photobooth','--project-directory',str(REPO),'--env-file',str(REPO/'.env'),
        '-f',str(release/'compose.express-before.json'),'-f',str(release/'compose.web-base.json'),
        '-f',str(release/('compose.rollback.json' if rollback else 'compose.duitku-sandbox.json'))]
    return args,env


def verify_compose(release, manifest):
    args,env = compose(release)
    data = json.loads(subprocess.check_output(args+['config','--format','json'],env=env))['services']
    allowed = {'DUITKU_ENABLED','DUITKU_ENVIRONMENT','DUITKU_MERCHANT_CODE','DUITKU_API_KEY','DUITKU_PUBLIC_ORIGIN'}
    for name in TARGETS:
        actual=inspect(name); config=data[name]
        baked=json.loads(subprocess.check_output(['docker','image','inspect',manifest['images'][name]]))[0]['Config']
        assert config['image']==manifest['images'][name], 'Candidate image mismatch'
        assert config.get('container_name')==name, 'Container name mismatch'
        assert config.get('working_dir',baked.get('WorkingDir',''))==actual['Config'].get('WorkingDir',''), 'Workdir mismatch'
        assert config.get('user',baked.get('User',''))==actual['Config'].get('User',''), 'User mismatch'
        # Compose normalizes binds; compare the actual resolved runtime projection.
        live_mounts={(x['Source'],x['Destination'],x['RW']) for x in actual['Mounts']}
        want_mounts={(x['source'],x['target'],not x.get('read_only',False)) for x in config.get('volumes',[])}
        assert live_mounts==want_mounts, 'Mount mismatch'
        run_env=dict(x.split('=',1) for x in actual['Config'].get('Env',[]))
        desired=config.get('environment',{})
        for key,value in desired.items():
            if key not in allowed: assert run_env.get(key)==value, 'Environment drift: '+key
        if name=='photobooth-express':
            assert desired['DUITKU_ENABLED']=='true' and desired['DUITKU_ENVIRONMENT']=='sandbox'
            assert desired['DUITKU_MERCHANT_CODE'] and desired['DUITKU_API_KEY'], 'Missing private Sandbox credentials'
        assert set(actual['NetworkSettings']['Networks'])=={'photobooth-net'}, 'Unexpected network'
    run(args+['config','--quiet'],env=env)


def healthy():
    deadline=time.monotonic()+120
    while time.monotonic()<deadline:
        ready=True
        for name in TARGETS:
            value=inspect(name)
            if value['State']['Status']!='running' or value['RestartCount']:
                if value['RestartCount']: raise RuntimeError(name+' restarted')
                ready=False
            if value['State'].get('Health',{}).get('Status')!='healthy': ready=False
        if ready: return
        time.sleep(1)
    raise RuntimeError('API/web readiness timeout')


def smoke():
    for path,expected in [('/api/health',200),('/payment-return.html',200),('/payment-return.js',200),('/api/account/topups',401),('/api/admin/payments',401)]:
        try:
            with urllib.request.urlopen('http://127.0.0.1:3000'+path,timeout=15) as response:
                status=response.status
                if path=='/api/health': assert json.load(response)['status']=='ok','Dependency health degraded'
        except urllib.error.HTTPError as error: status=error.code
        assert status==expected, 'Web smoke failed: '+path


def rollback(release, manifest):
    args,env=compose(release,True)
    run(args+['config','--quiet'],env=env)
    run(args+['up','-d','--no-deps','--no-build',*TARGETS],env=env)
    healthy();regenerate()
    manifest['status']='ROLLED_BACK';manifest['deployed']=False
    manifest['rollback_at']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    save(release/'manifest.json',manifest)
    print(json.dumps({'status':'ROLLED_BACK','release':str(release),'additive_table_retained':True}))


def deploy(release, manifest):
    validate_snapshot()
    assert not manifest.get('deployed'), 'Release already deployed'
    for name in TARGETS:
        assert inspect(name)['Id']==manifest['previous_container_ids'][name], 'Live container changed since preparation: '+name
    if not (release/'compose.express-before.json').exists(): shutil.copy2(SNAPSHOT,release/'compose.express-before.json')
    verify_compose(release,manifest)
    before=containers();manifest['before_containers']=before
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup=Path('/srv/photobooth/backups')/('pre-duitku-sandbox-'+stamp+'.dump')
    backup.parent.mkdir(exist_ok=True)
    with backup.open('xb') as target:
        os.chmod(backup,0o600)
        run(['docker','exec','photobooth-postgres','sh','-c','exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],stdout=target)
    assert backup.stat().st_size>1024,'Empty DB backup'
    with backup.open('rb') as source:
        listing=subprocess.check_output(['docker','exec','-i','photobooth-postgres','pg_restore','--list'],stdin=source)
    assert b'TABLE DATA' in listing,'Backup archive invalid'
    manifest['backup']={'path':str(backup),'sha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'bytes':backup.stat().st_size,'verified':True}
    save(release/'manifest.json',manifest)
    sql=release/'023_duitku_sandbox_payments.sql'
    assert sql.read_bytes()==(REPO/'backend/migrations/023_duitku_sandbox_payments.sql').read_bytes(),'Migration changed since preparation'
    with (release/'migration.log').open('w') as log:
        run(['docker','exec','-i','photobooth-postgres','sh','-c','exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction'],input=sql.read_bytes(),stdout=log,stderr=subprocess.STDOUT)
    manifest['production_sql_applied']=True;manifest['migration_sha256']=hashlib.sha256(sql.read_bytes()).hexdigest()
    save(release/'manifest.json',manifest)
    args,env=compose(release)
    try:
        run(args+['config','--quiet'],env=env)
        run(args+['up','-d','--no-deps','--no-build',*TARGETS],env=env)
        healthy();smoke();regenerate()
        after=containers()
        changed=[name for name,value in before.items() if after.get(name)!=value]
        assert set(changed)==set(TARGETS),'Unexpected changed containers: '+','.join(changed)
        manifest.update(status='DEPLOYED',deployed=True,deployed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),changed_containers=changed)
        save(release/'manifest.json',manifest)
        run(args+['ps',*TARGETS],env=env)
        print(json.dumps({'status':'PASS','release':str(release),'backup':str(backup),'changed_containers':changed,'sandbox_only':True}))
    except Exception:
        rollback(release,manifest)
        raise


def repair_transport(release, manifest):
    """Correct issues found during this authorized deployment's live acceptance."""
    validate_snapshot()
    api='photobooth-express'
    assert manifest.get('deployed') and inspect(api)['Config']['Image']==manifest['images'][api], 'Live API changed'
    assert not manifest.get('transport_repair'), 'Transport repair already applied'
    files=['src/services/duitku-sandbox.service.ts','src/services/payment.service.ts','src/models/payment.model.ts']
    source=release/'api-source';context=release/'api-image'
    with (release/'transport-repair.log').open('w') as log:
        for name in files: shutil.copy2(REPO/'backend-express'/name,source/name)
        shutil.copy2(REPO/'backend-express/test/duitku-payment.test.ts',source/'test/duitku-payment.test.ts')
        run(['node',str(REPO/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=source,stdout=log,stderr=subprocess.STDOUT)
        run(['node','--import','tsx','--test','test/duitku-payment.test.ts'],cwd=source,stdout=log,stderr=subprocess.STDOUT)
        for name in files:
            js=Path('dist')/Path(name).relative_to('src').with_suffix('.js')
            for rel in [Path(name),js,Path(str(js)+'.map')]: shutil.copy2(source/rel,context/rel)
        previous=manifest['images'][api];image=previous+'-transport1'
        run(['docker','build','--network','none','-t',image,str(context)],stdout=log,stderr=subprocess.STDOUT)
    before=containers()
    override_path=release/'compose.duitku-sandbox.json';override=json.loads(override_path.read_text())
    override['services'][api]['image']=image;save(override_path,override)
    manifest['images'][api]=image
    args,env=compose(release)
    try:
        run(args+['config','--quiet'],env=env)
        run(args+['up','-d','--no-deps','--no-build',api],env=env)
        healthy();smoke();regenerate()
        changed=[name for name,value in before.items() if containers().get(name)!=value]
        assert changed==[api], 'Unexpected container change during repair'
        manifest['transport_repair']={'previous_candidate':previous,'image':image,'files':files,'deployed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
        for name in files: manifest['source_sha256']['backend-express/'+name]=hashlib.sha256((REPO/'backend-express'/name).read_bytes()).hexdigest()
        save(release/'manifest.json',manifest)
        print(json.dumps({'status':'PASS','transport_repair':True,'image':image}))
    except Exception:
        rollback(release,manifest)
        raise


if __name__=='__main__':
    release=Path(POINTER.read_text().strip());manifest=json.loads((release/'manifest.json').read_text())
    action=sys.argv[1] if len(sys.argv)>1 else ''
    if action=='deploy': deploy(release,manifest)
    elif action=='repair-transport': repair_transport(release,manifest)
    elif action=='rollback': rollback(release,manifest)
    elif action=='status': print(json.dumps({k:manifest.get(k) for k in ['release','status','deployed','production_sql_applied','images','backup']},indent=2))
    else: raise SystemExit('Use deploy|rollback|status. Deployment requires explicit owner approval.')
