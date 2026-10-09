"""Release restricted retro kiosk flow over the active web/API images."""
import datetime,json,os,re,shutil,subprocess,sys
from pathlib import Path
REPO=Path('/opt/photobooth');SOURCE=Path(__file__).resolve().parents[1];POINTER=Path('/tmp/photobooth-kiosk-flow-release-path')
def run(args,**kw):return subprocess.run(args,check=True,**kw)
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
def compose(m,rollback=False):
 helper=dict(v.split('=',1) for v in inspect('photobooth-image-helper')['Config']['Env'] if '=' in v)
 if helper.get('AI_ENGINE_API_KEY'):os.environ.setdefault('EXPRESS_IMAGE_ENGINE_KEY',helper['AI_ENGINE_API_KEY'])
 args=['docker','compose','--project-directory',str(REPO),'--env-file',str(REPO/'.env')]
 for file in m['compose_files']+[m['rollback'] if rollback else m['override']]:args+=['-f',file]
 return args
action=sys.argv[1]
if action=='prepare':
 web,api=inspect('photobooth-web'),inspect('photobooth-express')
 snapshot=Path(web['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1]).parent/'frontend'
 assert snapshot.is_dir(),'Running frontend snapshot required'
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');release=Path('/srv/photobooth/releases')/('kiosk-flow-'+stamp);release.mkdir()
 frontend=release/'frontend';shutil.copytree(snapshot,frontend,ignore=shutil.ignore_patterns('node_modules','dist','.vite','.env*'))
 shutil.copytree(SOURCE/'frontend/src/components/kiosk',frontend/'src/components/kiosk',dirs_exist_ok=True)
 for file in ['src/kioskWebApi.js','src/kioskWebFlow.js','src/kioskWebFlow.test.js','src/kioskCamera.js','src/kioskCamera.test.js','src/kioskCountdown.js','src/kioskCountdown.test.js','scripts/kiosk-flow-check.mjs','public/fonts/baloo2-extrabold.ttf']:
  dest=frontend/file;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(SOURCE/'frontend'/file,dest)
 (frontend/'node_modules').symlink_to(REPO/'frontend/node_modules')
 data=release/'backend/app/data';data.mkdir(parents=True)
 for file in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(REPO/'backend/app/data'/file,data/file)
 (release/'templates').symlink_to(REPO/'templates')
 assets=subprocess.check_output(['docker','exec','photobooth-web','sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode();google=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(google)==1,'Preserve the configured Google client ID'
 env={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(google))}
 for command,log in [(['npm','test'],'frontend-tests.log'),(['npm','run','build'],'frontend-build.log')]:
  with (release/log).open('w') as f:run(command,cwd=frontend,env=env,stdout=f,stderr=subprocess.STDOUT)
 backend=release/'backend-express';backend.mkdir()
 for file in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:run(['docker','cp','photobooth-express:/app/'+file,str(backend/file)],stdout=subprocess.DEVNULL)
 # Update only the kiosk boundary, preserving the active application snapshot.
 installed='kioskWebAccess' in (backend/'src/migration-app.ts').read_text()
 if installed:
  assert (backend/'src/routes/kiosk-web.routes.ts').read_bytes()==(SOURCE/'backend-express/src/routes/kiosk-web.routes.ts').read_bytes(),'Existing kiosk auth differs; review server update'
 shutil.copy2(SOURCE/'backend-express/src/routes/kiosk-web.routes.ts',backend/'src/routes/kiosk-web.routes.ts')
 own=(SOURCE/'backend-express/src/migration-app.ts').read_text();base=(backend/'src/migration-app.ts').read_text()
 if not installed:
  block=own[own.index('  // Restricted web kiosk'):own.index("  app.use('/api', customerCatalogRoutes(catalog));")]
  base=base.replace("import { nativeKioskRoutes }","import { kioskWebAccess } from './routes/kiosk-web.routes.js';\nimport { nativeKioskRoutes }")
  assert "  app.use('/api', customerCatalogRoutes(catalog));" in base,'Missing route insertion anchor'
  (backend/'src/migration-app.ts').write_text(base.replace("  app.use('/api', customerCatalogRoutes(catalog));",block+"  app.use('/api', customerCatalogRoutes(catalog));"))
 (backend/'node_modules').symlink_to(REPO/'backend-express/node_modules')
 with (release/'backend-build.log').open('w') as f:run(['node',str(REPO/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=backend,stdout=f,stderr=subprocess.STDOUT)
 apiimage=api['Config']['Image'] if installed else 'photobooth-express:kiosk-flow-'+stamp;webimage='photobooth-web:kiosk-flow-'+stamp
 apibuild=release/'api-image';apibuild.mkdir()
 for file in ['migration-app.ts','routes/kiosk-web.routes.ts']:
  dest=apibuild/'src'/file;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backend/'src'/file,dest)
  for extension in ['.js','.js.map']:
   name=Path(file).with_suffix(extension);dest=apibuild/'dist'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backend/'dist'/name,dest)
 (apibuild/'Dockerfile').write_text(f"FROM {api['Config']['Image']}\nCOPY dist/ /app/dist/\nCOPY src/ /app/src/\n")
 webbuild=release/'web-image';webbuild.mkdir();shutil.copytree(frontend/'dist',webbuild/'dist');(webbuild/'Dockerfile').write_text(f"FROM {web['Config']['Image']}\nCOPY dist/ /usr/share/nginx/html/\n")
 override=release/'compose.kiosk-flow.yml';override.write_text(f'services:\n  photobooth-express:\n    image: {apiimage}\n  photobooth-web:\n    image: {webimage}\n')
 rollback=release/'compose.rollback.yml';rollback.write_text(f"services:\n  photobooth-express:\n    image: {api['Config']['Image']}\n  photobooth-web:\n    image: {web['Config']['Image']}\n")
 before={v['Names']:v['ID'] for v in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())}
 m={'release':str(release),'api_image':apiimage,'web_image':webimage,'previous_api':api['Config']['Image'],'previous_web':web['Config']['Image'],'compose_files':web['Config']['Labels']['com.docker.compose.project.config_files'].split(','),'override':str(override),'rollback':str(rollback),'before':before,'google_preserved':True}
 (release/'manifest.json').write_text(json.dumps(m,indent=2));POINTER.write_text(str(release));run(compose(m)+['config','--quiet'])
 builds=[(webimage,webbuild,'web-docker-build.log')]
 if not installed:builds.insert(0,(apiimage,apibuild,'api-docker-build.log'))
 for image,context,log in builds:
  with (release/log).open('w') as f:run(['docker','build','-t',image,str(context)],stdout=f,stderr=subprocess.STDOUT)
 print(json.dumps({'release':str(release),'frontend_tests':'PASS','frontend_build':'PASS','backend_build':'PASS','compose':'PASS','google_preserved':True}))
elif action in ['deploy','rollback','status']:
 m=json.loads((Path(POINTER.read_text().strip())/'manifest.json').read_text());args=compose(m,action=='rollback');run(args+['config','--quiet'])
 if action=='deploy':
  assert inspect('photobooth-web')['Config']['Image']==m['previous_web'] and inspect('photobooth-express')['Config']['Image']==m['previous_api'],'Deployment changed since prepare'
 if action!='status':run(args+['up','-d','--no-deps','--no-build','photobooth-express','photobooth-web'])
 run(args+['ps','photobooth-express','photobooth-web'])
 now={v['Names']:v['ID'] for v in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())};changed=[name for name,id in m['before'].items() if now.get(name)!=id];assert set(changed).issubset({'photobooth-web','photobooth-express'}),changed
 print(json.dumps({'status':'PASS','changed_containers':changed}))
else:raise SystemExit('Use prepare, deploy, rollback, status')
