"""Deploy/rollback the owner-approved combined Basic footer release.

Preparation lives in the release directory; deploy requires fresh owner approval.
No schema operations or v1 asset overwrites. Catalog changes are conditional.
"""
import datetime,json,os,subprocess,sys,time,urllib.request
from pathlib import Path
ROOT=Path('/opt/photobooth');D=Path('/srv/photobooth/releases');P=D/'.basic-footer-current'
NAMES=['photobooth-image-helper','photobooth-express','photobooth-express-worker','photobooth-web']
def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
def save(p,m):(p/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
def snap(action):run([sys.executable,'-I',str(ROOT/'scripts/snapshot_express_compose.py'),action])
def compose(p,back=False):
 key=dict(v.split('=',1) for v in inspect('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY']
 return ['docker','compose','--project-name','photobooth','--project-directory',str(ROOT),'--env-file',str(ROOT/'.env'),'-f',str(p/'compose.before.json'),'-f',str(p/('compose.rollback.json' if back else 'compose.footer.json'))],{**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':key}
def catalog(p,action):
 run(['docker','exec','-i','-w','/app','-e','FOOTER_RELEASE_DIR='+str(p),'-e','FOOTER_ACTION='+action,'photobooth-express','node','--input-type=module'],input=(p/'revise-basic-footer.mjs').read_text(),text=True)
def ready(name):
 for _ in range(60):
  i=inspect(name)
  if i['RestartCount']:raise RuntimeError(name+' restarted')
  if i['State']['Status']=='running' and (name.endswith('worker') or i['State'].get('Health',{}).get('Status')=='healthy'):return
  time.sleep(1)
 raise RuntimeError(name+' not healthy')
def verify(p,m,back=False):
 for n in NAMES:ready(n)
 for origin in ['http://127.0.0.1:3000','https://nxbooth.gennexbyte.com']:
  with urllib.request.urlopen(urllib.request.Request(origin+'/api/health',headers={'User-Agent':'Mozilla/5.0'}),timeout=20) as response:assert json.load(response)['status']=='ok'
  with urllib.request.urlopen(urllib.request.Request(origin+'/create',headers={'User-Agent':'Mozilla/5.0'}),timeout=20) as response:assert response.status==200
 if not back:
  catalog(p,'verify')
  with urllib.request.urlopen('http://127.0.0.1:3000/api/templates',timeout=30) as response:
   data=json.load(response);rows=data['templates'];wanted={r['id'] for r in json.loads((p/'assets/collection.json').read_text())['templates']}
   assert len([r for r in rows if r['id'] in wanted and r['width']==1024 and r['height']==1536 and r['basic_available']])==16
 args,env=compose(p,back);run(args+['ps'],env=env)
def main():
 action=sys.argv[1];p=Path(P.read_text().strip());m=json.loads((p/'manifest.json').read_text())
 if action=='status':print(json.dumps(m,indent=2));return
 if action=='verify':verify(p,m);return
 assert action in ['deploy','rollback'];back=action=='rollback';snap('validate')
 if not back:
  assert m['status']=='PREPARED'
  for n in NAMES:assert inspect(n)['Id']==m['previous'][n]['id'],'Live changed after preparation'
 args,env=compose(p,back);run(args+['config','--quiet'],env=env)
 m['status']='ROLLING_BACK' if back else 'DEPLOYING';save(p,m)
 try:
  if back:catalog(p,'rollback')
  run(args+['up','-d','--no-deps','--no-build','photobooth-image-helper'],env=env);ready('photobooth-image-helper')
  if not back:catalog(p,'publish')
  run(args+['up','-d','--no-deps','--no-build','photobooth-express','photobooth-express-worker'],env=env)
  ready('photobooth-express');ready('photobooth-express-worker')
  run(args+['up','-d','--no-deps','--no-build','photobooth-web'],env=env)
  snap('generate');snap('validate');verify(p,m,back)
 except Exception:
  snap('generate');m['status']='ROLLBACK_REQUIRED';save(p,m);raise
 m.update(status='ROLLED_BACK' if back else 'DEPLOYED',deployed=not back,last_action_at=datetime.datetime.now(datetime.timezone.utc).isoformat());save(p,m)
 print(json.dumps({'status':m['status'],'release':str(p),'images':m['images']},indent=2))
if __name__=='__main__':main()
