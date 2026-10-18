"""Deploy prepared folder web/share release only after explicit owner approval.
Verified DB backup + manual additive SQL026. Never applies025 or activates IAM.
"""
import datetime,hashlib,importlib.util,json,os,subprocess,sys,time,urllib.request
from pathlib import Path
R=Path('/opt/photobooth');D=Path('/srv/photobooth/releases');TARGETS=['photobooth-express','photobooth-express-worker','photobooth-web']
spec=importlib.util.spec_from_file_location('shared',R/'scripts/deploy_subscription_v2.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
def run(a,**k):return subprocess.run(a,check=True,**k)
def cmd(p,back=False):
 key=h.env('photobooth-image-helper')['AI_ENGINE_API_KEY'];return ['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.express-before.json'),'-f',str(p/'compose.web-base.json'),'-f',str(p/('compose.rollback.json' if back else 'compose.photo-folders.json'))],{**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':key}
def verify(p,m):
 args,e=cmd(p);run(args+['config','--quiet'],env=e);data=json.loads(subprocess.check_output(args+['config','--format','json'],env=e))['services']
 for n in TARGETS:
  live=h.ins(n);assert live['Id']==m['previous_ids'][n],'Live service changed: '+n
  desired=data[n];assert desired['image']==m['images'][n]
  old=dict(x.split('=',1) for x in live['Config']['Env']);assert all(k=='PHOTO_FOLDERS_ENABLED' or old.get(k)==v for k,v in desired.get('environment',{}).items()),'Environment changed'
  assert {(x['Source'],x['Destination'],x['RW']) for x in live['Mounts']}=={(x['source'],x['target'],not x.get('read_only',False)) for x in desired.get('volumes',[])},'Mount drift'
 return args,e
def activate(p,m,back=False):
 args,e=cmd(p,back);run(args+['config','--quiet'],env=e);run(args+['up','-d','--no-deps','--no-build',*TARGETS],env=e);h.healthy()
 with urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=15) as r:assert json.load(r)['status']=='ok'
 run(['python3','-I',str(R/'scripts/snapshot_express_compose.py'),'generate']);h.snapshot()
def deploy(p,m):
 h.snapshot();assert not m['deployed'];args,e=verify(p,m);before=h.containers();m['before_containers']=before
 run(['docker','stop','--timeout','30','photobooth-express']);deadline=time.monotonic()+180
 while int(h.sql("SELECT count(*) FROM generation_jobs WHERE state IN ('QUEUED','PROCESSING');")):
  if time.monotonic()>deadline:run(['docker','start','photobooth-express']);raise RuntimeError('Job drain timed out; API restored')
  time.sleep(2)
 run(['docker','stop','--timeout','30','photobooth-express-worker'])
 try:
  backup=Path('/srv/photobooth/backups')/('pre-'+p.name+'.dump')
  with backup.open('xb') as f:os.chmod(backup,0o600);run(['docker','exec','photobooth-postgres','sh','-c','exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],stdout=f)
  with backup.open('rb') as f:listing=subprocess.check_output(['docker','exec','-i','photobooth-postgres','pg_restore','--list'],stdin=f)
  assert backup.stat().st_size>1024 and b'TABLE DATA' in listing
  m['backup']={'path':str(backup),'sha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'verified':True};h.save(p/'manifest.json',m)
  migration=p/'026_photo_folders.sql';assert hashlib.sha256(migration.read_bytes()).hexdigest()==m['migration_sha256']
  with (p/'migration.log').open('w') as log:run(['docker','exec','-i','photobooth-postgres','sh','-c','exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],input=migration.read_bytes(),stdout=log,stderr=subprocess.STDOUT)
  m['sql_applied']=True;h.save(p/'manifest.json',m)
 except Exception:run(['docker','start','photobooth-express-worker','photobooth-express']);raise
 try:
  activate(p,m);changed=[n for n,v in before.items() if h.containers().get(n)!=v];assert set(changed)==set(TARGETS)
  m.update(status='DEPLOYED',deployed=True,changed_containers=changed,deployed_at=datetime.datetime.now(datetime.timezone.utc).isoformat());h.save(p/'manifest.json',m);run(args+['ps',*TARGETS],env=e);print(json.dumps({'status':'PASS','release':str(p),'backup':str(backup)}))
 except Exception:
  activate(p,m,True);m.update(status='ROLLED_BACK',deployed=False);h.save(p/'manifest.json',m);raise
if __name__=='__main__':
 p=Path((D/'.photo-folders-prepared').read_text().strip());m=json.loads((p/'manifest.json').read_text());action=sys.argv[1]
 if action=='status':print(json.dumps(m,indent=2))
 elif action=='deploy':deploy(p,m)
 else:raise SystemExit('Use status|deploy. Explicit owner approval required for production migration/deploy.')
