"""Patch only the default Standard production model; no SQL/config/key changes.
prepare is read/build only. deploy/rollback require explicit owner approval.
"""
import datetime, hashlib, json, os, shutil, subprocess, sys, time, urllib.request
from pathlib import Path
R=Path('/opt/photobooth');D=Path('/srv/photobooth/releases');P=D/'.generation-route-fix';T=['photobooth-express','photobooth-express-worker'];F='services/generation-api-routes.service.ts'
def run(a,**k):return subprocess.run(a,check=True,**k)
def out(a,**k):return subprocess.check_output(a,**k)
def ins(n):return json.loads(out(['docker','inspect',n]))[0]
def save(p,m):p.write_text(json.dumps(m,indent=2)+'\n')
def snap(action):run([sys.executable,'-I',str(R/'scripts/snapshot_express_compose.py'),action])
def cmd(p,back=False):
 e=dict(x.split('=',1) for x in ins('photobooth-image-helper')['Config']['Env']);return ['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.before.json'),'-f',str(p/('compose.rollback.json' if back else 'compose.route-fix.json'))],{**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':e['AI_ENGINE_API_KEY']}
def prepare():
 snap('validate');p=D/('generation-route-fix-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));p.mkdir();before={n:ins(n) for n in T};a=p/'api-source';a.mkdir()
 with (p/'prepare.log').open('w') as log:
  for n in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:run(['docker','cp','photobooth-express:/app/'+n,str(a/n)],stdout=log,stderr=subprocess.STDOUT)
  old=(a/'src'/F).read_text();new=(R/'backend-express/src'/F).read_text();assert old.replace("'openai/gpt-image-2.5-flare'","'cx/gpt-image-2.5'")==new,'Unexpected source changes'
  (a/'src'/F).write_text(new);(a/'node_modules').symlink_to(R/'backend-express/node_modules');(a/'test').mkdir();shutil.copy2(R/'backend-express/test/generation-api-routes.test.ts',a/'test/generation-api-routes.test.ts')
  run(['node',str(R/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=a,stdout=log,stderr=subprocess.STDOUT)
  run(['node','--import','tsx','--test','test/generation-api-routes.test.ts'],cwd=a,stdout=log,stderr=subprocess.STDOUT)
  c=p/'image';c.mkdir()
  for rel in ['src/'+F,'dist/'+F.replace('.ts','.js'),'dist/'+F.replace('.ts','.js.map')]:
   dest=c/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(a/rel,dest)
  images={}
  for n in T:
   images[n]='photobooth-express:'+p.name+('-worker' if n.endswith('-worker') else '')
   (c/'Dockerfile').write_text('FROM '+before[n]['Config']['Image']+'\nCOPY src/ /app/src/\nCOPY dist/ /app/dist/\n');run(['docker','build','--network','none','-t',images[n],str(c)],stdout=log,stderr=subprocess.STDOUT)
 shutil.copy2(D/'express-base/compose.express-base.json',p/'compose.before.json');save(p/'compose.route-fix.json',{'services':{n:{'image':images[n]} for n in T}});save(p/'compose.rollback.json',{'services':{n:{'image':before[n]['Config']['Image']} for n in T}})
 args,e=cmd(p);run(args+['config','--quiet'],env=e)
 for n in T:assert ins(n)['Id']==before[n]['Id']
 m={'release':str(p),'status':'PREPARED','images':images,'previous_images':{n:before[n]['Config']['Image'] for n in T},'previous_ids':{n:before[n]['Id'] for n in T},'file':F,'source_sha256':hashlib.sha256(new.encode()).hexdigest(),'validation':'isolated compile +5 tests PASS','deployed':False,'sql_applied':False};save(p/'manifest.json',m);P.write_text(str(p));print(json.dumps(m,indent=2))
def activate(p,m,back=False):
 snap('validate')
 if not back:
  for n in T:assert ins(n)['Id']==m['previous_ids'][n],'Live changed since prepare'
 args,e=cmd(p,back);run(args+['config','--quiet'],env=e);run(args+['up','-d','--no-deps','--no-build',*T],env=e)
 deadline=time.monotonic()+120
 while time.monotonic()<deadline:
  states=[ins(n) for n in T];assert all(x['RestartCount']==0 for x in states)
  if all(x['State']['Status']=='running' for x in states) and states[0]['State'].get('Health',{}).get('Status')=='healthy':break
  time.sleep(1)
 else:raise RuntimeError('Readiness failed; persistent rollback retained')
 with urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=15) as r:assert json.load(r)['status']=='ok'
 snap('generate');snap('validate');m.update(status='ROLLED_BACK' if back else 'DEPLOYED',deployed=not back);save(p/'manifest.json',m);run(args+['ps',*T],env=e)
if __name__=='__main__':
 action=sys.argv[1]
 if action=='prepare':prepare()
 else:
  p=Path(P.read_text().strip());m=json.loads((p/'manifest.json').read_text())
  if action in ['deploy','rollback']:activate(p,m,action=='rollback')
  elif action=='status':print(json.dumps(m,indent=2))
  else:raise SystemExit('Use prepare|deploy|rollback|status')
