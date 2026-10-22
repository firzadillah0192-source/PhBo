"""Scoped Fast gateway release. Owner-approved deploy/rollback; no paid generation or SQL.
prepare builds from running images; deploy needs root to restart 9router.service.
"""
import datetime, hashlib, importlib.util, json, os, shutil, subprocess, sys, time, urllib.request
from pathlib import Path
R = Path('/opt/photobooth')
D = Path('/srv/photobooth/releases')
POINTER = D / '.fast-router-current'
SERVICES = ['photobooth-express', 'photobooth-express-worker']
ROUTE = Path('/home/mahez/9router-releases/telemetry-a8c9d380-20260923T1700Z/.next/server/app/api/v1/images/generations/route.js')
SOURCE = 'services/generation-api-routes.service.ts'

def run(args, **kw): return subprocess.run(args, check=True, **kw)
def output(args): return subprocess.check_output(args)
def inspect(name): return json.loads(output(['docker', 'inspect', name]))[0]
def digest(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p, obj): p.write_text(json.dumps(obj, indent=2) + '\n')
def snapshot(action): run([sys.executable, '-I', str(R/'scripts/snapshot_express_compose.py'), action])
def web_module():
    spec = importlib.util.spec_from_file_location('fast_web', R/'scripts/deploy_customer_ui.py')
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    m.POINTER = D/'.fast-router-web-current'
    return m

def compose(p, rollback=False):
    key = dict(v.split('=',1) for v in inspect('photobooth-image-helper')['Config']['Env'])['AI_ENGINE_API_KEY']
    return ['docker','compose','--project-name','photobooth','--project-directory',str(R),'--env-file',str(R/'.env'),'-f',str(p/'compose.before.json'),'-f',str(p/('compose.rollback.json' if rollback else 'compose.fast-router.json'))], {**os.environ,'EXPRESS_IMAGE_ENGINE_KEY':key}

def prepare():
    snapshot('validate')
    p = D/('fast-router-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')); p.mkdir()
    POINTER.write_text(str(p))
    before = {n:inspect(n) for n in SERVICES}
    gateway = p/'gateway'; gateway.mkdir()
    old = ROUTE.read_text(); (gateway/'route.before.js').write_text(old)
    # Build the reviewed OpenAI adapter in isolation. Preserve the deployed registry
    # by injecting it into the adapter, rather than rebuilding unrelated gateway code.
    reviewed = gateway/'reviewed-source'; reviewed.mkdir()
    for rel in ['open-sse/handlers/imageProviders/openai.js','open-sse/handlers/imageGenerationCore.js']:
        dest=reviewed/rel; dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(Path('/home/mahez/9router-dev')/rel,dest)
    shutil.copy2(R/'scripts/patches/9router_openai_reference_edits.patch',gateway/'reviewed.patch')
    run(['patch','--batch','--forward','--fuzz=0','-p1','-d',str(reviewed),'-i',str(gateway/'reviewed.patch')],stdout=subprocess.DEVNULL)
    src = gateway/'source'; src.mkdir()
    for rel in ['open-sse/handlers/imageProviders/openai.js','open-sse/translator/concerns/image.js','open-sse/config/mediaConfig.js']:
        dest=src/rel; dest.parent.mkdir(parents=True,exist_ok=True)
        root=reviewed if rel.endswith('imageProviders/openai.js') else Path('/home/mahez/9router-dev')
        shutil.copy2(root/rel,dest)
    adapter=src/'open-sse/handlers/imageProviders/openai.js'
    text=adapter.read_text().replace('import { PROVIDER_MEDIA } from "../../providers/index.js";', 'let PROVIDER_MEDIA;\nexport function withRegistry(registry) { PROVIDER_MEDIA = registry; return createOpenAIAdapter; }')
    assert 'import { PROVIDER_MEDIA }' not in text; adapter.write_text(text)
    (src/'node_modules').symlink_to('/home/mahez/9router-dev/node_modules')
    with (gateway/'build.log').open('w') as log:
        run([str(R/'frontend/node_modules/.bin/esbuild'),str(adapter),'--bundle','--platform=node','--format=cjs','--outfile='+str(gateway/'openai-reference.cjs')],stdout=log,stderr=subprocess.STDOUT)
    start=old.index('61613:(a,b,c)=>'); end=old.index(',62796:',start)
    assert 'buildBody:(a,c)=>{let{prompt:' in old[start:end]
    module='61613:(a,b,c)=>{"use strict";c.d(b,{A:()=>f});var d=c(26070);function f(a){return require('+json.dumps(str(gateway/'openai-reference.cjs'))+').withRegistry(d.B$)(a)}}'
    new=old[:start]+module+old[end:]
    assert new.count('B.buildUrl(x,c)') == 2
    new=new.replace('B.buildUrl(x,c)','B.buildUrl(x,c,a)')
    (gateway/'route.after.js').write_text(new)
    run(['node','--check',str(gateway/'route.after.js')])
    script='const f=require(process.argv[1]).withRegistry({openai:{imageConfig:{baseUrl:"https://api.openai.com/v1/images/generations"}}}); const a=f("openai"); const b={prompt:"synthetic",images:["data:image/png;base64,iVBORw0KGgo=","data:image/png;base64,iVBORw0KGgo="],quality:"low"}; (async()=>{const v=await a.buildBody("gpt-image-2.5-flare",b); if(a.buildUrl("gpt-image-2.5-flare",{},b)!=="https://api.openai.com/v1/images/edits"||v.getAll("image[]").length!==2||v.get("quality")!=="low"||a.buildHeaders({apiKey:"synthetic"},v)["Content-Type"])process.exit(1); console.log("Gateway production sidecar: PASS");})()'
    run(['node','-e',script,str(gateway/'openai-reference.cjs')])
    images={}
    for name in SERVICES:
        src=p/('worker-source' if name.endswith('worker') else 'api-source'); src.mkdir()
        with (p/(name+'-build.log')).open('w') as log:
            for f in ['src','prisma','package.json','tsconfig.json','tsconfig.build.json']:
                run(['docker','cp',name+':/app/'+f,str(src/f)],stdout=log,stderr=subprocess.STDOUT)
            dest=src/'src'/SOURCE
            assert dest.read_bytes()==output(['git','-C',str(R),'show','HEAD:backend-express/src/'+SOURCE]), 'Live route service differs from reviewed baseline'
            shutil.copy2(R/'backend-express/src'/SOURCE,dest)
            (src/'node_modules').symlink_to(R/'backend-express/node_modules')
            (src/'test').mkdir();shutil.copy2(R/'backend-express/test/generation-api-routes.test.ts',src/'test/generation-api-routes.test.ts')
            run(['node',str(R/'backend-express/node_modules/typescript/bin/tsc'),'-p','tsconfig.build.json'],cwd=src,stdout=log,stderr=subprocess.STDOUT)
            run(['node','--import','tsx','--test','test/generation-api-routes.test.ts'],cwd=src,stdout=log,stderr=subprocess.STDOUT)
            ctx=p/(name+'-image');ctx.mkdir()
            for rel in ['src/'+SOURCE,'dist/'+SOURCE.replace('.ts','.js'),'dist/'+SOURCE.replace('.ts','.js.map')]:
                dest=ctx/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src/rel,dest)
            images[name]='photobooth-express:'+p.name+('-worker' if name.endswith('worker') else '')
            (ctx/'Dockerfile').write_text('FROM '+before[name]['Config']['Image']+'\nCOPY src/ /app/src/\nCOPY dist/ /app/dist/\n')
            run(['docker','build','--network','none','-t',images[name],str(ctx)],stdout=log,stderr=subprocess.STDOUT)
    shutil.copy2(D/'express-base/compose.express-base.json',p/'compose.before.json')
    save(p/'compose.fast-router.json',{'services':{n:{'image':images[n]} for n in SERVICES}})
    save(p/'compose.rollback.json',{'services':{n:{'image':before[n]['Config']['Image']} for n in SERVICES}})
    args,env=compose(p);run(args+['config','--quiet'],env=env)
    web=web_module();web.prepare(['src/components/admin/GenerationApiRoutes.jsx'])
    web_path=Path(web.POINTER.read_text().strip())
    manifest={'release':str(p),'status':'PREPARED','images':images,'previous_images':{n:before[n]['Config']['Image'] for n in SERVICES},'previous_ids':{n:before[n]['Id'] for n in SERVICES},'gateway_route':str(ROUTE),'gateway_before_sha256':digest(gateway/'route.before.js'),'gateway_after_sha256':digest(gateway/'route.after.js'),'web_release':str(web_path),'paid_generation':False,'sql_applied':False,'deployed':False}
    save(p/'manifest.json',manifest)
    assert digest(ROUTE)==manifest['gateway_before_sha256']
    for name in SERVICES: assert inspect(name)['Id']==before[name]['Id']
    print(json.dumps(manifest,indent=2))

def atomic_copy(source,target):
    temp=target.with_name(target.name+'.fast-router-new');shutil.copy2(source,temp);os.replace(temp,target)

def wait_health(url):
    for _ in range(45):
        try:
            with urllib.request.urlopen(url,timeout=3) as r:
                if r.status==200:
                    data=json.load(r)
                    if data.get('status')=='ok' or data.get('ok') is True:return
        except Exception:pass
        time.sleep(1)
    raise RuntimeError('Health check failed: '+url)

def activate(p,m,back=False):
    # Fail BEFORE any mutation if OS authorization cannot restart the gateway.
    if os.geteuid()!=0:
        raise SystemExit('OS restart permission required. Owner command: sudo python3 -I /opt/photobooth/scripts/deploy_fast_router.py '+('rollback' if back else 'deploy'))
    snapshot('validate')
    if not back:
        assert digest(ROUTE)==m['gateway_before_sha256'],'Gateway changed after prepare'
        for n in SERVICES:assert inspect(n)['Id']==m['previous_ids'][n], 'Live container changed after prepare'
    gateway=p/'gateway';web=web_module();wm_path=Path(m['web_release'])/'manifest.json';wm=json.loads(wm_path.read_text())
    if not back:
        assert web.v.inspect(web.v.WEB)['Image']==wm['previous_id'],'Live web changed after prepare'
    m['status']='ROLLING_BACK' if back else 'DEPLOYING';save(p/'manifest.json',m)
    try:
        if not back:
            atomic_copy(gateway/'route.after.js',ROUTE)
            run(['systemctl','restart','9router.service'])
            wait_health('http://127.0.0.1:20128/api/health')
            args=web.v.compose(wm);run(args+['config','--quiet']);run(args+['up','-d','--no-deps','--no-build',web.v.WEB]);web.v.verify(wm)
            wm['deployed']=True;save(wm_path,wm)
        args,env=compose(p,back);run(args+['config','--quiet'],env=env);run(args+['up','-d','--no-deps','--no-build',*SERVICES],env=env)
        for n in SERVICES:
            for _ in range(60):
                i=inspect(n);assert i['RestartCount']==0
                if i['State']['Status']=='running' and (n.endswith('worker') or i['State'].get('Health',{}).get('Status')=='healthy'):break
                time.sleep(1)
            else:raise RuntimeError(n+' not healthy')
        if back:
            args=web.v.compose(wm,True);run(args+['config','--quiet']);run(args+['up','-d','--no-deps','--no-build',web.v.WEB])
            wait_health('http://127.0.0.1:3000/api/health')
            atomic_copy(gateway/'route.before.js',ROUTE);run(['systemctl','restart','9router.service']);wait_health('http://127.0.0.1:20128/api/health')
            wm['deployed']=False;save(wm_path,wm)
        wait_health('http://127.0.0.1:3000/api/health')
        snapshot('generate');snapshot('validate')
        if not back:
            run(['docker','exec','-i','-w','/app','photobooth-express','node','--input-type=module'],input=(R/'scripts/verify_fast_router.mjs').read_text(),text=True)
        report_args,report_env=compose(p,back);run(report_args+['ps'],env=report_env)
        m.update(status='ROLLED_BACK' if back else 'DEPLOYED',deployed=not back,last_action_at=datetime.datetime.now(datetime.timezone.utc).isoformat());save(p/'manifest.json',m)
    except Exception:
        m['status']='ROLLBACK_REQUIRED';save(p/'manifest.json',m)
        raise
    print(json.dumps(m,indent=2))

if __name__=='__main__':
    action=sys.argv[1] if len(sys.argv)>1 else ''
    if action=='prepare':prepare()
    else:
        p=Path(POINTER.read_text().strip());m=json.loads((p/'manifest.json').read_text())
        if action in ['deploy','rollback']:activate(p,m,action=='rollback')
        elif action=='status':print(json.dumps(m,indent=2))
        else:raise SystemExit('Use prepare|deploy|rollback|status')
