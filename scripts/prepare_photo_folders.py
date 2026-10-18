"""Prepare folder web/share candidate only; never apply SQL or deploy.
Key-authenticated Storage API implementation remains in the separate Public API
workstream. This candidate preserves live images and excludes dormant peer code.
"""
import datetime,hashlib,importlib.util,json,os,re,shutil,subprocess
from pathlib import Path
R=Path('/opt/photobooth');D=Path('/srv/photobooth/releases');SNAP=D/'express-base/compose.express-base.json'
spec=importlib.util.spec_from_file_location('previous',R/'scripts/deploy_subscription_v2.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
API='config/migration-env.ts migration-container.ts models/customer-generation.model.ts services/customer-generation-input.ts services/customer-generation.service.ts services/customer-account.service.ts services/generation-request.ts services/analytics.service.ts models/photo-folder.model.ts services/photo-folder.service.ts routes/photo-folder.routes.ts'.split()
WEB='App.jsx api.js customerRoute.js analyticsPrivacy.js components/customer/AccountCenter.jsx components/customer/PhotoFolders.jsx photoFolders.css'.split()
def run(a,**k):return subprocess.run(a,check=True,**k)
def out(a,**k):return subprocess.check_output(a,**k)
def ins(n):return json.loads(out(['docker','inspect',n]))[0]
def save(p,m):p.write_text(json.dumps(m,indent=2)+'\n')
if __name__=='__main__':
 run(['python3','-I',str(R/'scripts/snapshot_express_compose.py'),'validate'])
 targets=['photobooth-express','photobooth-express-worker','photobooth-web'];before={n:ins(n) for n in targets};p=D/('photo-folders-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));p.mkdir()
 with (p/'prepare.log').open('w') as log:
  a=p/'api-source';a.mkdir()
  for n in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:run(['docker','cp','photobooth-express:/app/'+n,str(a/n)],stdout=log,stderr=subprocess.STDOUT)
  for n in API:
   dest=a/'src'/n;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(helper.clean(n,(R/'backend-express/src'/n).read_text(),dest.read_text() if dest.exists() else '').replace('account,publicApi,folders','account,folders'))
  # Apply folder wiring to live app/server; do not include peer Public API wiring.
  app=a/'src/migration-app.ts';s=app.read_text();s="import type { PhotoFolderService } from './services/photo-folder.service.js';\nimport { photoFolderRoutes } from './routes/photo-folder.routes.js';\n"+s;s=s.replace('trustProxy?: boolean;','trustProxy?: boolean; folders?:PhotoFolderService;');s=s.replace("  app.use('/api', customerCatalogRoutes", "  if(config.folders && account) app.use('/api',photoFolderRoutes(config.folders,account,config.limiter));\n  app.use('/api', customerCatalogRoutes");app.write_text(s)
  server=a/'src/migration-server.ts';s=server.read_text().replace('admin:services.admin,','admin:services.admin,folders:services.folders,');server.write_text(s)
  (a/'node_modules').symlink_to(R/'backend-express/node_modules');(a/'test').mkdir();shutil.copy2(R/'backend-express/test/photo-folder.test.ts',a/'test/photo-folder.test.ts')
  run(['node',str(R/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=a,stdout=log,stderr=subprocess.STDOUT);run(['node','--import','tsx','--test','test/photo-folder.test.ts'],cwd=a,stdout=log,stderr=subprocess.STDOUT)
  live=out(['docker','exec','photobooth-web','cat','/usr/share/nginx/html/index.html']);source=next(x.parent.parent for x in D.glob('*/frontend/dist/index.html') if x.read_bytes()==live)
  w=p/'frontend';shutil.copytree(source,w,ignore=shutil.ignore_patterns('node_modules','dist','.env*','.vite'));(w/'node_modules').symlink_to(R/'frontend/node_modules');(p/'templates').symlink_to(R/'templates');data=p/'backend/app/data';data.mkdir(parents=True)
  for n in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(R/'backend/app/data'/n,data/n)
  for n in WEB:
   dest=w/'src'/n;dest.parent.mkdir(parents=True,exist_ok=True);s=helper.clean(n,(R/'frontend/src'/n).read_text(),dest.read_text() if dest.exists() else '')
   if n=='App.jsx':s=s.replace(', eventName, upload',', upload');assert 'setEventName' not in s and 'eventName.trim()' not in s,'Unreleased AI event-name code remains'
   dest.write_text(s)
  assets=out(['docker','exec','photobooth-web','sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode();ids=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(ids)==1
  e=dict(x.split('=',1) for x in before['photobooth-express']['Config']['Env']);buildenv={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(ids)),'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN':e.get('POSTHOG_PROJECT_TOKEN',''),'VITE_PUBLIC_POSTHOG_HOST':e.get('POSTHOG_HOST','')}
  run(['npm','run','build'],cwd=w,env=buildenv,stdout=log,stderr=subprocess.STDOUT)
  images={}
  for n in targets:
   c=p/(n+'-image');c.mkdir();images[n]=('photobooth-web' if n.endswith('-web') else 'photobooth-express')+':'+p.name+('-worker' if n.endswith('-worker') else '')
   if n.endswith('-web'):shutil.copytree(w/'dist',c/'dist');copies='COPY dist/ /usr/share/nginx/html/\n'
   else:
    for name in API+['migration-app.ts','migration-server.ts']:
     for rel in ['src/'+name,'dist/'+name.replace('.ts','.js'),'dist/'+name.replace('.ts','.js.map')]:
      dest=c/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(a/rel,dest)
    copies='COPY src/ /app/src/\nCOPY dist/ /app/dist/\n'
   (c/'Dockerfile').write_text('FROM '+before[n]['Config']['Image']+'\n'+copies);run(['docker','build','--network','none','-t',images[n],str(c)],stdout=log,stderr=subprocess.STDOUT)
 shutil.copy2(SNAP,p/'compose.express-before.json');shutil.copy2(source.parent/'compose.web-base.json',p/'compose.web-base.json');shutil.copy2(R/'backend/migrations/026_photo_folders.sql',p/'026_photo_folders.sql')
 save(p/'compose.photo-folders.json',{'services':{n:{'image':images[n],**({'environment':{'PHOTO_FOLDERS_ENABLED':'true'}} if not n.endswith('-web') else {})} for n in targets}})
 save(p/'compose.rollback.json',{'services':{n:{'image':before[n]['Config']['Image'],**({'environment':{'PHOTO_FOLDERS_ENABLED':dict(x.split('=',1) for x in before[n]['Config']['Env']).get('PHOTO_FOLDERS_ENABLED','false')}} if not n.endswith('-web') else {})} for n in targets}})
 helper_key=dict(x.split('=',1) for x in ins('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY'];env={**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':helper_key};cmd=['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.express-before.json'),'-f',str(p/'compose.web-base.json'),'-f',str(p/'compose.photo-folders.json')];run(cmd+['config','--quiet'],env=env)
 cfg=json.loads(out(cmd+['config','--format','json'],env=env))['services']
 for n in targets:
  assert before[n]['Id']==ins(n)['Id'];old=dict(x.split('=',1) for x in before[n]['Config']['Env']);assert all(k=='PHOTO_FOLDERS_ENABLED' or old.get(k)==v for k,v in cfg[n].get('environment',{}).items())
 save(p/'manifest.json',{'release':str(p),'status':'PREPARED','deployed':False,'sql_applied':False,'images':images,'previous_images':{n:before[n]['Config']['Image'] for n in targets},'previous_ids':{n:before[n]['Id'] for n in targets},'backend_files':API+['migration-app.ts','migration-server.ts'],'frontend_files':WEB,'scope':'folder web, cookie REST metadata and public share; excludes peer Public API and unreleased AI footer','external_key_storage_api':'workspace implementation tested; separate Public API activation not included','migration_sha256':hashlib.sha256((p/'026_photo_folders.sql').read_bytes()).hexdigest()})
 (D/'.photo-folders-prepared').write_text(str(p));print(json.dumps({'status':'PASS','release':str(p),'deployed':False,'images':images}))
