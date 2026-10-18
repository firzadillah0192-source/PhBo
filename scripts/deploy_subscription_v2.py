"""Isolated subscription v2 prepare/deploy. Owner approval required for deploy.
Only SQL024 is applied, after a verified dump; Public API025 is excluded.
"""
import datetime, hashlib, json, os, re, shutil, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path
R=Path('/opt/photobooth'); D=Path('/srv/photobooth/releases'); PTR=D/'.subscription-v2-current'; SNAP=D/'express-base/compose.express-base.json'
TARGETS=['photobooth-express','photobooth-express-worker','photobooth-web']
API='config/migration-env.ts controllers/admin.controller.ts controllers/customer-account.controller.ts migration-container.ts models/credit-accounting.model.ts models/customer-account.model.ts models/customer-generation.model.ts models/customer-result.model.ts models/subscription-wallet.model.ts models/payment.model.ts services/customer-account.service.ts services/customer-generation-input.ts services/customer-generation.service.ts services/customer-result.service.ts services/native-generation-runner.service.ts services/native-provider.service.ts services/admin-operations.service.ts services/admin-usage.service.ts services/payment.service.ts services/duitku-sandbox.service.ts services/subscription-policy.service.ts services/generation-api-routes.service.ts routes/admin.routes.ts routes/customer-account.routes.ts routes/generation-api.routes.ts'.split()
WEB='App.jsx api.js AdminPage.jsx subscription.css components/admin/AdminShell.jsx components/admin/PaymentsPanel.jsx components/admin/GenerationApiRoutes.jsx components/customer/AccountCenter.jsx components/customer/CreditTopUp.jsx components/customer/CreditTopUpModal.jsx components/customer/CustomerNav.jsx components/customer/ResultStage.jsx components/customer/ReviewStage.jsx components/customer/PaymentHistory.jsx components/customer/SubscriptionPlans.jsx'.split()
def run(a,**k):return subprocess.run(a,check=True,**k)
def out(a,**k):return subprocess.check_output(a,**k)
def ins(n):return json.loads(out(['docker','inspect',n]))[0]
def save(p,x):p.write_text(json.dumps(x,indent=2)+'\n')
def env(n):return dict(v.split('=',1) for v in ins(n)['Config']['Env'] if '=' in v)
def snapshot():run([sys.executable,'-I',str(R/'scripts/snapshot_express_compose.py'),'validate'])
def containers():return {v['Names']:v['ID'] for v in map(json.loads,out(['docker','ps','--format','{{json .}}']).decode().splitlines())}
def compose(p,rollback=False):return ['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.express-before.json'),'-f',str(p/'compose.web-base.json'),'-f',str(p/('compose.rollback.json' if rollback else 'compose.subscription-v2.json'))],{**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':env('photobooth-image-helper')['AI_ENGINE_API_KEY']}
def clean(n,s,baseline):
 # Exclude peer Public API wiring and unfinished AI footer changes, staging only.
 if n=='config/migration-env.ts':s='\n'.join(x for x in s.split('\n') if 'PUBLIC_API_KEY_PEPPER:' not in x)
 if n=='migration-container.ts':
  s='\n'.join(x for x in s.split('\n') if not x.startswith('import { PublicApiKey') and not x.startswith('  const publicKeyModel=') and not x.startswith('  const publicApi=') and not x.startswith('  // Public API stays'))
  s=s.replace('catalog,account,publicApi,results','catalog,account,results')
 if n=='models/customer-generation.model.ts':
  s=s.replace('import { snapshotPersonalization }','import { parseGenerationSnapshot }')
  s=s.replace('const personalization = snapshotPersonalization(job.engine_config_json,job.mode);',"const snapshot = job.mode === 'CLASSIC' ? parseGenerationSnapshot(job.engine_config_json,job.mode) : null;\n      const personalization = snapshot?.mode === 'CLASSIC' ? snapshot.personalization : undefined;")
 if n=='services/customer-result.service.ts':
  s=s.replace('import { snapshotPersonalization }','import { parseGenerationSnapshot }')
  s=s.replace('const embeddedToken = snapshotPersonalization(found.job.engine_config_json, found.job.mode)?.claim_token ?? null;',"const snapshot = found.job.mode === 'CLASSIC' ? parseGenerationSnapshot(found.job.engine_config_json, 'CLASSIC') : null;\n    const embeddedToken = snapshot?.mode === 'CLASSIC' ? snapshot.personalization?.claim_token : null;")
 if n=='services/customer-generation-input.ts':
  s=s.replace("  if (value.mode !== 'ADVANCED'", "  if (value.event_name && value.mode !== 'CLASSIC') invalid('Event name is only accepted for Classic');\n  if (value.captured_at && value.mode !== 'CLASSIC') invalid('Capture time is only accepted for Classic');\n  if (value.mode !== 'ADVANCED'")
 if n=='services/customer-generation.service.ts':
  start=s.index('// Footer for AI results:'); end=s.index('export type GenerationQueue',start);s=s[:start]+s[end:]
  s=s.replace(",...(kiosk ? {} : { personalization: aiPersonalization(input, source.upload.created_at) })",'')
 if n=='services/native-generation-runner.service.ts':
  start=s.index('    const footer = async');end=s.index("    if (job.mode === 'BASIC')",start);s=s[:start]+s[end:]
  s=s.replace('return footer(await this.generateBasic(job, source, snapshot.prompt, snapshot.model, snapshot.template, provider));','return this.generateBasic(job, source, snapshot.prompt, snapshot.model, snapshot.template, provider);')
  s=s.replace('return footer(await this.generateWithProvider(job,source,snapshot.prompt,snapshot.model,provider));','return this.generateWithProvider(job,source,snapshot.prompt,snapshot.model,provider);')
 if n=='App.jsx':
  s='\n'.join(x for x in s.split('\n') if not x.strip().startswith('const [eventName,') and not x.strip().startswith('if (saved.eventName)'))
  s=s.replace("{ eventName: eventName.trim(), ...(usage?.subscription ? { lane: aiLane } : {}) }","{ ...(usage?.subscription ? { lane: aiLane } : {}) }").replace(" eventName: eventName.trim(),",'')
  s=s.replace(', eventName, upload, usage, aiLane]',', upload, usage, aiLane]')
  s=re.sub(r" eventName=\{eventName\} onEventNameChange=\{value => \{ setEventName\(value\); updateCustomerFlow\(\{ eventName: value.trim\(\) \|\| null \}\) \}\}",'',s)
 if n=='api.js':s=s.replace("  if (mode !== 'CLASSIC' && options.eventName) body.event_name = options.eventName\n",'')
 if n=='components/customer/ReviewStage.jsx':
  s=s.replace(" eventName = '', onEventNameChange,",'')
  start=s.index("      {mode !== 'CLASSIC' && onEventNameChange");end=s.index('      {subscription &&',start);s=s[:start]+s[end:]
 return s

def prepare():
 snapshot();before={n:ins(n) for n in TARGETS};stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');p=D/('subscription-v2-'+stamp);p.mkdir()
 with (p/'prepare.log').open('w') as log:
  a=p/'api-source';a.mkdir()
  for n in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:run(['docker','cp','photobooth-express:/app/'+n,str(a/n)],stdout=log,stderr=subprocess.STDOUT)
  for n in API:
   dest=a/'src'/n;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(clean(n,(R/'backend-express/src'/n).read_text(),dest.read_text() if dest.exists() else ''))
  # Preserve live worker entrypoint/startup-stage behavior while synchronizing its
  # shared service graph with the already deployed API baseline plus v2 changes.
  run(['docker','cp','photobooth-express-worker:/app/src/migration-worker.ts',str(a/'src/migration-worker.ts')],stdout=log,stderr=subprocess.STDOUT)
  (a/'node_modules').symlink_to(R/'backend-express/node_modules')
  run(['node',str(R/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=a,stdout=log,stderr=subprocess.STDOUT)
  (a/'test').mkdir()
  for n in ['subscription-policy.test.ts','generation-api-routes.test.ts','duitku-payment.test.ts','native-provider-payload.test.ts']:shutil.copy2(R/'backend-express/test'/n,a/'test'/n)
  run(['node','--import','tsx','--test',*[str(x.relative_to(a)) for x in (a/'test').glob('*.test.ts')]],cwd=a,stdout=log,stderr=subprocess.STDOUT)
  html=out(['docker','exec','photobooth-web','cat','/usr/share/nginx/html/index.html'])
  source=next(x.parent.parent for x in sorted(D.glob('*/frontend/dist/index.html'),reverse=True) if x.read_bytes()==html)
  w=p/'frontend';shutil.copytree(source,w,ignore=shutil.ignore_patterns('dist','node_modules','.env*','.vite'))
  for n in WEB:
   dest=w/'src'/n;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(clean(n,(R/'frontend/src'/n).read_text(),dest.read_text() if dest.exists() else ''))
  (w/'node_modules').symlink_to(R/'frontend/node_modules');(p/'templates').symlink_to(R/'templates');data=p/'backend/app/data';data.mkdir(parents=True)
  for n in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(R/'backend/app/data'/n,data/n)
  assets=out(['docker','exec','photobooth-web','sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode();ids=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(ids)==1
  e=env('photobooth-express');buildenv={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(ids)),'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN':e.get('POSTHOG_PROJECT_TOKEN',''),'VITE_PUBLIC_POSTHOG_HOST':e.get('POSTHOG_HOST','')}
  run(['npm','run','build'],cwd=w,env=buildenv,stdout=log,stderr=subprocess.STDOUT)
  images={n:('photobooth-web' if n.endswith('-web') else 'photobooth-express')+':'+p.name+('-worker' if n.endswith('-worker') else '') for n in TARGETS}
  for n in TARGETS:
   c=p/(n+'-image');c.mkdir()
   if n.endswith('-web'):
    shutil.copytree(w/'dist',c/'dist');copy='COPY dist/ /usr/share/nginx/html/\n'
   else:
    shutil.copytree(a/'src',c/'src');shutil.copytree(a/'dist',c/'dist');copy='COPY src/ /app/src/\nCOPY dist/ /app/dist/\n'
   (c/'Dockerfile').write_text('FROM '+before[n]['Config']['Image']+'\n'+copy)
   run(['docker','build','--network','none','-t',images[n],str(c)],stdout=log,stderr=subprocess.STDOUT)
  shutil.copy2(SNAP,p/'compose.express-before.json');shutil.copy2(source.parent/'compose.web-base.json',p/'compose.web-base.json')
  save(p/'compose.subscription-v2.json',{'services':{n:{'image':images[n],**({'environment':{'SUBSCRIPTION_V2_ENABLED':'true'}} if not n.endswith('-web') else {})} for n in TARGETS}})
  save(p/'compose.rollback.json',{'services':{n:{'image':before[n]['Config']['Image'],**({'environment':{'SUBSCRIPTION_V2_ENABLED':env(n).get('SUBSCRIPTION_V2_ENABLED','false')}} if not n.endswith('-web') else {})} for n in TARGETS}})
  args,ce=compose(p);run(args+['config','--quiet'],env=ce,stdout=log,stderr=subprocess.STDOUT)
  cfg=json.loads(out(args+['config','--format','json'],env=ce))['services']
  for n in TARGETS:
   live=before[n];want=cfg[n];assert live['Id']==ins(n)['Id']
   assert {(x['Source'],x['Destination'],x['RW']) for x in live['Mounts']}=={(x['source'],x['target'],not x.get('read_only',False)) for x in want.get('volumes',[])}
   oldenv=dict(x.split('=',1) for x in live['Config']['Env'])
   for k,v in want.get('environment',{}).items():
    if k!='SUBSCRIPTION_V2_ENABLED':assert oldenv.get(k)==v,'Environment drift: '+k
 shutil.copy2(R/'backend/migrations/024_subscription_v2.sql',p/'024_subscription_v2.sql')
 m={'release':str(p),'status':'PREPARED','deployed':False,'images':images,'previous_images':{n:before[n]['Config']['Image'] for n in TARGETS},'previous_container_ids':{n:before[n]['Id'] for n in TARGETS},'changed_files':{'backend-express':API,'frontend':WEB},'excluded':['Public API025 and all its wiring','Unreleased AI footer/personalization'], 'worker_baseline':'Running API shared services; original live worker entrypoint retained','production_sql_applied':False}
 save(p/'manifest.json',m);PTR.write_text(str(p));print(json.dumps({'status':'PASS','release':str(p),'images':images}))

def sql(q):return out(['docker','exec','-i','photobooth-postgres','sh','-c','exec psql -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],input=q.encode()).decode().strip()
def healthy():
 until=time.monotonic()+120
 while time.monotonic()<until:
  ready=True
  for n in TARGETS:
   x=ins(n);assert x['RestartCount']==0,n+' restarted'
   ready=ready and x['State']['Status']=='running' and (n.endswith('-worker') or x['State'].get('Health',{}).get('Status')=='healthy')
  if ready:return
  time.sleep(1)
 raise RuntimeError('Readiness timeout')
def deploy(p,m):
 snapshot();assert not m['deployed']
 for n in TARGETS:assert ins(n)['Id']==m['previous_container_ids'][n],'Live changed since prepare'
 args,e=compose(p);run(args+['config','--quiet'],env=e);before=containers()
 # Quiesce ingress first, drain active work, then stop the old consumer.
 run(['docker','stop','--time','30','photobooth-express'])
 deadline=time.monotonic()+180
 while True:
  active=int(sql("SELECT count(*) FROM generation_jobs WHERE state IN ('QUEUED','PROCESSING');"))
  if active==0:break
  if time.monotonic()>deadline:
   run(['docker','start','photobooth-express']);raise RuntimeError('Active legacy jobs did not drain; API restored')
  time.sleep(2)
 run(['docker','stop','--time','30','photobooth-express-worker'])
 try:
  pending=int(sql("SELECT count(*) FROM quota_reservations WHERE status='RESERVED';"));assert pending==0,'Unsettled legacy reservations: '+str(pending)
  backup=Path('/srv/photobooth/backups')/('pre-'+p.name+'.dump')
  with backup.open('xb') as f:
   os.chmod(backup,0o600);run(['docker','exec','photobooth-postgres','sh','-c','exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],stdout=f)
  with backup.open('rb') as f:listing=out(['docker','exec','-i','photobooth-postgres','pg_restore','--list'],stdin=f)
  assert backup.stat().st_size>1024 and b'TABLE DATA' in listing
  m['backup']={'path':str(backup),'bytes':backup.stat().st_size,'sha256':hashlib.sha256(backup.read_bytes()).hexdigest(),'verified':True};save(p/'manifest.json',m)
  migration=p/'024_subscription_v2.sql';assert migration.read_bytes()==(R/'backend/migrations/024_subscription_v2.sql').read_bytes()
  with (p/'migration.log').open('w') as log:run(['docker','exec','-i','photobooth-postgres','sh','-c','exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],input=migration.read_bytes(),stdout=log,stderr=subprocess.STDOUT)
  m['production_sql_applied']=True;save(p/'manifest.json',m)
 except Exception:
  run(['docker','start','photobooth-express-worker','photobooth-express']);raise
 run(args+['up','-d','--no-deps','--no-build',*TARGETS],env=e)
 healthy()
 with urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=15) as r:assert json.load(r)['status']=='ok'
 run([sys.executable,'-I',str(R/'scripts/snapshot_express_compose.py'),'generate']);snapshot()
 changed=[n for n,v in before.items() if containers().get(n)!=v];assert set(changed)==set(TARGETS)
 m.update(status='DEPLOYED',deployed=True,changed_containers=changed,deployed_at=datetime.datetime.now(datetime.timezone.utc).isoformat());save(p/'manifest.json',m);run(args+['ps',*TARGETS],env=e)
 print(json.dumps({'status':'PASS','release':str(p),'backup':str(backup),'changed_containers':changed}))
if __name__=='__main__':
 action=sys.argv[1]
 if action=='prepare':prepare()
 else:
  p=Path(PTR.read_text().strip());m=json.loads((p/'manifest.json').read_text())
  if action=='deploy':deploy(p,m)
  elif action=='status':print(json.dumps(m,indent=2))
  else:raise SystemExit('Use prepare|deploy|status. Rollback requires draining/reconciling v2 wallets; see runbook.')
