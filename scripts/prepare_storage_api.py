"""Build a reviewable Storage API candidate from live source; no SQL/deploy/secret changes."""
import datetime, hashlib, importlib.util, json, os, re, secrets, shutil, subprocess
from pathlib import Path
R=Path('/opt/photobooth');D=Path('/srv/photobooth/releases');SNAP=D/'express-base/compose.express-base.json'
spec=importlib.util.spec_from_file_location('previous',R/'scripts/deploy_subscription_v2.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
NEW='models/public-api-key.model.ts services/public-api-key.service.ts routes/public-api.routes.ts routes/public-api-keys.routes.ts routes/storage-openapi.ts'.split()
API=NEW+['config/migration-env.ts','migration-app.ts','migration-container.ts','migration-server.ts']
WEB='App.jsx customerRoute.js components/customer/AccountCenter.jsx components/customer/DeveloperApi.jsx developerApi.css'.split()+['api.js']
TARGETS=['photobooth-express','photobooth-web']
def run(a,**kw):return subprocess.run(a,check=True,**kw)
def out(a,**kw):return subprocess.check_output(a,**kw)
def ins(n):return json.loads(out(['docker','inspect',n]))[0]
def save(p,data):p.write_text(json.dumps(data,indent=2)+'\n')
def prepare():
 run(['python3','-I',str(R/'scripts/snapshot_express_compose.py'),'validate'])
 before={n:ins(n) for n in TARGETS};p=D/('storage-api-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));p.mkdir()
 manifest={'release':str(p),'status':'PREPARING','deployed':False,'sql_applied':False,'previous_ids':{n:i['Id'] for n,i in before.items()},'previous_images':{n:i['Config']['Image'] for n,i in before.items()}}
 save(p/'manifest.json',manifest)
 try:
  with (p/'prepare.log').open('w') as log:
   a=p/'api-source';a.mkdir()
   for name in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:run(['docker','cp','photobooth-express:/app/'+name,str(a/name)],stdout=log,stderr=subprocess.STDOUT)
   for name in NEW+['migration-app.ts']:
    dest=a/'src'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(R/'backend-express/src'/name,dest)
   cfg=a/'src/config/migration-env.ts';s=cfg.read_text();s=s.replace('export const migrationConfigSchema = z.object({',"export const migrationConfigSchema = z.object({\n  PUBLIC_API_KEY_PEPPER: z.union([z.literal(''),z.string().min(32)]).default(''),\n  PUBLIC_API_GENERATION_ENABLED: z.enum(['true','false']).default('false').transform(value=>value==='true'),");cfg.write_text(s)
   container=a/'src/migration-container.ts';s=container.read_text();s="import { PublicApiKeyModel } from './models/public-api-key.model.js';\nimport { PublicApiKeyService } from './services/public-api-key.service.js';\n"+s;s=s.replace('    await objects?.health();',"    await objects?.health();\n    if(config.PUBLIC_API_KEY_PEPPER) await db.$queryRaw`SELECT k.secret_hash,u.key_id FROM integration_api_keys k LEFT JOIN integration_api_key_usage u ON false LIMIT 0`;")
   s=s.replace('  return {catalog,account,folders,',"  const publicKeyModel=new PublicApiKeyModel(db);\n  const publicApi=config.PUBLIC_API_KEY_PEPPER?{keys:new PublicApiKeyService(publicKeyModel,config.PUBLIC_API_KEY_PEPPER),keyModel:publicKeyModel,generationEnabled:config.PUBLIC_API_GENERATION_ENABLED,window:(key:string,seconds:number)=>rateLimitStore.window(key,seconds)}:undefined;\n  return {catalog,account,publicApi,folders,");assert 'const publicApi=' in s;container.write_text(s)
   server=a/'src/migration-server.ts';s=server.read_text().replace('admin:services.admin,','admin:services.admin,publicApi:services.publicApi,');server.write_text(s)
   (a/'node_modules').symlink_to(R/'backend-express/node_modules');(a/'test').mkdir();shutil.copy2(R/'backend-express/test/public-api.test.ts',a/'test/public-api.test.ts')
   run(['node',str(R/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=a,stdout=log,stderr=subprocess.STDOUT)
   run(['node','--import','tsx','--test','test/public-api.test.ts'],cwd=a,stdout=log,stderr=subprocess.STDOUT)
   live=out(['docker','exec','photobooth-web','cat','/usr/share/nginx/html/index.html']);source=next(x.parent.parent for x in D.glob('*/frontend/dist/index.html') if x.read_bytes()==live)
   w=p/'frontend';shutil.copytree(source,w,ignore=shutil.ignore_patterns('node_modules','dist','.env*','.vite'));(w/'node_modules').symlink_to(R/'frontend/node_modules');(p/'templates').symlink_to(R/'templates');data=p/'backend/app/data';data.mkdir(parents=True)
   for name in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(R/'backend/app/data'/name,data/name)
   for name in WEB:
    dest=w/'src'/name;dest.parent.mkdir(parents=True,exist_ok=True)
    if name=='api.js':s=dest.read_text()+'\n// Management uses'+(R/'frontend/src/api.js').read_text().split('// Management uses',1)[1]
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
  shutil.copy2(SNAP,p/'compose.express-before.json');shutil.copy2(source.parent/'compose.web-base.json',p/'compose.web-base.json');shutil.copy2(R/'backend/migrations/025_public_api_keys.sql',p/'025_public_api_keys.sql')
  save(p/'compose.storage-api.json',{'services':{name:{'image':images[name],**({'environment':{'PUBLIC_API_KEY_PEPPER':'${PUBLIC_API_KEY_PEPPER:?set private pepper before deploy}','PUBLIC_API_GENERATION_ENABLED':'false'}} if name=='photobooth-express' else {})} for name in TARGETS}})
  save(p/'compose.rollback.json',{'services':{name:{'image':before[name]['Config']['Image']} for name in TARGETS}})
  key=dict(x.split('=',1) for x in ins('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY'];e={**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':key,'PUBLIC_API_KEY_PEPPER':secrets.token_hex(32)}
  cmd=['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.express-before.json'),'-f',str(p/'compose.web-base.json'),'-f',str(p/'compose.storage-api.json')];run(cmd+['config','--quiet'],env=e)
  cfg=json.loads(out(cmd+['config','--format','json'],env=e))['services']
  for name in TARGETS:
   assert before[name]['Id']==ins(name)['Id'],'Live service changed while preparing';old=dict(x.split('=',1) for x in before[name]['Config']['Env']);assert all(k in ['PUBLIC_API_KEY_PEPPER','PUBLIC_API_GENERATION_ENABLED'] or old.get(k)==v for k,v in cfg[name].get('environment',{}).items())
   assert {(x['Source'],x['Destination'],x['RW']) for x in before[name]['Mounts']}=={(x['source'],x['target'],not x.get('read_only',False)) for x in cfg[name].get('volumes',[])},'Mount drift'
  manifest.update(status='PREPARED',images=images,backend_files=API,frontend_files=WEB,migration_sha256=hashlib.sha256((p/'025_public_api_keys.sql').read_bytes()).hexdigest(),scope='Read-only key-authenticated Storage, key management UI and documentation/Explorer; public generation disabled; worker and helper unchanged',secret_configuration='Not changed. Requires owner-approved private pepper configuration before activation.')
  save(p/'manifest.json',manifest);(D/'.storage-api-prepared').write_text(str(p));print(json.dumps({'status':'PASS','release':str(p),'images':images,'deployed':False}))
 except Exception:
  manifest['status']='PREPARE_FAILED';save(p/'manifest.json',manifest);raise
if __name__=='__main__':prepare()
