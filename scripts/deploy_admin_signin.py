"""Isolated account-based admin sign-in release over the running images."""
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

REPO=Path('/opt/photobooth')
POINTER=Path('/tmp/photobooth-admin-signin-release-path')
BACKEND_FILES=['models/admin-auth.model.ts','services/admin-auth.service.ts','services/admin-operations.service.ts','controllers/admin.controller.ts','routes/admin.routes.ts']
FRONTEND_FILES=['src/AdminPage.jsx','src/api.js','src/components/admin/AdminShell.jsx','src/components/admin/AdminSignInGate.jsx','src/admin-retro.css','src/adminSignIn.test.js','scripts/admin-signin-browser-check.mjs']
def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
def compose(manifest):
 helper=dict(v.split('=',1) for v in inspect('photobooth-image-helper')['Config']['Env'] if '=' in v)
 if helper.get('AI_ENGINE_API_KEY'):os.environ.setdefault('EXPRESS_IMAGE_ENGINE_KEY',helper['AI_ENGINE_API_KEY'])
 args=['docker','compose','--project-directory',str(REPO),'--env-file',str(REPO/'.env')]
 for path in manifest['compose_files']+[manifest['override']]:args+=['-f',path]
 return args
action=sys.argv[1]
if action=='prepare':
 api=inspect('photobooth-express');web=inspect('photobooth-web')
 assert web['Config']['Image'].startswith(('photobooth-web:admin-','photobooth-web:admin-signin-')),'Unexpected frontend base'
 source_snapshot=Path(web['Config']['Labels']['com.docker.compose.project.config_files'].split(',')[-1]).parent/'frontend'
 assert source_snapshot.is_dir(),'Running frontend source snapshot unavailable'
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 release=Path('/srv/photobooth/releases')/('admin-signin-'+stamp);release.mkdir()
 frontend=release/'frontend';shutil.copytree(source_snapshot,frontend,ignore=shutil.ignore_patterns('node_modules','dist','.vite','.env*'))
 for file in FRONTEND_FILES:
  dest=frontend/file;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(REPO/'frontend'/file,dest)
 (frontend/'node_modules').symlink_to(REPO/'frontend/node_modules')
 data=release/'backend/app/data';data.mkdir(parents=True)
 for fixture in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(REPO/'backend/app/data'/fixture,data/fixture)
 (release/'templates').symlink_to(REPO/'templates')
 js=subprocess.check_output(['docker','exec','photobooth-web','sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode()
 ids=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',js));assert len(ids)<=1
 env={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(ids),'')}
 for cmd,log in [(['npm','test'],'frontend-tests.log'),(['npm','run','build'],'frontend-build.log')]:run(cmd,cwd=frontend,env=env,stdout=(release/log).open('w'),stderr=subprocess.STDOUT)
 backend=release/'backend-express';backend.mkdir()
 for file in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:
  run(['docker','cp','photobooth-express:/app/'+file,str(backend/file)],stdout=subprocess.DEVNULL)
 for file in BACKEND_FILES:shutil.copy2(REPO/'backend-express/src'/file,backend/'src'/file)
 (backend/'node_modules').symlink_to(REPO/'backend-express/node_modules')
 run(['node',str(REPO/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=backend,stdout=(release/'backend-build.log').open('w'),stderr=subprocess.STDOUT)
 apiimage='photobooth-express:admin-signin-'+stamp;webimage='photobooth-web:admin-signin-'+stamp
 apibuild=release/'api-image';apibuild.mkdir();(apibuild/'dist').mkdir()
 for file in BACKEND_FILES:
  for ext in ['.js','.js.map']:
   name=str(Path(file).with_suffix(ext));dest=apibuild/'dist'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backend/'dist'/name,dest)
 for file in BACKEND_FILES:
  dest=apibuild/'src'/file;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backend/'src'/file,dest)
 (apibuild/'Dockerfile').write_text(f"FROM {api['Config']['Image']}\nCOPY dist/ /app/dist/\nCOPY src/ /app/src/\n")
 webbuild=release/'web-image';webbuild.mkdir();shutil.copytree(frontend/'dist',webbuild/'dist')
 (webbuild/'Dockerfile').write_text(f"FROM {web['Config']['Image']}\nCOPY dist/ /usr/share/nginx/html/\n")
 override=release/'compose.admin-signin.yml';override.write_text(f'services:\n  photobooth-express:\n    image: {apiimage}\n  photobooth-web:\n    image: {webimage}\n')
 rollback=release/'compose.rollback.yml';rollback.write_text(f"services:\n  photobooth-express:\n    image: {api['Config']['Image']}\n  photobooth-web:\n    image: {web['Config']['Image']}\n")
 before={v['Names']:v['ID'] for v in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())}
 manifest={'release':str(release),'image':webimage,'api_image':apiimage,'previous_web_image':web['Config']['Image'],'previous_api_image':api['Config']['Image'],'previous_web_id':web['Image'],'previous_api_id':api['Image'],'compose_files':web['Config']['Labels']['com.docker.compose.project.config_files'].split(','),'override':str(override),'rollback_override':str(rollback),'before_containers':before,'backend_files':BACKEND_FILES,'frontend_files':FRONTEND_FILES,'google_preserved':bool(ids)}
 (release/'manifest.json').write_text(json.dumps(manifest,indent=2));POINTER.write_text(str(release))
 run(compose(manifest)+['config','--quiet'])
 for img,context,log in [(apiimage,apibuild,'api-docker-build.log'),(webimage,webbuild,'web-docker-build.log')]:run(['docker','build','-t',img,str(context)],stdout=(release/log).open('w'),stderr=subprocess.STDOUT)
 print(json.dumps({'release':str(release),'image':webimage,'api_image':apiimage,'frontend_tests':'PASS','builds':'PASS','compose':'PASS'}))
elif action in ['deploy','status','rollback']:
 manifest=json.loads((Path(POINTER.read_text())/'manifest.json').read_text())
 if action=='rollback':manifest['override']=manifest['rollback_override']
 args=compose(manifest);run(args+['config','--quiet'])
 if action=='deploy':
  assert inspect('photobooth-web')['Image']==manifest['previous_web_id'] and inspect('photobooth-express')['Image']==manifest['previous_api_id'],'Active release changed'
 if action!='status':run(args+['up','-d','--no-deps','--no-build','photobooth-express','photobooth-web'])
 run(args+['ps'])
 after={v['Names']:v['ID'] for v in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())}
 assert all(after.get(name)==value for name,value in manifest['before_containers'].items() if name not in ['photobooth-express','photobooth-web','photobooth-admin-signin-test-postgres']),'Unrelated container changed'
 print(json.dumps({'release':manifest['release'],'other_containers_unchanged':True,'web':inspect('photobooth-web')['Config']['Image'],'api':inspect('photobooth-express')['Config']['Image']}))
else:raise SystemExit('Use prepare, deploy, status, rollback')
