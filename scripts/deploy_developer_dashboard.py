"""Deploy Developer dashboard/history only after explicit owner approval.
No SQL, credit changes or secret changes. Current Storage API/pepper preserved.
"""
import datetime,importlib.util,json,os,subprocess,sys,urllib.request
from pathlib import Path
R=Path('/opt/photobooth');D=Path('/srv/photobooth/releases');TARGETS=['photobooth-express','photobooth-web']
spec=importlib.util.spec_from_file_location('shared',R/'scripts/deploy_subscription_v2.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def command(p,rollback=False):
 return ['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.express-before.json'),'-f',str(p/'compose.web-base.json'),'-f',str(p/('compose.rollback.json' if rollback else 'compose.developer-dashboard.json'))],{**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':h.env('photobooth-image-helper')['AI_ENGINE_API_KEY']}
def activate(p,rollback=False):
 args,env=command(p,rollback);run(args+['config','--quiet'],env=env);run(args+['up','-d','--no-deps','--no-build',*TARGETS],env=env);h.healthy()
 with urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=15) as res:assert json.load(res)['status']=='ok'
 with urllib.request.urlopen('http://127.0.0.1:3000/api/public/v1/capabilities',timeout=15) as res:
  caps=json.load(res);assert caps['enabled'] and caps['storage'] and caps['generation'] and bool(caps.get('dashboard',False))==(not rollback)
 run(['python3','-I',str(R/'scripts/snapshot_express_compose.py'),'generate']);h.snapshot()
def deploy(p,m):
 h.snapshot();assert m['status']=='PREPARED' and not m['deployed']
 args,env=command(p);run(args+['config','--quiet'],env=env);desired=json.loads(subprocess.check_output(args+['config','--format','json'],env=env))['services']
 for name in TARGETS:
  live=h.ins(name);assert live['Id']==m['previous_ids'][name],'Live release changed; prepare again';assert desired[name]['image']==m['images'][name]
  old=dict(v.split('=',1) for v in live['Config']['Env']);assert all(old.get(k)==v for k,v in desired[name].get('environment',{}).items()),'Environment drift'
  assert {(v['Source'],v['Destination'],v['RW']) for v in live['Mounts']}=={(v['source'],v['target'],not v.get('read_only',False)) for v in desired[name].get('volumes',[])},'Mount drift'
 before=h.containers()
 try:
  activate(p);changed=[n for n,v in before.items() if h.containers().get(n)!=v];assert set(changed)==set(TARGETS)
  m.update(status='DEPLOYED',deployed=True,deployed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),changed_containers=changed);h.save(p/'manifest.json',m);run(args+['ps',*TARGETS],env=env);print(json.dumps({'status':'PASS','release':str(p)}))
 except Exception:
  activate(p,True);m.update(status='ROLLED_BACK',deployed=False);h.save(p/'manifest.json',m);raise
if __name__=='__main__':
 p=Path((D/'.developer-dashboard-prepared').read_text().strip());m=json.loads((p/'manifest.json').read_text())
 if sys.argv[1:]==['status']:print(json.dumps(m,indent=2))
 elif sys.argv[1:]==['deploy']:deploy(p,m)
 else:raise SystemExit('Use status|deploy. Deploy requires fresh explicit owner approval.')
