"""Prepare/deploy/rollback the processing-screen progress meter (web only).

The web source is the frontend copy of the live web release (basic-footer-20261021T090734Z) plus
only the processing-screen change, so no other unreleased frontend work ships. Each deploy needs
owner approval."""
import datetime,json,os,re,shutil,subprocess,sys,time,urllib.request
from pathlib import Path
R=Path('/opt/photobooth');D=Path('/srv/photobooth/releases');P=D/'.processing-meter-current'
WEB='photobooth-web'
# Each file in the base release equals git HEAD; the working tree differs only by this change.
FILES=['src/components/customer/ReviewStage.jsx','src/components/customer/ProcessingStage.jsx','src/processingProgress.js','src/processingProgress.test.js','src/customer.css','src/retro.css']
def run(a,**k):return subprocess.run(a,check=True,**k)
def inspect(n):return json.loads(subprocess.check_output(['docker','inspect',n]))[0]
def save(p,m):(p/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
def command(p,back=False):
 return ['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.before.json'),'-f',str(p/('compose.rollback.json' if back else 'compose.meter.json'))]
def env():
 key=dict(v.split('=',1) for v in inspect('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY']
 return {**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':key}
def prepare():
 # The web source is the frontend copy of the release whose image is live.
 before=inspect(WEB);BASE=D/before['Config']['Image'].split(':',1)[1];assert (BASE/'frontend/src').is_dir(),'No frontend source for the live web release'
 p=D/('processing-meter-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));p.mkdir()
 s=p/'frontend';shutil.copytree(BASE/'frontend',s,ignore=shutil.ignore_patterns('node_modules','dist'),symlinks=True)
 for rel in FILES:
  # The base copy must equal git HEAD or already carry this change; anything else is someone else's work.
  if (s/rel).exists():
   head=subprocess.run(['git','-C',str(R),'show','HEAD:frontend/'+rel],capture_output=True,text=True).stdout
   assert (s/rel).read_text() in (head,(R/'frontend'/rel).read_text()),rel+' base differs from HEAD'
  shutil.copy2(R/'frontend'/rel,s/rel)
 (s/'node_modules').symlink_to(R/'frontend/node_modules')
 assets=subprocess.check_output(['docker','exec',WEB,'sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode();ids=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(ids)==1
 api=dict(x.split('=',1) for x in inspect('photobooth-express')['Config']['Env'] if '=' in x)
 e={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(ids)),'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN':api.get('POSTHOG_PROJECT_TOKEN',''),'VITE_PUBLIC_POSTHOG_HOST':api.get('POSTHOG_HOST','')}
 # Tests read fixtures relative to the release root, like the base release.
 (p/'backend/app/data').mkdir(parents=True)
 for name in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(R/'backend/app/data'/name,p/'backend/app/data'/name)
 (p/'templates').symlink_to(R/'templates')
 with (p/'frontend.log').open('w') as log:
  run(['npm','test'],cwd=s,env=e,stdout=log,stderr=subprocess.STDOUT);run(['npm','run','build'],cwd=s,env=e,stdout=log,stderr=subprocess.STDOUT)
 ctx=p/'web-image';shutil.copytree(s/'dist',ctx/'dist',ignore=shutil.ignore_patterns('*.map'))
 run(['docker','cp',WEB+':/usr/share/nginx/html/previews',str(p/'live-previews')]);shutil.copytree(p/'live-previews',ctx/'dist/previews',dirs_exist_ok=True)
 (ctx/'Dockerfile').write_text('FROM '+before['Config']['Image']+'\nCOPY dist/ /usr/share/nginx/html/\n')
 image='photobooth-web:'+p.name
 with (p/'web-build.log').open('w') as log:
  run(['docker','build','--network','none','-t',image,str(ctx)],stdout=log,stderr=subprocess.STDOUT);run(['docker','run','--rm','--network','none','--entrypoint','nginx',image,'-t'],stdout=log,stderr=subprocess.STDOUT)
 shutil.copy2(BASE/'compose.before.json',p/'compose.before.json')
 save_json=lambda f,img:(p/f).write_text(json.dumps({'services':{WEB:{'image':img}}},indent=2)+'\n')
 save_json('compose.meter.json',image);save_json('compose.rollback.json',before['Config']['Image'])
 run(command(p)+['config','--quiet'],env=env())
 m={'release':str(p),'status':'PREPARED','images':{WEB:image},'previous_images':{WEB:before['Config']['Image']},'previous_ids':{WEB:before['Id']},'changed_files':FILES,'deployed':False}
 save(p,m);P.write_text(str(p));assert inspect(WEB)['Id']==before['Id'];print(json.dumps(m,indent=2))
def deploy(p,m,back=False):
 if not back:assert inspect(WEB)['Id']==m['previous_ids'][WEB],'Live web changed after prepare'
 m['status']='ROLLING_BACK' if back else 'DEPLOYING';save(p,m)
 run(command(p,back)+['up','-d','--no-deps','--no-build',WEB],env=env())
 for _ in range(60):
  i=inspect(WEB);assert i['RestartCount']==0
  if i['State'].get('Health',{}).get('Status')=='healthy':break
  time.sleep(1)
 else:m['status']='ROLLBACK_REQUIRED';save(p,m);raise RuntimeError('web not healthy')
 for url in ['http://127.0.0.1:3000/create','https://nxbooth.gennexbyte.com/create']:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=20) as r:assert r.status==200
 m.update(status='ROLLED_BACK' if back else 'DEPLOYED',deployed=not back,last_action_at=datetime.datetime.now(datetime.timezone.utc).isoformat());save(p,m);print(json.dumps(m,indent=2))
if __name__=='__main__':
 action=sys.argv[1] if len(sys.argv)>1 else ''
 if action=='prepare':prepare()
 elif action in ('deploy','rollback'):
  p=Path(P.read_text().strip());deploy(p,json.loads((p/'manifest.json').read_text()),action=='rollback')
 else:raise SystemExit('Use prepare|deploy|rollback')
