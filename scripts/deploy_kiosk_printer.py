"""Prepare or explicitly deploy the web-only local printer UI; preserve the live stack."""
import json,os,re,shutil,subprocess,sys,difflib,datetime,time,urllib.request
from pathlib import Path
REPO=Path('/opt/photobooth');POINTER=Path('/srv/photobooth/tmp/kiosk-printer-release-path')
def run(args,**kw):return subprocess.run(args,check=True,**kw)
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
def verify_runtime(manifest, catalog=False):
 for attempt in range(60):
  containers=[inspect(name) for name in manifest['services'].values()]
  if all(c['State']['Status']=='running' and c['State'].get('Health',{}).get('Status','healthy')=='healthy' for c in containers):break
  time.sleep(1)
 else:raise RuntimeError('Release did not become healthy; inspect logs before proceeding')
 assert all(c['RestartCount']==0 for c in containers),'Restart-looping release'
 with urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=15) as response:assert response.status==200
 if catalog:
  with urllib.request.urlopen('http://127.0.0.1:3000/api/classic/layouts',timeout=30) as response:rows=json.load(response)
  expected=json.loads((Path(manifest['release'])/'assets/collection.json').read_text())['frames']
  for frame in expected:
   row=next(row for row in rows if row['id']==frame['id'])
   assert row['shot_count']==3 and row['requires_event_name'] is True
  with urllib.request.urlopen('http://127.0.0.1:3000'+next(row for row in rows if row['id']==expected[0]['id'])['preview_url'],timeout=30) as response:assert response.read(8)==b'\x89PNG\r\n\x1a\n'
 print(json.dumps({'runtime_health':'PASS','restart_count':0,'web_request':'PASS','reviewed_catalog':catalog}))
def compose(m,rollback=False):
 helper=dict(v.split('=',1) for v in inspect('photobooth-image-helper')['Config']['Env'] if '=' in v)
 if helper.get('AI_ENGINE_API_KEY'):os.environ.setdefault('EXPRESS_IMAGE_ENGINE_KEY',helper['AI_ENGINE_API_KEY'])
 args=['docker','compose','--project-directory',str(REPO),'--env-file',str(REPO/'.env')]
 for file in m['compose_files']+[m['rollback'] if rollback else m['override']]:args+=['-f',file]
 return args


action=sys.argv[1]
if action=='prepare':
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 r=Path('/srv/photobooth/releases')/('kiosk-printer-'+stamp);r.mkdir();POINTER.write_text(str(r))
 web=inspect('photobooth-web');api=inspect('photobooth-express')
 files=list(dict.fromkeys(api['Config']['Labels']['com.docker.compose.project.config_files'].split(',')+web['Config']['Labels']['com.docker.compose.project.config_files'].split(',')))
 snapshot=Path(web['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1]).parent/'frontend';assert snapshot.is_dir()
 frontend=r/'frontend';shutil.copytree(snapshot,frontend,ignore=shutil.ignore_patterns('node_modules','dist','.vite','.env*'));(frontend/'node_modules').symlink_to(REPO/'frontend/node_modules')
 changed=['src/components/kiosk/KioskPreview.jsx','src/components/kiosk/kiosk-preview.css','src/components/kiosk/useKioskPrinter.js','src/kioskPrinter.js','src/kioskPrinter.test.js']
 for file in changed:shutil.copy2(REPO/'frontend'/file,frontend/file)
 assets=subprocess.check_output(['docker','exec','photobooth-web','sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode();ids=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(ids)==1
 data=r/'backend/app/data';data.mkdir(parents=True)
 for name in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(REPO/'backend/app/data'/name,data/name)
 (r/'templates').symlink_to(REPO/'templates')
 config=dict(v.split('=',1) for v in api['Config']['Env'] if '=' in v)
 env={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(ids)),'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN':config.get('POSTHOG_PROJECT_TOKEN',''),'VITE_PUBLIC_POSTHOG_HOST':config.get('POSTHOG_HOST','')}
 for cmd,log in [(['npm','test'],'frontend-tests.log'),(['npm','run','build'],'frontend-build.log')]:
  with (r/log).open('w') as output:run(cmd,cwd=frontend,env=env,stdout=output,stderr=subprocess.STDOUT)
 context=r/'web-image';context.mkdir();shutil.copytree(frontend/'dist',context/'dist');(context/'Dockerfile').write_text('FROM '+web['Config']['Image']+'\nCOPY dist/ /usr/share/nginx/html/\n')
 image='photobooth-web:kiosk-printer-'+stamp;override=r/'compose.kiosk-printer.yml';rollback=r/'compose.rollback.yml'
 override.write_text('services:\n  photobooth-web:\n    image: '+image+'\n');rollback.write_text('services:\n  photobooth-web:\n    image: '+web['Config']['Image']+'\n')
 m={'release':str(r),'services':{'web':'photobooth-web'},'previous':{'web':web['Config']['Image']},'images':{'web':image},'compose_files':files,'override':str(override),'rollback':str(rollback),'changed_files':changed,'before':{v['Names']:v['ID'] for v in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())}}
 (r/'manifest.json').write_text(json.dumps(m,indent=2));run(compose(m)+['config','--quiet'])
 with (r/'web-docker-build.log').open('w') as output:run(['docker','build','-t',image,str(context)],stdout=output,stderr=subprocess.STDOUT)
 print(json.dumps({'release':str(r),'tests':'PASS','build':'PASS','compose':'PASS','deployed':False}))
elif action in ['deploy','rollback','status']:
 r=Path(POINTER.read_text().strip());m=json.loads((r/'manifest.json').read_text());args=compose(m,action=='rollback');run(args+['config','--quiet'])
 if action=='deploy':assert inspect('photobooth-web')['Config']['Image']==m['previous']['web'],'Live release changed since prepare'
 if action!='status':run(args+['up','-d','--no-deps','--no-build','photobooth-web']);verify_runtime(m);run(['docker','logs','--tail','10','photobooth-web'])
 run(args+['ps','photobooth-web']);now={v['Names']:v['ID'] for v in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())};changed=[n for n,i in m['before'].items() if now.get(n)!=i];assert set(changed)<=set(m['services'].values()),changed
 print(json.dumps({'status':'PASS','changed_containers':changed}))
else:raise SystemExit('Use prepare/deploy/rollback/status')
