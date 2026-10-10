"""Prepare/release bounded preview recovery and correct stored-preview freshness."""
import json,os,re,shutil,subprocess,sys,difflib,datetime,time,urllib.request
from pathlib import Path
REPO=Path('/opt/photobooth');BASE=Path('/srv/photobooth/tmp/preview-recovery-baseline');POINTER=Path('/srv/photobooth/tmp/classic-event-flow-release-path')
BF=['services/catalog-assets.service.ts']
FF=['src/components/home/ModeCards.jsx','src/App.jsx','src/components/customer/ClassicCaptureStage.jsx']
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

def patch(source,target,original,log):
 if not original.exists():shutil.copy2(source,target);return
 diff=''.join(difflib.unified_diff(original.read_text().splitlines(True),source.read_text().splitlines(True),fromfile=str(target),tofile=str(target)))
 if diff:run(['patch','--batch','--forward',str(target)],input=diff,text=True,stdout=log,stderr=subprocess.STDOUT)

action=sys.argv[1]
if action=='prepare':
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');r=Path('/srv/photobooth/releases')/('classic-event-flow-'+stamp);r.mkdir();POINTER.write_text(str(r))
 services={'api':'photobooth-express','worker':'photobooth-express-worker','web':'photobooth-web'};running={k:inspect(n) for k,n in services.items()}
 snapshot=Path(running['web']['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1]).parent/'frontend';assert snapshot.is_dir()
 frontend=r/'frontend';shutil.copytree(snapshot,frontend,ignore=shutil.ignore_patterns('node_modules','dist','.vite','.env*'));(frontend/'node_modules').symlink_to(REPO/'frontend/node_modules')
 with (r/'patch.log').open('w') as log:
  for file in FF:patch(REPO/'frontend'/file,frontend/file,BASE/'frontend'/file,log)
  for key in ['api','worker']:
   backend=r/(key+'-source');backend.mkdir()
   for file in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:run(['docker','cp',services[key]+':/app/'+file,str(backend/file)],stdout=subprocess.DEVNULL)
   for file in BF:
    target=backend/'src'/file;target.parent.mkdir(parents=True,exist_ok=True);patch(REPO/'backend-express/src'/file,target,BASE/'backend-express/src'/file,log)
   (backend/'node_modules').symlink_to(REPO/'backend-express/node_modules')
   with (r/(key+'-compile.log')).open('w') as f:run(['node',str(REPO/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=backend,stdout=f,stderr=subprocess.STDOUT)
 assets=subprocess.check_output(['docker','exec',services['web'],'sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode();ids=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(ids)==1
 data=r/'backend/app/data';data.mkdir(parents=True)
 for file in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(REPO/'backend/app/data'/file,data/file)
 (r/'templates').symlink_to(REPO/'templates')
 for command,log in [(['npm','test'],'frontend-tests.log'),(['npm','run','build'],'frontend-build.log')]:
  with (r/log).open('w') as f:run(command,cwd=frontend,env={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(ids)),**{ 'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN':dict(v.split('=',1) for v in running['api']['Config']['Env'] if '=' in v).get('POSTHOG_PROJECT_TOKEN',''), 'VITE_PUBLIC_POSTHOG_HOST':dict(v.split('=',1) for v in running['api']['Config']['Env'] if '=' in v).get('POSTHOG_HOST','') }},stdout=f,stderr=subprocess.STDOUT)
 images={k:'photobooth-'+('web' if k=='web' else 'express')+':classic-event-flow-'+k+'-'+stamp for k in services}
 for key in services:
  context=r/(key+'-image');context.mkdir()
  if key=='web':shutil.copytree(frontend/'dist',context/'dist');copy='COPY dist/ /usr/share/nginx/html/\n'
  else:
   backend=r/(key+'-source')
   for file in BF:
    target=context/'src'/file;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backend/'src'/file,target)
    for ext in ['.js','.js.map']:
     name=Path(file).with_suffix(ext);target=context/'dist'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backend/'dist'/name,target)
   copy='COPY src/ /app/src/\nCOPY dist/ /app/dist/\n'
  (context/'Dockerfile').write_text('FROM '+running[key]['Config']['Image']+'\n'+copy)
 override=r/'compose.classic-event-flow.yml';rollback=r/'compose.rollback.yml'
 override.write_text('services:\n'+''.join(f'  {services[k]}:\n    image: {images[k]}\n' for k in services));rollback.write_text('services:\n'+''.join(f"  {services[k]}:\n    image: {running[k]['Config']['Image']}\n" for k in services))
 m={'release':str(r),'services':services,'previous':{k:v['Config']['Image'] for k,v in running.items()},'images':images,'compose_files':list(dict.fromkeys(running['api']['Config']['Labels']['com.docker.compose.project.config_files'].split(',')+running['web']['Config']['Labels']['com.docker.compose.project.config_files'].split(','))),'override':str(override),'rollback':str(rollback),'before':{v['Names']:v['ID'] for v in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())}}
 (r/'manifest.json').write_text(json.dumps(m,indent=2));run(compose(m)+['config','--quiet'])
 for key in services:
  with (r/(key+'-docker-build.log')).open('w') as f:run(['docker','build','-t',images[key],str(r/(key+'-image'))],stdout=f,stderr=subprocess.STDOUT)
 print(json.dumps({'release':str(r),'builds':'PASS','compose':'PASS','deployed':False}))
elif action in ['deploy','rollback','status']:
 r=Path(POINTER.read_text().strip());m=json.loads((r/'manifest.json').read_text());args=compose(m,action=='rollback');run(args+['config','--quiet'])
 if action=='deploy':
  for k,n in m['services'].items():assert inspect(n)['Config']['Image']==m['previous'][k],'Live release changed since prepare'
 if action!='status':run(args+['up','-d','--no-deps','--no-build',*m['services'].values()])
 if action!='status':
  verify_runtime(m)
  verify_runtime(m)
  for name in m['services'].values():run(['docker','logs','--tail','10',name])
 run(args+['ps',*m['services'].values()]);now={v['Names']:v['ID'] for v in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())};changed=[n for n,i in m['before'].items() if now.get(n)!=i];assert set(changed)<=set(m['services'].values()),changed
 print(json.dumps({'status':'PASS','changed_containers':changed}))
else:raise SystemExit('Use prepare/deploy/rollback/status')
