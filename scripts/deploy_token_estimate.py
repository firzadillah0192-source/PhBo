"""Coordinated wallet/checkout release built on the active web/API/worker sources."""
import datetime,json,os,re,shutil,subprocess,sys
from pathlib import Path
REPO=Path('/opt/photobooth');POINTER=Path('/tmp/photobooth-token-estimate-release-path')
BF=['services/generation-credit-charge.service.ts','services/image-pricing.service.ts','services/credit-pricing.service.ts','services/native-provider.service.ts','models/provider-run.model.ts']
FF=['src/App.jsx','src/components/customer/ResultStage.jsx','src/components/customer/ReviewStage.jsx']
def run(args,**kw):return subprocess.run(args,check=True,**kw)
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
def compose(m,rollback=False):
 helper=dict(v.split('=',1) for v in inspect('photobooth-image-helper')['Config']['Env'] if '=' in v)
 if helper.get('AI_ENGINE_API_KEY'):os.environ.setdefault('EXPRESS_IMAGE_ENGINE_KEY',helper['AI_ENGINE_API_KEY'])
 args=['docker','compose','--project-directory',str(REPO),'--env-file',str(REPO/'.env')]
 for file in m['compose_files']+[m['rollback'] if rollback else m['override']]:args+=['-f',file]
 return args
r=Path(POINTER.read_text().strip());action=sys.argv[1]
if action=='prepare':
 services={'api':'photobooth-express','worker':'photobooth-express-worker','web':'photobooth-web'};running={key:inspect(name) for key,name in services.items()};stamp=r.name.removeprefix('token-estimate-')
 web=running['web'];snapshot=Path(web['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1]).parent/'frontend';assert snapshot.is_dir()
 frontend=r/'frontend';shutil.copytree(snapshot,frontend,ignore=shutil.ignore_patterns('node_modules','dist','.vite','.env*'))
 for file in FF:
  dest=frontend/file;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(REPO/'frontend'/file,dest)
 (frontend/'node_modules').symlink_to(REPO/'frontend/node_modules')
 data=r/'backend/app/data';data.mkdir(parents=True)
 for file in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(REPO/'backend/app/data'/file,data/file)
 (r/'templates').symlink_to(REPO/'templates')
 assets=subprocess.check_output(['docker','exec','photobooth-web','sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode();ids=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(ids)==1
 env={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(ids))}
 for command,log in [(['npm','test'],'frontend-tests.log'),(['npm','run','build'],'frontend-build.log')]:
  with (r/log).open('w') as f:run(command,cwd=frontend,env=env,stdout=f,stderr=subprocess.STDOUT)
 images={'api':'photobooth-express:token-estimate-api-'+stamp,'worker':'photobooth-express:token-estimate-worker-'+stamp,'web':'photobooth-web:token-estimate-'+stamp}
 for key in ['api','worker']:
  backend=r/(key+'-source');backend.mkdir();shutil.copytree(r/(key+'-baseline/src'),backend/'src')
  for file in ['prisma','package.json','tsconfig.json','tsconfig.build.json']:run(['docker','cp',services[key]+':/app/'+file,str(backend/file)],stdout=subprocess.DEVNULL)
  for file in BF:
   dest=backend/'src'/file;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(REPO/'backend-express/src'/file,dest)
  (backend/'node_modules').symlink_to(REPO/'backend-express/node_modules')
  with (r/(key+'-compile.log')).open('w') as f:run(['node',str(REPO/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=backend,stdout=f,stderr=subprocess.STDOUT)
  context=r/(key+'-image');context.mkdir()
  for file in BF:
   dest=context/'src'/file;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backend/'src'/file,dest)
   for ext in ['.js','.js.map']:
    name=Path(file).with_suffix(ext);dest=context/'dist'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backend/'dist'/name,dest)
  (context/'Dockerfile').write_text(f"FROM {running[key]['Config']['Image']}\nCOPY src/ /app/src/\nCOPY dist/ /app/dist/\n")
 context=r/'web-image';context.mkdir();shutil.copytree(frontend/'dist',context/'dist');(context/'Dockerfile').write_text(f"FROM {web['Config']['Image']}\nCOPY dist/ /usr/share/nginx/html/\n")
 override=r/'compose.token-estimate.yml';rollback=r/'compose.rollback.yml'
 override.write_text('services:\n'+''.join(f'  {services[k]}:\n    image: {images[k]}\n' for k in services))
 rollback.write_text('services:\n'+''.join(f"  {services[k]}:\n    image: {running[k]['Config']['Image']}\n" for k in services))
 before={v['Names']:v['ID'] for v in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())}
 m={'release':str(r),'compose_files':web['Config']['Labels']['com.docker.compose.project.config_files'].split(','),'override':str(override),'rollback':str(rollback),'images':images,'previous':{k:v['Config']['Image'] for k,v in running.items()},'before':before,'backend_files':BF,'frontend_files':FF,'services':services,'google_preserved':True}
 (r/'manifest.json').write_text(json.dumps(m,indent=2));run(compose(m)+['config','--quiet'])
 for key in services:
  with (r/(key+'-docker-build.log')).open('w') as f:run(['docker','build','-t',images[key],str(r/(key+'-image'))],stdout=f,stderr=subprocess.STDOUT)
 print(json.dumps({'release':str(r),'builds':'PASS','compose':'PASS'}))
elif action in ['deploy','rollback','status']:
 m=json.loads((r/'manifest.json').read_text());args=compose(m,action=='rollback');run(args+['config','--quiet'])
 if action=='deploy':
  for key,name in m['services'].items():assert inspect(name)['Config']['Image']==m['previous'][key],'Live release changed since prepare'
 if action!='status':run(args+['up','-d','--no-deps','--no-build',*m['services'].values()])
 run(args+['ps',*m['services'].values()])
 now={v['Names']:v['ID'] for v in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())};changed=[name for name,id in m['before'].items() if now.get(name)!=id];assert set(changed).issubset(set(m['services'].values()) | {'photobooth-credit-test-postgres'}),changed
 print(json.dumps({'status':'PASS','changed_containers':[n for n in changed if n in m['services'].values()],'temporary_test_database_removed':'photobooth-credit-test-postgres' in changed}))
else:raise SystemExit('Use prepare, deploy, rollback, status')
