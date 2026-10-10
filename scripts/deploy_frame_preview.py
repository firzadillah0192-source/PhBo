"""Release the two-file frame preview fix over the active frontend source."""
import datetime,json,os,re,shutil,subprocess,sys
from pathlib import Path
ROOT=Path('/opt/photobooth'); POINTER=Path('/srv/photobooth/tmp/frame-preview-release-path')
def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
def compose(manifest,rollback=False):
    args=['docker','compose','--project-name','photobooth','--project-directory',str(ROOT)]
    for file in manifest['compose_files']+[manifest['rollback'] if rollback else manifest['override']]:args+=['-f',file]
    return args
action=sys.argv[1]
if action=='prepare':
    web=inspect('photobooth-web'); api=inspect('photobooth-express')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    release=Path('/srv/photobooth/releases')/('frame-preview-'+stamp);release.mkdir()
    files=web['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
    source=Path(files[-1]).parent/'frontend';assert source.is_dir()
    target=release/'frontend';shutil.copytree(source,target,ignore=shutil.ignore_patterns('node_modules','dist','.env*','.vite'))
    for file in ['src/customer.css','src/components/customer/ClassicCaptureStage.jsx']:shutil.copy2(ROOT/'frontend'/file,target/file)
    (target/'node_modules').symlink_to(ROOT/'frontend/node_modules')
    fixtures=release/'backend/app/data';fixtures.mkdir(parents=True)
    for name in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(ROOT/'backend/app/data'/name,fixtures/name)
    (release/'templates').symlink_to(ROOT/'templates')
    assets=subprocess.check_output(['docker','exec','photobooth-web','sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode()
    ids=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(ids)==1
    env=dict(v.split('=',1) for v in api['Config']['Env'] if '=' in v)
    build_env={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(ids)),'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN':env.get('POSTHOG_PROJECT_TOKEN',''),'VITE_PUBLIC_POSTHOG_HOST':env.get('POSTHOG_HOST','')}
    for command,log in [(['npm','test'],'tests.log'),(['npm','run','build'],'build.log')]:
        with (release/log).open('w') as output:run(command,cwd=target,env=build_env,stdout=output,stderr=subprocess.STDOUT)
    image='photobooth-web:frame-preview-'+stamp
    context=release/'image';context.mkdir();shutil.copytree(target/'dist',context/'dist')
    (context/'Dockerfile').write_text('FROM '+web['Config']['Image']+'\nCOPY dist/ /usr/share/nginx/html/\n')
    override=release/'compose.frame-preview.yml';override.write_text('services:\n  photobooth-web:\n    image: '+image+'\n')
    rollback=release/'compose.rollback.yml';rollback.write_text('services:\n  photobooth-web:\n    image: '+web['Config']['Image']+'\n')
    # Old Compose chains reference volatile /tmp files. Preserve the inspected web
    # configuration in a persistent, web-only definition; no other service changes.
    image_config=json.loads(subprocess.check_output(['docker','image','inspect',web['Image']]))[0]['Config']
    for key in ['Env','Cmd','Entrypoint']:assert web['Config'][key]==image_config[key], 'Unexpected container override: '+key
    assert not web['Mounts'] and list(web['NetworkSettings']['Networks'])==['photobooth-net']
    assert web['HostConfig']['PortBindings']=={'80/tcp':[{'HostIp':'','HostPort':'3000'}]}
    assert web['HostConfig']['RestartPolicy']['Name']=='unless-stopped'
    base=release/'compose.web-base.json'
    hc=web['Config']['Healthcheck']
    healthcheck={'test':hc['Test'],'interval':str(hc['Interval']//1_000_000_000)+'s','timeout':str(hc['Timeout']//1_000_000_000)+'s','start_period':str(hc['StartPeriod']//1_000_000_000)+'s','retries':hc['Retries']}
    base.write_text(json.dumps({'services':{'photobooth-web':{'image':web['Config']['Image'],'container_name':'photobooth-web','restart':'unless-stopped','ports':['3000:80'],'networks':['photobooth'],'healthcheck':healthcheck}},'networks':{'photobooth':{'external':True,'name':'photobooth-net'}}},indent=2))
    manifest={'image':image,'previous_id':web['Image'],'compose_files':[str(base)],'previous_compose_files':files,'override':str(override),'rollback':str(rollback),'before':{r['Names']:r['ID'] for r in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())}}
    (release/'manifest.json').write_text(json.dumps(manifest,indent=2));POINTER.write_text(str(release))
    run(compose(manifest)+['config','--quiet'])
    with (release/'docker-build.log').open('w') as output:run(['docker','build','-t',image,str(context)],stdout=output,stderr=subprocess.STDOUT)
    print(json.dumps({'status':'PASS','prepared':str(release),'tests':True,'build':True,'deployed':False}))
elif action in ('deploy','status','rollback'):
    release=Path(POINTER.read_text());manifest=json.loads((release/'manifest.json').read_text());args=compose(manifest,action=='rollback')
    run(args+['config','--quiet'])
    if action=='deploy':assert inspect('photobooth-web')['Image']==manifest['previous_id'],'Frontend changed concurrently'
    if action!='status':run(args+['up','-d','--no-deps','--no-build','photobooth-web'])
    run(args+['ps','photobooth-web'])
    now={r['Names']:r['ID'] for r in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())}
    assert all(now.get(name)==cid for name,cid in manifest['before'].items() if name!='photobooth-web'),'Non-web container changed'
    print(json.dumps({'status':'PASS','image':inspect('photobooth-web')['Config']['Image'],'other_containers_unchanged':True}))
else:raise SystemExit('Use prepare/deploy/status/rollback')
