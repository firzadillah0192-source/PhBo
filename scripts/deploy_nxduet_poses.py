"""Patch NXDuet revision 2 (three poses, Classic frame, 3/4-body crop) onto live API/worker/web.

Baseline is the live NXDuet release (commit f74daf4). prepare builds/tests only and never
touches production. deploy backs up, applies reviewed additive SQL029, then activates;
it needs explicit owner approval. rollback drains preparations and keeps the additive schema
(the previous code still serves new templates using their first pose).
No secrets are persisted in manifests or Compose files.
"""
import datetime, difflib, hashlib, json, os, re, shutil, subprocess, sys, time, urllib.request
from pathlib import Path

R=Path('/opt/photobooth'); D=Path('/srv/photobooth/releases'); P=D/'.nxduet-poses-current'
SNAP=D/'express-base/compose.express-base.json'
BASE='f74daf4'
API=['migration-app.ts','migration-container.ts','models/subscription-wallet.model.ts','services/native-object-storage.service.ts']
WEB=['api.js']
WEB_NEW=['components/customer/DuetCamera.jsx','components/customer/NXDuet.jsx','components/customer/nxduet.css','duetGeometry.js','duetGeometry.test.js']
TARGETS=['photobooth-express','photobooth-express-worker','photobooth-web']

def run(args,**kw):return subprocess.run(args,check=True,**kw)
def out(args,**kw):return subprocess.check_output(args,**kw)
def inspect(name):return json.loads(out(['docker','inspect',name]))[0]
def env(name):return dict(v.split('=',1) for v in inspect(name)['Config']['Env'])
def save(p,m):(p/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
def snap(action):run([sys.executable,'-I',str(R/'scripts/snapshot_express_compose.py'),action])
def ids():return {v['Names']:v['ID'] for v in map(json.loads,out(['docker','ps','--format','{{json .}}']).decode().splitlines())}
def sql(query):return out(['docker','exec','-i','photobooth-postgres','sh','-c','exec psql -X -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],input=query.encode()).decode().strip()
def command(p,back=False):
    return ['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.express-before.json'),'-f',str(p/'compose.web-base.json'),'-f',str(p/('compose.rollback.json' if back else 'compose.nxduet-poses.json'))],{**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':env('photobooth-image-helper')['AI_ENGINE_API_KEY']}

def patch(area,rel,dest,log):
    base=out(['git','-C',str(R),'show',f'{BASE}:{area}/src/{rel}']).decode()
    new=(R/area/'src'/rel).read_text()
    assert dest.exists(),f'Live source missing {area}/{rel}'
    # One exact context line avoids unrelated live-only comments while preserving
    # complete old/new code lines. --fuzz=0 still rejects any changed code anchor.
    diff=''.join(difflib.unified_diff(base.splitlines(True),new.splitlines(True),fromfile=str(dest),tofile=str(dest),n=1))
    assert diff,f'No NXDuet changes in {area}/{rel}'
    run(['patch','--batch','--forward','--fuzz=0','--no-backup-if-mismatch',str(dest)],input=diff,text=True,stdout=log,stderr=subprocess.STDOUT)

def prepare():
    snap('validate'); before={n:inspect(n) for n in TARGETS}; before_all=ids()
    p=D/('nxduet-poses-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));p.mkdir()
    m={'release':str(p),'status':'PREPARING','deployed':False,'sql_applied':False,'previous_images':{n:i['Config']['Image'] for n,i in before.items()},'previous_ids':{n:i['Id'] for n,i in before.items()},'before_ids':before_all,'base_commit':BASE}
    save(p,m);P.write_text(str(p))
    try:
        with (p/'prepare.log').open('w') as log:
            backend_new=sorted(str(f.relative_to(R/'backend-express/src')) for f in (R/'backend-express/src/nxduet').glob('*.ts'))
            for name in TARGETS[:2]:
                src=p/('worker-source' if name.endswith('worker') else 'api-source');src.mkdir()
                for rel in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:run(['docker','cp',name+':/app/'+rel,str(src/rel)],stdout=log,stderr=subprocess.STDOUT)
                for rel in API:patch('backend-express',rel,src/'src'/rel,log)
                for rel in backend_new:
                    dest=src/'src'/rel;dest.parent.mkdir(parents=True,exist_ok=True)
                    baseline=subprocess.run(['git','-C',str(R),'show',f'{BASE}:backend-express/src/{rel}'],capture_output=True)
                    if baseline.returncode==0:assert dest.read_bytes()==baseline.stdout,f'Live {name} differs from baseline {BASE}: {rel}'
                    else:assert not dest.exists(),f'Unexpected live file: {rel}'
                    shutil.copy2(R/'backend-express/src'/rel,dest)
                (src/'node_modules').symlink_to(R/'backend-express/node_modules')
                (src/'test').mkdir(exist_ok=True);shutil.copy2(R/'backend-express/test/nxduet.test.ts',src/'test/nxduet.test.ts')
                run(['node',str(R/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=src,stdout=log,stderr=subprocess.STDOUT)
                run(['node','--import','tsx','--test','test/nxduet.test.ts'],cwd=src,stdout=log,stderr=subprocess.STDOUT)
                ctx=p/(name+'-image');ctx.mkdir()
                for rel in API+backend_new:
                    for file in ['src/'+rel,'dist/'+rel.replace('.ts','.js'),'dist/'+rel.replace('.ts','.js.map')]:
                        dest=ctx/file;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src/file,dest)
                image='photobooth-express:'+p.name+('-worker' if name.endswith('worker') else '')
                m.setdefault('images',{})[name]=image
                (ctx/'Dockerfile').write_text('FROM '+before[name]['Config']['Image']+'\nCOPY src/ /app/src/\nCOPY dist/ /app/dist/\n')
                run(['docker','build','--network','none','-t',image,str(ctx)],stdout=log,stderr=subprocess.STDOUT)
            base=D/before['photobooth-web']['Config']['Image'].split(':',1)[1]
            assert (base/'manifest.json').exists(),'Live web release folder missing'
            assert (base/'frontend/src').is_dir(),'Persistent source missing for live web'
            assert (base/'frontend/dist/index.html').read_bytes()==out(['docker','exec','photobooth-web','cat','/usr/share/nginx/html/index.html']),'Live web does not match release source'
            web=p/'frontend';shutil.copytree(base/'frontend',web,ignore=shutil.ignore_patterns('node_modules','dist','.env*','.vite'))
            for rel in WEB:patch('frontend',rel,web/'src'/rel,log)
            for rel in WEB_NEW:
                dest=web/'src'/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(R/'frontend/src'/rel,dest)
            (web/'node_modules').symlink_to(R/'frontend/node_modules');(p/'templates').symlink_to(R/'templates')
            data=p/'backend/app/data';data.mkdir(parents=True)
            for rel in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(R/'backend/app/data'/rel,data/rel)
            assets=out(['docker','exec','photobooth-web','sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode();google=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(google)==1
            liveenv=env('photobooth-express');buildenv={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(google)),'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN':liveenv.get('POSTHOG_PROJECT_TOKEN',''),'VITE_PUBLIC_POSTHOG_HOST':liveenv.get('POSTHOG_HOST','')}
            run(['npm','test'],cwd=web,env=buildenv,stdout=log,stderr=subprocess.STDOUT)
            run(['npm','run','build'],cwd=web,env=buildenv,stdout=log,stderr=subprocess.STDOUT)
            run(['node',str(R/'frontend/scripts/nxduet-browser-check.mjs')],env={**os.environ,'NXDUET_TEST_DIST':str(web/'dist')},stdout=log,stderr=subprocess.STDOUT)
            ctx=p/'web-image';shutil.copytree(web/'dist',ctx/'dist',ignore=shutil.ignore_patterns('*.map'))
            image='photobooth-web:'+p.name;m['images']['photobooth-web']=image
            (ctx/'Dockerfile').write_text('FROM '+before['photobooth-web']['Config']['Image']+'\nCOPY dist/ /usr/share/nginx/html/\n')
            run(['docker','build','--network','none','-t',image,str(ctx)],stdout=log,stderr=subprocess.STDOUT)
            run(['docker','run','--rm','--network','none','--entrypoint','nginx',image,'-t'],stdout=log,stderr=subprocess.STDOUT)
        shutil.copy2(SNAP,p/'compose.express-before.json')
        webbase=json.loads((base/'compose.web-base.json').read_text());webservice=webbase['services']['photobooth-web'];webservice['image']=before['photobooth-web']['Config']['Image']
        (p/'compose.web-base.json').write_text(json.dumps({**{k:v for k,v in webbase.items() if k in ('networks','volumes')},'services':{'photobooth-web':webservice}},indent=2)+'\n')
        def override(back=False):return {'services':{n:{'image':m['previous_images'][n] if back else m['images'][n],**({'environment':{'NXDUET_ENABLED':env(n).get('NXDUET_ENABLED','false') if back else 'true'}} if n!='photobooth-web' else {})} for n in TARGETS}}
        (p/'compose.nxduet-poses.json').write_text(json.dumps(override(),indent=2)+'\n');(p/'compose.rollback.json').write_text(json.dumps(override(True),indent=2)+'\n')
        args,e=command(p);run(args+['config','--quiet'],env=e)
        config=json.loads(out(args+['config','--format','json'],env=e))['services']
        for n in TARGETS:
            want=config[n];live=before[n]
            assert inspect(n)['Id']==live['Id'],'Live changed during prepare'
            assert {(x['Source'],x['Destination'],x['RW']) for x in live['Mounts']}=={(x['source'],x['target'],not x.get('read_only',False)) for x in want.get('volumes',[])},'Mount drift'
            oldenv=dict(v.split('=',1) for v in live['Config']['Env'])
            assert all(oldenv.get(k)==v for k,v in want.get('environment',{}).items() if k!='NXDUET_ENABLED'),'Unrelated environment drift'
        migration=p/'029_nxduet_poses.sql';shutil.copy2(R/'backend/migrations/029_nxduet_poses.sql',migration)
        code=[*('backend-express/src/'+f for f in API+backend_new),*('frontend/src/'+f for f in WEB+WEB_NEW)]
        m.update(status='PREPARED',migration_sha256=hashlib.sha256(migration.read_bytes()).hexdigest(),source_sha256={f:hashlib.sha256((R/f).read_bytes()).hexdigest() for f in code},validation='Live-source API/worker compile + NXDuet tests (baseline-verified), frontend suite/build/fake-camera acceptance, nginx config and compose drift checks PASS')
        save(p,m);print(json.dumps({'status':'PASS','release':str(p),'images':m['images'],'deployed':False}))
    except Exception:m['status']='PREPARE_FAILED';save(p,m);raise

def backup_and_sql(p,m):
    assert hashlib.sha256((p/'029_nxduet_poses.sql').read_bytes()).hexdigest()==m['migration_sha256'],'SQL changed after prepare'
    backup=Path('/srv/photobooth/backups')/('pre-'+p.name+'.dump')
    with backup.open('xb') as file:
        os.chmod(backup,0o600);run(['docker','exec','photobooth-postgres','sh','-c','exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],stdout=file)
    with backup.open('rb') as file:listing=out(['docker','exec','-i','photobooth-postgres','pg_restore','--list'],stdin=file)
    assert backup.stat().st_size>1024 and b'TABLE DATA' in listing,'Backup verification failed'
    m['backup']={'path':str(backup),'size':backup.stat().st_size,'sha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'verified':True};save(p,m)
    with (p/'migration.log').open('w') as log:run(['docker','exec','-i','photobooth-postgres','sh','-c','exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],input=(p/'029_nxduet_poses.sql').read_bytes(),stdout=log,stderr=subprocess.STDOUT)
    sql('SELECT template_id,slot,pose_key FROM nxduet_template_poses LIMIT 0');sql('SELECT pose_keys FROM nxduet_templates LIMIT 0');m['sql_applied']=True;save(p,m)

def healthy():
    deadline=time.monotonic()+120
    while time.monotonic()<deadline:
        states=[inspect(n) for n in TARGETS]
        assert all(x['RestartCount']==0 for x in states),'A release container restarted'
        if all(x['State']['Status']=='running' and (n.endswith('worker') or x['State'].get('Health',{}).get('Status')=='healthy') for n,x in zip(TARGETS,states)):return
        time.sleep(1)
    raise RuntimeError('Release readiness timeout')

def activate(p,back=False):
    args,e=command(p,back);run(args+['config','--quiet'],env=e);run(args+['up','-d','--no-deps','--no-build',*TARGETS],env=e)
    snap('generate');snap('validate');healthy()
    with urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=20) as res:assert json.load(res)['status']=='ok'
    if not back:
        with urllib.request.urlopen('http://127.0.0.1:3000/api/nxduet/capabilities',timeout=20) as res:
            caps=json.load(res);assert caps['enabled'] is True and caps['preparation_credits']==100 and caps['pose_count']==3 and len(caps['poses'])>=6,'Unexpected capabilities'
            assert caps['frame']['ready'] is True,'NXDuet Classic frame is not ready';assert all(set(p)=={'key','label'} for p in caps['poses']),'Capabilities expose extra pose fields'
        with urllib.request.urlopen('http://127.0.0.1:3000/nxduet',timeout=20) as res:assert res.status==200
    run(args+['ps',*TARGETS],env=e)

def deploy(p,m,back=False):
    snap('validate')
    if not back:
        assert m['status']=='PREPARED' and not m['deployed']
        for n in TARGETS:assert inspect(n)['Id']==m['previous_ids'][n],'Live changed after prepare'
        for f,digest in m['source_sha256'].items():assert hashlib.sha256((R/f).read_bytes()).hexdigest()==digest,'Code changed after prepare: '+f
    m['status']='ROLLING_BACK' if back else 'DEPLOYING';save(p,m)
    before=ids();run(['docker','stop','--timeout','30','photobooth-express'])
    try:
        deadline=time.monotonic()+600
        while True:
            count=int(sql("SELECT count(*) FROM generation_jobs WHERE state IN ('QUEUED','PROCESSING')"))
            if back and m.get('sql_applied'):count+=int(sql("SELECT count(*) FROM nxduet_templates WHERE state IN ('QUEUED','PROCESSING')"))
            if not count:break
            if time.monotonic()>deadline:raise RuntimeError('Active jobs did not drain')
            time.sleep(2)
        run(['docker','stop','--timeout','30','photobooth-express-worker'])
        if not back:backup_and_sql(p,m)
    except Exception:
        run(['docker','start','photobooth-express-worker','photobooth-express']);m['status']='ACTIVATION_ABORTED';save(p,m);raise
    try:
        activate(p,back)
    except Exception:
        if not back:activate(p,True)
        m.update(status='ROLLED_BACK',deployed=False);save(p,m);raise
    changed=[n for n,v in before.items() if ids().get(n)!=v];assert set(changed)==set(TARGETS),'Unexpected container replacement'
    m.update(status='ROLLED_BACK' if back else 'DEPLOYED',deployed=not back,changed_containers=changed,commit=out(['git','-C',str(R),'rev-parse','HEAD']).decode().strip(),last_action_at=datetime.datetime.now(datetime.timezone.utc).isoformat());save(p,m)
    print(json.dumps({'status':'PASS','release':str(p),'images':m['previous_images'] if back else m['images'],'sql_retained':back,'backup':m.get('backup',{}).get('path')}))

if __name__=='__main__':
    action=sys.argv[1] if len(sys.argv)>1 else ''
    if action=='prepare':prepare()
    elif action in ('deploy','rollback','status'):
        p=Path(P.read_text().strip());m=json.loads((p/'manifest.json').read_text())
        if action=='status':print(json.dumps(m,indent=2))
        else:deploy(p,m,action=='rollback')
    else:raise SystemExit('prepare|deploy|rollback|status; CLI arguments do not replace owner approval')
