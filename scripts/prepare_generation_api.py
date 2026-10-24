"""Build a Generation API candidate on the deployed Storage baseline; no deploy, SQL or secret changes."""
import datetime, hashlib, importlib.util, json, os, re, secrets, shutil, subprocess
from pathlib import Path
R=Path('/opt/photobooth');D=Path('/srv/photobooth/releases');SNAP=D/'express-base/compose.express-base.json'
spec=importlib.util.spec_from_file_location('previous',R/'scripts/deploy_subscription_v2.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
NEW='routes/public-api.routes.ts routes/storage-openapi.ts'.split()
API=NEW+['migration-app.ts','migration-container.ts']
WEB='components/customer/DeveloperApi.jsx components/customer/GenerationApiExplorer.jsx developerApi.css api.js'.split()
TARGETS=['photobooth-express','photobooth-web']
def run(a,**kw):return subprocess.run(a,check=True,**kw)
def out(a,**kw):return subprocess.check_output(a,**kw)
def ins(n):return json.loads(out(['docker','inspect',n]))[0]
def save(p,data):p.write_text(json.dumps(data,indent=2)+'\n')
def prepare():
 run(['python3','-I',str(R/'scripts/snapshot_express_compose.py'),'validate'])
 before={n:ins(n) for n in TARGETS};p=D/('generation-api-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));p.mkdir()
 manifest={'release':str(p),'status':'PREPARING','deployed':False,'sql_applied':False,'previous_ids':{n:i['Id'] for n,i in before.items()},'previous_images':{n:i['Config']['Image'] for n,i in before.items()}}
 save(p/'manifest.json',manifest)
 try:
  with (p/'prepare.log').open('w') as log:
   a=p/'api-source';a.mkdir()
   for name in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:run(['docker','cp','photobooth-express:/app/'+name,str(a/name)],stdout=log,stderr=subprocess.STDOUT)
   for name in NEW+['migration-app.ts']:
    dest=a/'src'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(R/'backend-express/src'/name,dest)
   container=a/'src/migration-container.ts';s=container.read_text();s=s.replace('    await objects?.health();',"    await objects?.health();\n    if(config.PUBLIC_API_GENERATION_ENABLED && !config.SUBSCRIPTION_V2_ENABLED) throw new Error('Public generation requires subscription v2');");container.write_text(s)
   (a/'node_modules').symlink_to(R/'backend-express/node_modules');(a/'test').mkdir();shutil.copy2(R/'backend-express/test/public-api.test.ts',a/'test/public-api.test.ts')
   run(['node',str(R/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=a,stdout=log,stderr=subprocess.STDOUT)
   run(['node','--import','tsx','--test','test/public-api.test.ts'],cwd=a,stdout=log,stderr=subprocess.STDOUT)
   live=out(['docker','exec','photobooth-web','cat','/usr/share/nginx/html/index.html']);source=next(x.parent.parent for x in D.glob('*/frontend/dist/index.html') if x.read_bytes()==live)
   w=p/'frontend';shutil.copytree(source,w,ignore=shutil.ignore_patterns('node_modules','dist','.env*','.vite'));(w/'node_modules').symlink_to(R/'frontend/node_modules');(p/'templates').symlink_to(R/'templates');data=p/'backend/app/data';data.mkdir(parents=True)
   for name in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(R/'backend/app/data'/name,data/name)
   for name in WEB:
    dest=w/'src'/name;dest.parent.mkdir(parents=True,exist_ok=True)
    if name=='api.js':s=dest.read_text()+'\n// Explicit Generation Explorer actions'+(R/'frontend/src/api.js').read_text().split('// Explicit Generation Explorer actions',1)[1]
    else:s=h.clean(name,(R/'frontend/src'/name).read_text(),dest.read_text() if dest.exists() else '')
    if name=='App.jsx':s=s.replace(', eventName, upload',', upload');assert 'setEventName' not in s and 'eventName.trim()' not in s
    dest.write_text(s)
   assets=out(['docker','exec','photobooth-web','sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode();ids=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(ids)==1
   env=dict(x.split('=',1) for x in before['photobooth-express']['Config']['Env']);buildenv={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(ids)),'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN':env.get('POSTHOG_PROJECT_TOKEN',''),'VITE_PUBLIC_POSTHOG_HOST':env.get('POSTHOG_HOST','')}
   run(['npm','run','build'],cwd=w,env=buildenv,stdout=log,stderr=subprocess.STDOUT)
   images={}
   for name in TARGETS:
    context=p/(name+'-image');context.mkdir();images[name]=name+':'+p.name
    if name=='photobooth-web':shutil.copytree(w/'dist',context/'dist');copies='COPY dist/ /usr/share/nginx/html/\n'
    else:
     for name2 in API:
      for rel in ['src/'+name2,'dist/'+name2.replace('.ts','.js'),'dist/'+name2.replace('.ts','.js.map')]:dest=context/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(a/rel,dest)
     copies='COPY src/ /app/src/\nCOPY dist/ /app/dist/\n'
    (context/'Dockerfile').write_text('FROM '+before[name]['Config']['Image']+'\n'+copies);run(['docker','build','--network','none','-t',images[name],str(context)],stdout=log,stderr=subprocess.STDOUT)
  shutil.copy2(SNAP,p/'compose.express-before.json');shutil.copy2(source.parent/'compose.web-base.json',p/'compose.web-base.json')
  save(p/'compose.generation-api.json',{'services':{name:{'image':images[name],**({'environment':{'PUBLIC_API_GENERATION_ENABLED':'true'}} if name=='photobooth-express' else {})} for name in TARGETS}})
  save(p/'compose.rollback.json',{'services':{name:{'image':before[name]['Config']['Image']} for name in TARGETS}})
  key=dict(x.split('=',1) for x in ins('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY'];e={**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':key}
  cmd=['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.express-before.json'),'-f',str(p/'compose.web-base.json'),'-f',str(p/'compose.generation-api.json')];run(cmd+['config','--quiet'],env=e)
  cfg=json.loads(out(cmd+['config','--format','json'],env=e))['services']
  for name in TARGETS:
   assert before[name]['Id']==ins(name)['Id'],'Live service changed while preparing';old=dict(x.split('=',1) for x in before[name]['Config']['Env']);assert all(k in ['PUBLIC_API_GENERATION_ENABLED'] or old.get(k)==v for k,v in cfg[name].get('environment',{}).items())
   assert {(x['Source'],x['Destination'],x['RW']) for x in before[name]['Mounts']}=={(x['source'],x['target'],not x.get('read_only',False)) for x in cfg[name].get('volumes',[])},'Mount drift'
  manifest.update(status='PREPARED',images=images,backend_files=API,frontend_files=WEB,scope='Standard template Generation API and Explorer, 50 AI Credit; current subscription/storage rules preserved; excludes peer UI redesign, Fast and custom prompts',secret_configuration='Unchanged; preserves existing stable private pepper',schema_change=False)
  save(p/'manifest.json',manifest);(D/'.generation-api-prepared').write_text(str(p));print(json.dumps({'status':'PASS','release':str(p),'images':images,'deployed':False}))
 except Exception:
  manifest['status']='PREPARE_FAILED';save(p/'manifest.json',manifest);raise
if __name__=='__main__':prepare()
