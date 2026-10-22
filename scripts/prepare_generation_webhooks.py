"""Prepare opt-in webhook API/worker/web images from live sources. Never applies SQL or deploys."""
import datetime,hashlib,importlib.util,json,os,re,shutil,subprocess
from pathlib import Path
R=Path('/opt/photobooth');D=Path('/srv/photobooth/releases')
spec=importlib.util.spec_from_file_location('previous',R/'scripts/prepare_developer_dashboard.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
NEW='models/generation-webhook.model.ts services/generation-webhook.service.ts services/webhook-security.ts routes/generation-webhook.routes.ts'.split()
API=NEW+['models/customer-generation.model.ts','models/public-api-key.model.ts','config/migration-env.ts','migration-container.ts','migration-app.ts','migration-worker.ts']
WEB=['components/customer/DeveloperApi.jsx','components/customer/DeveloperWebhooks.jsx','api.js','developerApi.css']
def replace(s,old,new):
 assert s.count(old)==1,old
 return s.replace(old,new,1)
def prepare():
 h.run(['python3','-I',str(R/'scripts/snapshot_express_compose.py'),'validate'])
 names=['photobooth-express','photobooth-express-worker','photobooth-web'];before={n:h.ins(n) for n in names};p=D/('generation-webhooks-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));p.mkdir()
 m={'release':str(p),'status':'PREPARING','deployed':False,'sql_applied':False,'previous_ids':{n:v['Id'] for n,v in before.items()},'previous_images':{n:v['Config']['Image'] for n,v in before.items()},'production_blockers':['Reviewed backup + explicit approval to apply027 SQL','Dedicated private encryption keyring configuration on API/worker','Fresh explicit deploy approval']};h.save(p/'manifest.json',m)
 try:
  with (p/'prepare.log').open('w') as log:
   a=p/'api-source';a.mkdir()
   for name in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:h.run(['docker','cp','photobooth-express:/app/'+name,str(a/name)],stdout=log,stderr=subprocess.STDOUT)
   for name in NEW+['models/public-api-key.model.ts','migration-worker.ts']:
    dest=a/'src'/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(R/'backend-express/src'/name,dest)
   file=a/'src/models/customer-generation.model.ts';s=file.read_text();s="import type { GenerationWebhookModel } from './generation-webhook.model.js';\n"+s;s=replace(s,'readonly folders?: PhotoFolderModel)','readonly folders?: PhotoFolderModel, readonly webhooks?: GenerationWebhookModel)');s=replace(s,'if (changed.count) await this.credits.settleIn(tx, id, false);','if (changed.count) { await this.credits.settleIn(tx, id, false); await this.webhooks?.terminalIn(tx,id); }');s=replace(s,"detail: 'WORKER_RETRY_EXHAUSTED' } });","detail: 'WORKER_RETRY_EXHAUSTED' } });\n          await this.webhooks?.terminalIn(tx,id);");s=replace(s,"detail: 'Generation result stored' } });","detail: 'Generation result stored' } });\n      await this.webhooks?.terminalIn(tx,id);");s=replace(s,"event_type: 'job_failed', detail: code } });","event_type: 'job_failed', detail: code } });\n      await this.webhooks?.terminalIn(tx,id);");file.write_text(s)
   file=a/'src/config/migration-env.ts';s=file.read_text();live=(R/'backend-express/src/config/migration-env.ts').read_text();addition=live[live.index('  GENERATION_WEBHOOKS_ENABLED:'):live.index('  PUBLIC_API_GENERATION_ENABLED:')];file.write_text(replace(s,'  PUBLIC_API_GENERATION_ENABLED:',addition+'  PUBLIC_API_GENERATION_ENABLED:'))
   file=a/'src/migration-container.ts';s=file.read_text();live=(R/'backend-express/src/migration-container.ts').read_text();s='\n'.join(live.splitlines()[:3])+'\n'+s;addition=live[live.index('  if(config.GENERATION_WEBHOOKS_ENABLED'):live.index('  const publicClient =')];s=replace(s,'  const publicClient =',addition+'  const publicClient =');s=replace(s,'    await objects?.health();','    await objects?.health();\n    '+next(v.strip() for v in live.splitlines() if v.strip().startswith('if(webhookModel)await')));s=replace(s,'subscriptions,folderModel),generations=','subscriptions,folderModel,webhookModel),generations=');s=replace(s,'new PublicApiKeyModel(db);','new PublicApiKeyModel(db,Boolean(webhooks));');s=replace(s,'keyModel:publicKeyModel,dashboard:','keyModel:publicKeyModel,webhooks,dashboard:');s=replace(s,'return {catalog,account,publicApi,folders,','return {catalog,account,publicApi,webhooks,folders,');file.write_text(s)
   file=a/'src/migration-app.ts';s=file.read_text();s="import type { GenerationWebhookService } from './services/generation-webhook.service.js';\nimport { generationWebhookRoutes } from './routes/generation-webhook.routes.js';\n"+s;s=replace(s,'{dashboard?:DeveloperDashboardService}','{dashboard?:DeveloperDashboardService;webhooks?:GenerationWebhookService}');s=replace(s,'dashboard: Boolean(config.publicApi?.dashboard),','dashboard: Boolean(config.publicApi?.dashboard), webhooks: Boolean(config.publicApi?.webhooks),');s=replace(s,"    app.use('/api/account/api-keys',", "    if(config.publicApi.webhooks)app.use('/api/account/api-keys', ...(config.limiter ? [config.limiter.middleware('integration-webhook-management',30)] : []), generationWebhookRoutes(config.publicApi.webhooks,account));\n    app.use('/api/account/api-keys',");file.write_text(s)
   (a/'node_modules').symlink_to(R/'backend-express/node_modules');(a/'test').mkdir()
   for name in ['generation-webhook.test.ts','generation-webhook.integration.ts','public-api.test.ts','developer-dashboard.test.ts']:shutil.copy2(R/'backend-express/test'/name,a/'test'/name)
   h.run(['node',str(R/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=a,stdout=log,stderr=subprocess.STDOUT)
   h.run(['node','--import','tsx','--test','test/generation-webhook.test.ts','test/public-api.test.ts','test/developer-dashboard.test.ts'],cwd=a,stdout=log,stderr=subprocess.STDOUT)
   live=h.out(['docker','exec','photobooth-web','cat','/usr/share/nginx/html/index.html']);source=next(x.parent.parent for x in D.glob('*/frontend/dist/index.html') if x.read_bytes()==live)
   w=p/'frontend';shutil.copytree(source,w,ignore=shutil.ignore_patterns('node_modules','dist','.env*','.vite'));(w/'node_modules').symlink_to(R/'frontend/node_modules');(p/'templates').symlink_to(R/'templates');shutil.copytree(R/'backend/migrations',p/'backend/migrations');data=p/'backend/app/data';data.mkdir(parents=True)
   for name in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(R/'backend/app/data'/name,data/name)
   for name in WEB:
    dest=w/'src'/name;dest.parent.mkdir(parents=True,exist_ok=True);current=(R/'frontend/src'/name).read_text()
    if name=='api.js':text=dest.read_text()+'\nconst webhookPath='+current.split('const webhookPath=',1)[1]
    elif name=='developerApi.css':text=dest.read_text()+'\n.developer-webhooks'+current.split('.developer-webhooks',1)[1]
    else:text=current
    dest.write_text(text)
   unchanged=[str(f.relative_to(w/'src')) for f in (w/'src').rglob('*') if f.is_file() and str(f.relative_to(w/'src')) not in WEB];assert all((w/'src'/f).read_bytes()==(source/'src'/f).read_bytes() for f in unchanged)
   assets=h.out(['docker','exec','photobooth-web','sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode();ids=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(ids)==1
   env=dict(x.split('=',1) for x in before['photobooth-express']['Config']['Env']);buildenv={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(ids)),'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN':env.get('POSTHOG_PROJECT_TOKEN',''),'VITE_PUBLIC_POSTHOG_HOST':env.get('POSTHOG_HOST','')}
   h.run(['npm','run','build'],cwd=w,env=buildenv,stdout=log,stderr=subprocess.STDOUT)
   images={}
   for name in ['photobooth-express','photobooth-web']:
    context=p/(name+'-image');context.mkdir();images[name]=name+':'+p.name
    if name=='photobooth-web':shutil.copytree(w/'dist',context/'dist');copies='COPY dist/ /usr/share/nginx/html/\n'
    else:
     for name2 in API:
      for rel in ['src/'+name2,'dist/'+name2.replace('.ts','.js'),'dist/'+name2.replace('.ts','.js.map')]:dest=context/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(a/rel,dest)
     copies='COPY src/ /app/src/\nCOPY dist/ /app/dist/\n'
    (context/'Dockerfile').write_text('FROM '+before[name]['Config']['Image']+'\n'+copies);h.run(['docker','build','--network','none','-t',images[name],str(context)],stdout=log,stderr=subprocess.STDOUT)
   images['photobooth-express-worker']=images['photobooth-express']
  shutil.copy2(D/'express-base/compose.express-base.json',p/'compose.express-before.json');shutil.copy2(source.parent/'compose.web-base.json',p/'compose.web-base.json')
  config={'services':{name:{'image':images[name]} for name in names}}
  for name in ['photobooth-express','photobooth-express-worker']:config['services'][name]['environment']={'GENERATION_WEBHOOKS_ENABLED':'true','PUBLIC_API_GENERATION_ENABLED':'true','PUBLIC_API_KEY_PEPPER':'${WEBHOOK_PUBLIC_API_PEPPER:?supply current stable API pepper privately}','WEBHOOK_SECRET_ENCRYPTION_KEY':'${NXBOOTH_WEBHOOK_KEYRING:?configure private keyring}','WEBHOOK_SECRET_ENCRYPTION_VERSION':'${NXBOOTH_WEBHOOK_KEY_VERSION:-v1}'}
  h.save(p/'compose.generation-webhooks.json',config);h.save(p/'compose.rollback.json',{'services':{n:{'image':before[n]['Config']['Image']} for n in names}})
  validation_env={**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':h.h.env('photobooth-image-helper')['AI_ENGINE_API_KEY'],'WEBHOOK_PUBLIC_API_PEPPER':'synthetic-validation-only-'.ljust(40,'x'),'NXBOOTH_WEBHOOK_KEYRING':json.dumps({'v1':'0'*64})}
  h.run(['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.express-before.json'),'-f',str(p/'compose.web-base.json'),'-f',str(p/'compose.generation-webhooks.json'),'config','--quiet'],env=validation_env)
  assert all(h.ins(n)['Id']==before[n]['Id'] for n in names),'Live release changed during prepare; reprepare'
  m.update(migration_sha256=hashlib.sha256((p/'backend/migrations/027_generation_webhooks.sql').read_bytes()).hexdigest(),status='PREPARED_PENDING_ACTIVATION',images=images,backend_files=API,frontend_files=WEB,preserved_frontend_files=len(unchanged),schema_change=True,worker_base='Uses current API image source, which includes dashboard/API attribution modules; worker command/env/mounts from persistent snapshot preserved',secret_configuration='Only unresolved environment placeholders in Compose; no private keyring generated or persisted')
  h.save(p/'manifest.json',m);(D/'.generation-webhooks-prepared').write_text(str(p));print(json.dumps({'status':'PASS','release':str(p),'deployed':False}))
 except Exception:m['status']='PREPARE_FAILED';h.save(p/'manifest.json',m);raise
if __name__=='__main__':prepare()
