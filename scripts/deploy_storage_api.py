"""Owner approval REQUIRED for deploy, SQL025 and optional private .env configuration.
Prepare first with prepare_storage_api.py. Never invoke deploy without chat approval.
"""
import datetime,hashlib,importlib.util,json,os,secrets,shutil,subprocess,sys,urllib.request
from pathlib import Path
R=Path('/opt/photobooth');D=Path('/srv/photobooth/releases');TARGETS=['photobooth-express','photobooth-web']
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,R/file);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod
h=module('shared','scripts/deploy_subscription_v2.py');snapshot=module('snapshot','scripts/snapshot_express_compose.py')
def run(a,**kw):return subprocess.run(a,check=True,**kw)
def cmd(p,rollback=False):
 return ['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.express-before.json'),'-f',str(p/'compose.web-base.json'),'-f',str(p/('compose.rollback.json' if rollback else 'compose.storage-api.json'))],{**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':h.env('photobooth-image-helper')['AI_ENGINE_API_KEY']}
def private_config(p,allow):
 values=snapshot.dotenv();key=values.get('PUBLIC_API_KEY_PEPPER','')
 if key:
  assert len(key)>=32,'Private pepper is too short';return
 if not allow:raise RuntimeError('Set PUBLIC_API_KEY_PEPPER privately, or obtain explicit owner approval for --configure-private-pepper. Never paste a secret in chat.')
 # This mutation requires explicit owner approval for private configuration,
 # overriding the repository default of editing only .env.example.
 backup=Path('/srv/photobooth/backups')/(p.name+'-private-env.backup')
 with backup.open('xb') as f:os.chmod(backup,0o600);f.write((R/'.env').read_bytes())
 text=(R/'.env').read_text();lines=[line for line in text.splitlines() if not line.strip().startswith('PUBLIC_API_KEY_PEPPER=')]
 with (R/'.env').open('w') as f:f.write('\n'.join(lines)+'\nPUBLIC_API_KEY_PEPPER='+secrets.token_hex(32)+'\n')
 os.chmod(R/'.env',0o600)
def deploy(p,m,allow):
 h.snapshot();assert m['status']=='PREPARED' and not m['deployed']
 for name in TARGETS:assert h.ins(name)['Id']==m['previous_ids'][name],'Live release changed; prepare again'
 private_config(p,allow);args,e=cmd(p);run(args+['config','--quiet'],env=e)
 desired=json.loads(subprocess.check_output(args+['config','--format','json'],env=e))['services']
 for name in TARGETS:
  live=h.ins(name);old=dict(v.split('=',1) for v in live['Config']['Env']);assert desired[name]['image']==m['images'][name]
  assert all(k in ['PUBLIC_API_KEY_PEPPER','PUBLIC_API_GENERATION_ENABLED'] or old.get(k)==v for k,v in desired[name].get('environment',{}).items()),'Environment drift'
  assert {(v['Source'],v['Destination'],v['RW']) for v in live['Mounts']}=={(v['source'],v['target'],not v.get('read_only',False)) for v in desired[name].get('volumes',[])},'Mount drift'
 before=h.containers();backup=Path('/srv/photobooth/backups')/('pre-'+p.name+'.dump')
 with backup.open('xb') as f:os.chmod(backup,0o600);run(['docker','exec','photobooth-postgres','sh','-c','exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],stdout=f)
 with backup.open('rb') as f:listing=subprocess.check_output(['docker','exec','-i','photobooth-postgres','pg_restore','--list'],stdin=f)
 assert backup.stat().st_size>1024 and b'TABLE DATA' in listing
 m['backup']={'path':str(backup),'sha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'verified':True};h.save(p/'manifest.json',m)
 sql=p/'025_public_api_keys.sql';assert hashlib.sha256(sql.read_bytes()).hexdigest()==m['migration_sha256']
 with (p/'migration.log').open('w') as log:run(['docker','exec','-i','photobooth-postgres','sh','-c','exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],input=sql.read_bytes(),stdout=log,stderr=subprocess.STDOUT)
 m['sql_applied']=True;h.save(p/'manifest.json',m)
 try:
  run(args+['up','-d','--no-deps','--no-build',*TARGETS],env=e);h.healthy()
  with urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=15) as res:assert json.load(res)['status']=='ok'
  with urllib.request.urlopen('http://127.0.0.1:3000/api/public/v1/capabilities',timeout=15) as res:cap=json.load(res);assert cap['enabled'] and cap['storage'] and not cap['generation']
  run(['python3','-I',str(R/'scripts/snapshot_express_compose.py'),'generate']);h.snapshot()
  changed=[n for n,v in before.items() if h.containers().get(n)!=v];assert set(changed)==set(TARGETS)
  m.update(status='DEPLOYED',deployed=True,deployed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),changed_containers=changed);h.save(p/'manifest.json',m);run(args+['ps',*TARGETS],env=e);print(json.dumps({'status':'PASS','release':str(p)}))
 except Exception:
  rollback,re=cmd(p,True);run(rollback+['config','--quiet'],env=re);run(rollback+['up','-d','--no-deps','--no-build',*TARGETS],env=re);h.healthy();run(['python3','-I',str(R/'scripts/snapshot_express_compose.py'),'generate']);h.snapshot();m.update(status='ROLLED_BACK',deployed=False);h.save(p/'manifest.json',m);raise
if __name__=='__main__':
 p=Path((D/'.storage-api-prepared').read_text().strip());m=json.loads((p/'manifest.json').read_text())
 if sys.argv[1:] == ['status']:print(json.dumps(m,indent=2))
 elif sys.argv[1:] in [['deploy'],['deploy','--configure-private-pepper']]:deploy(p,m,'--configure-private-pepper' in sys.argv)
 else:raise SystemExit('Use status | deploy [--configure-private-pepper]. Explicit owner approval required.')
