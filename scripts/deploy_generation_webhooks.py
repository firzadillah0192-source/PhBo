"""Owner-operated webhook activation. No SQL/deploy is performed by prepare or status.
apply-sql requires separate explicit production SQL approval; deploy requires fresh deploy approval.
"""
import datetime,hashlib,importlib.util,json,os,re,secrets,stat,subprocess,sys,time,urllib.request
from pathlib import Path
R=Path('/opt/photobooth');D=Path('/srv/photobooth/releases');TARGETS=['photobooth-express','photobooth-express-worker','photobooth-web']
spec=importlib.util.spec_from_file_location('shared',R/'scripts/deploy_subscription_v2.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
def run(a,**kw):return subprocess.run(a,check=True,**kw)
def save(p,m):h.save(p/'manifest.json',m)
def schema_ready():
 h.sql('SELECT e.id,d.state,d.payload,d.lease_token,a.attempt_number FROM integration_webhook_endpoints e LEFT JOIN integration_webhook_deliveries d ON false LEFT JOIN integration_webhook_attempts a ON false LIMIT 0')
def apply_sql(p,m):
 assert not m['deployed'],'Already deployed'
 file=p/'backend/migrations/027_generation_webhooks.sql';assert file.is_file();assert hashlib.sha256(file.read_bytes()).hexdigest()==m['migration_sha256'],'Reviewed SQL changed'
 backup=Path('/srv/photobooth/backups')/('pre-'+p.name+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.dump')
 with backup.open('xb') as output:
  os.chmod(backup,0o600);run(['docker','exec','photobooth-postgres','sh','-c','exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],stdout=output)
 with backup.open('rb') as source:listing=subprocess.check_output(['docker','exec','-i','photobooth-postgres','pg_restore','--list'],stdin=source)
 assert backup.stat().st_size>1024 and b'TABLE DATA' in listing,'Backup validation failed'
 m['backup']={'path':str(backup),'bytes':backup.stat().st_size,'sha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'verified':True};save(p,m)
 with file.open('rb') as source:run(['docker','exec','-i','photobooth-postgres','sh','-c','exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],stdin=source)
 schema_ready();m.update(sql_applied=True,sql_sha256=hashlib.sha256(file.read_bytes()).hexdigest());save(p,m);print(json.dumps({'status':'PASS','sql_applied':True,'backup':str(backup)}))
def keyring(folder=None):
 folder=folder or Path('/srv/photobooth/tmp/webhook-secrets');folder.mkdir(mode=0o700,exist_ok=True)
 assert not folder.is_symlink() and stat.S_IMODE(folder.stat().st_mode)&0o077==0,'Webhook secret directory must be private'
 file=folder/'keyring.json'
 if not file.exists():
  fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'w') as output:json.dump({'v1':secrets.token_hex(32)},output)
 assert not file.is_symlink() and stat.S_IMODE(file.stat().st_mode)&0o077==0,'Webhook keyring must be private'
 data=json.loads(file.read_text());active=os.environ.get('NXBOOTH_WEBHOOK_KEY_VERSION','v1');assert active in data
 assert data and all(re.fullmatch(r'[A-Za-z0-9_-]{1,30}',k) and isinstance(v,str) and re.fullmatch(r'[a-fA-F0-9]{64}',v) for k,v in data.items()),'Invalid private webhook keyring'
 ring=json.dumps(data,separators=(',',':'))
 runtime=folder/'runtime.env';assert not runtime.is_symlink(),'Webhook runtime environment must not be a symlink'
 temporary=folder/('runtime-'+secrets.token_hex(8)+'.env')
 fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as output:output.write('WEBHOOK_SECRET_ENCRYPTION_KEY='+ring+'\nWEBHOOK_SECRET_ENCRYPTION_VERSION='+active+'\n')
 os.replace(temporary,runtime)
 return ring,active

def command(p,rollback=False):return ['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.express-before.json'),'-f',str(p/'compose.web-base.json'),'-f',str(p/('compose.rollback.json' if rollback else 'compose.generation-webhooks.json'))]
def activate(p,env,rollback=False):
 args=command(p,rollback);run(args+['config','--quiet'],env=env);run(args+['up','-d','--no-deps','--no-build',*TARGETS],env=env);h.healthy()
 with urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=15) as res:assert json.load(res)['status']=='ok'
 with urllib.request.urlopen('http://127.0.0.1:3000/api/public/v1/capabilities',timeout=15) as res:c=json.load(res);assert c['generation'] and c['dashboard'] and bool(c.get('webhooks',False))==(not rollback)
 run(['python3','-I',str(R/'scripts/snapshot_express_compose.py'),'generate']);h.snapshot()
def environment():return {**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':h.env('photobooth-image-helper')['AI_ENGINE_API_KEY']}
def deploy(p,m):
 h.snapshot();assert m['status']=='PREPARED_PENDING_ACTIVATION' and not m['deployed'];schema_ready()
 for n in TARGETS:assert h.ins(n)['Id']==m['previous_ids'][n],'Live release changed; prepare again'
 ring,version=keyring();env={**environment(),'NXBOOTH_WEBHOOK_KEYRING':ring,'NXBOOTH_WEBHOOK_KEY_VERSION':version,'WEBHOOK_PUBLIC_API_PEPPER':h.env('photobooth-express')['PUBLIC_API_KEY_PEPPER']}
 args=command(p);run(args+['config','--quiet'],env=env);cfg=json.loads(subprocess.check_output(args+['config','--format','json'],env=env))['services']
 permitted={'GENERATION_WEBHOOKS_ENABLED','WEBHOOK_SECRET_ENCRYPTION_KEY','WEBHOOK_SECRET_ENCRYPTION_VERSION','PUBLIC_API_GENERATION_ENABLED','PUBLIC_API_KEY_PEPPER'}
 for n in TARGETS:
  live=h.ins(n);want=cfg[n];assert want['image']==m['images'][n]
  assert {(v['Source'],v['Destination'],v['RW']) for v in live['Mounts']}=={(v['source'],v['target'],not v.get('read_only',False)) for v in want.get('volumes',[])},'Mount drift'
  original=h.env(n);assert all(original.get(k)==v for k,v in want.get('environment',{}).items() if k not in permitted),'Unrelated environment drift'
 before=h.containers()
 try:
  run(['docker','stop','--time','30','photobooth-express']);deadline=time.monotonic()+180
  while int(h.sql("SELECT count(*) FROM generation_jobs WHERE state IN ('QUEUED','PROCESSING')")):
   if time.monotonic()>deadline:raise RuntimeError('Active jobs did not drain; rolling back')
   time.sleep(2)
  run(['docker','stop','--time','30','photobooth-express-worker']);activate(p,env)
  after=h.containers();changed=[n for n,v in before.items() if after.get(n)!=v];assert set(changed)==set(TARGETS),'Unrelated container change'
  m.update(status='DEPLOYED',deployed=True,deployed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),changed_containers=changed);save(p,m);run(args+['ps',*TARGETS],env=env);print(json.dumps({'status':'PASS','release':str(p),'sql_reverted':False}))
 except Exception:
  activate(p,environment(),True);m.update(status='ROLLED_BACK',deployed=False);save(p,m);raise
if __name__=='__main__':
 p=Path((D/'.generation-webhooks-prepared').read_text().strip());m=json.loads((p/'manifest.json').read_text())
 if sys.argv[1:]==['status']:print(json.dumps(m,indent=2))
 elif sys.argv[1:]==['apply-sql','--approved-production-sql']:apply_sql(p,m)
 elif sys.argv[1:]==['deploy','--approved-deploy']:deploy(p,m)
 elif sys.argv[1:]==['rollback','--approved-deploy']:activate(p,environment(),True);m.update(status='ROLLED_BACK',deployed=False);save(p,m)
 else:raise SystemExit('status | apply-sql --approved-production-sql | deploy --approved-deploy | rollback --approved-deploy. CLI flags do not replace owner approval in chat.')
