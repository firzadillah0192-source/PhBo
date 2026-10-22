"""Prepare/deploy/rollback Fast Basic prompt only. Each deploy requires owner approval."""
import datetime,hashlib,json,os,shutil,subprocess,sys,time,urllib.request
from pathlib import Path
R=Path('/opt/photobooth');D=Path('/srv/photobooth/releases');P=D/'.fast-prompt-current'
NAMES=['photobooth-express','photobooth-express-worker']
SERVICE='services/customer-generation.service.ts';NEW='services/fast-basic-prompt.service.ts'
RUNNER='services/native-generation-runner.service.ts';ENGINE='services/native-image-engine.service.ts';ADVANCED='services/advanced-prompt.service.ts'
# Idempotent patches over the live source: the plate text (event name + date) is lettered by the image model.
PATCHES=[(SERVICE,"snapshot = { version: 2,mode: 'BASIC',prompt: composeFastBasicPrompt(template.name,template.description),model: preset.model,template: frozen,...(kiosk ? {} : { personalization: aiPersonalization(input, source.upload.created_at) }) };",
"const personalization = kiosk ? undefined : aiPersonalization(input, source.upload.created_at);\n      snapshot = { version: 2,mode: 'BASIC',prompt: composeFastBasicPrompt(template.name,template.description,personalization),model: preset.model,template: frozen,...(personalization ? { personalization } : {}) };"),
(RUNNER,"download_url: `https://nxbooth.gennexbyte.com/r/${details.claim_token}` })","download_url: `https://nxbooth.gennexbyte.com/r/${details.claim_token}`,\n        ...(job.mode === 'BASIC' && snapshot && snapshot.mode === 'BASIC' && snapshot.prompt.includes('PLATE TEXT\\n') ? { qr_only: true } : {}) })"),
(ENGINE,"captured_at: string; download_url: string })","captured_at: string; download_url: string; qr_only?: boolean })"),(SERVICE,"      snapshot = { version: 1,mode: 'ADVANCED',prompt: composeAdvancedPrompt(experience.internal_prompt,style!.prompt_fragment),model: experience.model,...(kiosk ? {} : { personalization: aiPersonalization(input, source.upload.created_at) }) };","      const personalization = kiosk ? undefined : aiPersonalization(input, source.upload.created_at);\n      snapshot = { version: 1,mode: 'ADVANCED',prompt: composeAdvancedPrompt(experience.internal_prompt,style!.prompt_fragment,personalization),model: experience.model,...(personalization ? { personalization } : {}) };"),
(RUNNER,"job.mode === 'BASIC' && snapshot && snapshot.mode === 'BASIC' && snapshot.prompt.includes('PLATE TEXT\\n')","snapshot && snapshot.mode !== 'CLASSIC' && /(PLATE TEXT|FOOTER EVENT LINE)\\n/.test(snapshot.prompt)"),(SERVICE,"composeFastBasicPrompt(template.name,template.description,personalization)","composeFastBasicPrompt(template.name,template.description,personalization,template.id)"),
(SERVICE,"      const personalization = kiosk ? undefined : aiPersonalization(input, source.upload.created_at);\n      snapshot = { version: 2,","      const personalization = aiPersonalization(input, source.upload.created_at);\n      snapshot = { version: 2,"),
(SERVICE,"      const personalization = kiosk ? undefined : aiPersonalization(input, source.upload.created_at);\n      snapshot = { version: 1,mode: 'ADVANCED',","      const personalization = aiPersonalization(input, source.upload.created_at);\n      snapshot = { version: 1,mode: 'ADVANCED',")]
BEFORE="prompt: composeBasicPrompt(template.name,template.description),model: preset.model"
AFTER="prompt: input.lane === 'fast' ? composeFastBasicPrompt(template.name,template.description) : composeBasicPrompt(template.name,template.description),model: preset.model"
FINAL="prompt: composeFastBasicPrompt(template.name,template.description),model: preset.model"
IMPORT="import { composeFastBasicPrompt } from './fast-basic-prompt.service.js';\n"
def run(a,**k):return subprocess.run(a,check=True,**k)
def out(a):return subprocess.check_output(a)
def inspect(n):return json.loads(out(['docker','inspect',n]))[0]
def snap(action):run([sys.executable,'-I',str(R/'scripts/snapshot_express_compose.py'),action])
def save(p,m):p.write_text(json.dumps(m,indent=2)+'\n')
def command(p,back=False):
 key=dict(v.split('=',1) for v in inspect('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY']
 return ['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.before.json'),'-f',str(p/('compose.rollback.json' if back else 'compose.fast-prompt.json'))],{**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':key}
def prepare():
 snap('validate');p=D/('fast-prompt-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));p.mkdir();before={n:inspect(n) for n in NAMES};images={}
 for n in NAMES:
  src=p/('worker-source' if n.endswith('worker') else 'api-source');src.mkdir()
  with (p/(n+'-build.log')).open('w') as log:
   for name in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:run(['docker','cp',n+':/app/'+name,str(src/name)],stdout=log,stderr=subprocess.STDOUT)
   f=src/'src'/SERVICE;text=f.read_text()
   if 'composeFastBasicPrompt(template.name,template.description,personalization' in text:
    assert text.count(IMPORT)==1, 'Unexpected existing prompt selection'  # plate-text selection already live
   elif FINAL in text:
    assert text.count(FINAL)==1 and text.count(IMPORT)==1, 'Unexpected existing prompt selection'
   elif AFTER in text:
    # Fast-only selection is live: every Basic lane now uses the likeness composer.
    assert text.count(AFTER)==1 and text.count(IMPORT)==1, 'Unexpected existing prompt selection'
    f.write_text(text.replace(AFTER,FINAL))
   else:
    assert text.count(BEFORE)==1 and IMPORT not in text
    anchor="import { composeAdvancedPrompt,composeBasicPrompt } from './advanced-prompt.service.js';\n";assert text.count(anchor)==1
    f.write_text(text.replace(anchor,anchor+IMPORT).replace(BEFORE,FINAL))
   for rel,old,new in PATCHES:
    g=src/'src'/rel;s=g.read_text()
    if new in s:continue
    if old not in s:
     # Already superseded by a later patch in this list (e.g. a previous release applied both).
     assert any(later in s for r2,_,later in PATCHES if r2==rel and later!=new),'Unexpected live source in '+rel
     continue
    assert s.count(old)==1,'Unexpected live source in '+rel
    g.write_text(s.replace(old,new))
   shutil.copy2(R/'backend-express/src'/NEW,src/'src'/NEW)
   live=(src/'src'/ADVANCED).read_text()
   if live!=(R/'backend-express/src'/ADVANCED).read_text():
    assert live==subprocess.check_output(['git','-C',str(R),'show','HEAD:backend-express/src/'+ADVANCED]).decode(),'Live Advanced composer differs from HEAD'
    shutil.copy2(R/'backend-express/src'/ADVANCED,src/'src'/ADVANCED)
   # No whole-working-tree copies: the source above is the live container plus two edits.
   (src/'node_modules').symlink_to(R/'backend-express/node_modules');(src/'test').mkdir();shutil.copy2(R/'backend-express/test/fast-basic-prompt.test.ts',src/'test/fast-basic-prompt.test.ts')
   run(['node',str(R/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=src,stdout=log,stderr=subprocess.STDOUT)
   run(['node','--import','tsx','--test','test/fast-basic-prompt.test.ts'],cwd=src,stdout=log,stderr=subprocess.STDOUT)
   ctx=p/(n+'-image');ctx.mkdir()
   for f in [SERVICE,NEW,RUNNER,ENGINE,ADVANCED]:
    for rel in ['src/'+f,'dist/'+f.replace('.ts','.js'),'dist/'+f.replace('.ts','.js.map')]:
     dest=ctx/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src/rel,dest)
   images[n]='photobooth-express:'+p.name+('-worker' if n.endswith('worker') else '')
   (ctx/'Dockerfile').write_text('FROM '+before[n]['Config']['Image']+'\nCOPY src/ /app/src/\nCOPY dist/ /app/dist/\n');run(['docker','build','--network','none','-t',images[n],str(ctx)],stdout=log,stderr=subprocess.STDOUT)
 shutil.copy2(D/'express-base/compose.express-base.json',p/'compose.before.json');save(p/'compose.fast-prompt.json',{'services':{n:{'image':images[n]} for n in NAMES}});save(p/'compose.rollback.json',{'services':{n:{'image':before[n]['Config']['Image']} for n in NAMES}})
 args,e=command(p);run(args+['config','--quiet'],env=e)
 m={'release':str(p),'status':'PREPARED','images':images,'previous_images':{n:before[n]['Config']['Image'] for n in NAMES},'previous_ids':{n:before[n]['Id'] for n in NAMES},'changed_files':[SERVICE,NEW,RUNNER,ENGINE,ADVANCED],'validation':'isolated live-source compile and Fast/Standard/Advanced/retry snapshot tests PASS','deployed':False,'paid_generation':False,'sql_applied':False,'new_prompt_sha256':hashlib.sha256((R/'backend-express/src'/NEW).read_bytes()).hexdigest()};save(p/'manifest.json',m);P.write_text(str(p))
 for n in NAMES:assert inspect(n)['Id']==before[n]['Id']
 print(json.dumps(m,indent=2))
def deploy(p,m,back=False):
 snap('validate')
 if not back:
  for n in NAMES:assert inspect(n)['Id']==m['previous_ids'][n],'Live changed after prepare'
 args,e=command(p,back);run(args+['config','--quiet'],env=e);m['status']='ROLLING_BACK' if back else 'DEPLOYING';save(p/'manifest.json',m)
 run(args+['up','-d','--no-deps','--no-build',*NAMES],env=e)
 # Refresh after changing images, even if a later health check fails.
 snap('generate');snap('validate')
 try:
  for n in NAMES:
   for _ in range(60):
    i=inspect(n);assert i['RestartCount']==0
    if i['State']['Status']=='running' and (n.endswith('worker') or i['State'].get('Health',{}).get('Status')=='healthy'):break
    time.sleep(1)
   else:raise RuntimeError(n+' not ready')
  for origin in ['http://127.0.0.1:3000','https://nxbooth.gennexbyte.com']:
   with urllib.request.urlopen(urllib.request.Request(origin+'/api/health',headers={'User-Agent':'Mozilla/5.0'}),timeout=15) as r:assert json.load(r)['status']=='ok'
  with urllib.request.urlopen('http://127.0.0.1:3000/create',timeout=15) as r:assert r.status==200
  run(['docker','exec','-i','-w','/app','photobooth-express','node','--input-type=module'],input=(R/'scripts/verify_fast_router.mjs').read_text(),text=True)
 except Exception:
  m['status']='ROLLBACK_REQUIRED';save(p/'manifest.json',m);raise
 m.update(status='ROLLED_BACK' if back else 'DEPLOYED',deployed=not back,last_action_at=datetime.datetime.now(datetime.timezone.utc).isoformat());save(p/'manifest.json',m);run(args+['ps'],env=e);print(json.dumps(m,indent=2))
if __name__=='__main__':
 action=sys.argv[1] if len(sys.argv)>1 else ''
 if action=='prepare':prepare()
 else:
  p=Path(P.read_text().strip());m=json.loads((p/'manifest.json').read_text())
  if action in ['deploy','rollback']:deploy(p,m,action=='rollback')
  elif action=='status':print(json.dumps(m,indent=2))
  else:raise SystemExit('Use prepare|deploy|rollback|status')
