"""Prepare/deploy customer Billing history only. Deploy/rollback need owner approval.
Usage: python3 -I scripts/deploy_billing_history.py prepare|deploy|rollback|status
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.request

REPO=Path('/opt/photobooth');RELEASES=Path('/srv/photobooth/releases');POINTER=RELEASES/'.billing-history-current'
FILES=['src/components/customer/AccountCenter.jsx','src/components/customer/PaymentHistory.jsx']
WEB='photobooth-web'
def run(args,**kw):return subprocess.run(args,check=True,**kw)
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
def save(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
def containers():return {x['Names']:x['ID'] for x in map(json.loads,subprocess.check_output(['docker','ps','--format','{{json .}}']).decode().splitlines())}
def compose(m,rollback=False):return ['docker','compose','--project-name','photobooth','--project-directory',str(REPO),'-f',m['base'],'-f',m['rollback'] if rollback else m['override']]
def preservation(image=None):
 cmd=['docker','run','--rm','--network','none','--entrypoint','sh',image] if image else ['docker','exec',WEB,'sh']
 return hashlib.sha256(subprocess.check_output(cmd+['-c','find /usr/share/nginx/html/v2 /etc/nginx -type f -exec sha256sum {} \\; | sort'])).hexdigest()

def prepare():
 live=inspect(WEB);assert live['State'].get('Health',{}).get('Status')=='healthy'
 assert not live['Mounts'] and set(live['NetworkSettings']['Networks'])=={'photobooth-net'}
 old_html=subprocess.check_output(['docker','exec',WEB,'cat','/usr/share/nginx/html/index.html'])
 source=next((p.parent.parent for p in sorted(RELEASES.glob('*/frontend/dist/index.html'),reverse=True) if hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256(old_html).digest()),None)
 assert source,'No live frontend source snapshot'
 release=RELEASES/('billing-history-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'));release.mkdir()
 target=release/'frontend';shutil.copytree(source,target,ignore=shutil.ignore_patterns('node_modules','dist','.env*','.vite'))
 # AccountCenter was untouched by the earlier payment change; reject any unknown concurrent edit.
 baseline=subprocess.check_output(['git','-C',str(REPO),'show','HEAD:frontend/'+FILES[0]])
 assert (target/FILES[0]).read_bytes()==baseline,'Live AccountCenter differs from task baseline'
 assert 'if (!data && !error) return null' in (target/FILES[1]).read_text(),'Unexpected history baseline'
 for name in FILES:shutil.copy2(REPO/'frontend'/name,target/name)
 (target/'node_modules').symlink_to(REPO/'frontend/node_modules');(release/'templates').symlink_to(REPO/'templates')
 fixtures=release/'backend/app/data';fixtures.mkdir(parents=True)
 for name in ['classic_event_frames.json','classic_original_strip_frames.json','classic_print_profile.json']:shutil.copy2(REPO/'backend/app/data'/name,fixtures/name)
 assets=subprocess.check_output(['docker','exec',WEB,'sh','-c','cat /usr/share/nginx/html/assets/*.js']).decode()
 ids=set(re.findall(r'[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com',assets));assert len(ids)==1
 api_env=dict(x.split('=',1) for x in inspect('photobooth-express')['Config']['Env'] if '=' in x)
 env={**os.environ,'VITE_GOOGLE_CLIENT_ID':next(iter(ids)),'VITE_PUBLIC_POSTHOG_PROJECT_TOKEN':api_env.get('POSTHOG_PROJECT_TOKEN',''),'VITE_PUBLIC_POSTHOG_HOST':api_env.get('POSTHOG_HOST',''),'NXBOOTH_BILLING_ROOT':str(target)}
 with (release/'validation.log').open('w') as log:
  run(['npm','run','build'],cwd=target,env=env,stdout=log,stderr=subprocess.STDOUT)
  run(['node',str(REPO/'frontend/scripts/billing-history-browser-check.mjs')],cwd=REPO/'frontend',env=env,stdout=log,stderr=subprocess.STDOUT)
 image='photobooth-web:'+release.name;context=release/'web-image';context.mkdir();shutil.copytree(target/'dist',context/'dist')
 (context/'Dockerfile').write_text('FROM '+live['Config']['Image']+'\nCOPY dist/ /usr/share/nginx/html/\n')
 shutil.copy2(source.parent/'compose.web-base.json',release/'compose.web-base.json')
 override=release/'compose.billing-history.json';rollback=release/'compose.rollback.json'
 save(override,{'services':{WEB:{'image':image}}});save(rollback,{'services':{WEB:{'image':live['Config']['Image']}}})
 m={'release':str(release),'image':image,'previous_image':live['Config']['Image'],'previous_id':live['Id'],'source_snapshot':str(source),'base':str(release/'compose.web-base.json'),'override':str(override),'rollback':str(rollback),'before':containers(),'files':FILES,'preserved_sha256':preservation(),'deployed':False,'status':'PREPARED'}
 run(compose(m)+['config','--quiet'])
 with (release/'build-image.log').open('w') as log:run(['docker','build','--network','none','-t',image,str(context)],stdout=log,stderr=subprocess.STDOUT)
 assert preservation(image)==m['preserved_sha256'];assert inspect(WEB)['Id']==m['previous_id']
 save(release/'manifest.json',m);shutil.copytree(REPO/'test/output/billing-history',release/'browser-evidence');POINTER.write_text(str(release))
 print(json.dumps({'status':'PASS','release':str(release),'image':image,'deployed':False}))

def activate(m,rollback=False):
 if not rollback:assert inspect(WEB)['Id']==m['previous_id'],'Live web changed since prepare'
 run(compose(m,rollback)+['config','--quiet']);run(compose(m,rollback)+['up','-d','--no-deps','--no-build',WEB])
 deadline=time.monotonic()+90
 while time.monotonic()<deadline:
  state=inspect(WEB)
  if state['RestartCount']:raise RuntimeError('Web restarted')
  if state['State'].get('Health',{}).get('Status')=='healthy':break
  time.sleep(1)
 else:raise RuntimeError('Web health timeout')
 assert preservation()==m['preserved_sha256']
 with urllib.request.urlopen('http://127.0.0.1:3000/api/health',timeout=15) as r:assert r.status==200 and json.load(r)['status']=='ok'
 changed=[name for name,value in m['before'].items() if containers().get(name)!=value];assert set(changed)=={WEB}
 m.update(status='ROLLED_BACK' if rollback else 'DEPLOYED',deployed=not rollback,changed_containers=changed)
 save(Path(m['release'])/'manifest.json',m);run(compose(m,rollback)+['ps',WEB]);print(json.dumps({'status':'PASS','release':m['release'],'deployed':m['deployed']}))

if __name__=='__main__':
 action=sys.argv[1] if len(sys.argv)>1 else ''
 if action=='prepare':prepare()
 elif action in ['deploy','rollback','status']:
  m=json.loads((Path(POINTER.read_text().strip())/'manifest.json').read_text())
  if action=='status':print(json.dumps(m,indent=2))
  else:activate(m,action=='rollback')
 else:raise SystemExit('Use prepare|deploy|rollback|status. Explicit owner approval required for activation.')
