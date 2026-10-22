"""Prepare/deploy/rollback: Basic likeness prompt head-fit + theme-colored footer text.

Reuses deploy_fast_prompt (API/worker prompt patch) and adds a patched image-helper
with result_footer.py. Each deploy requires owner approval."""
import json,shutil,subprocess,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import deploy_fast_prompt as F
HELPER='photobooth-image-helper'
def prepare():
 F.prepare()
 p=Path(F.P.read_text().strip());m=json.loads((p/'manifest.json').read_text());before=F.inspect(HELPER)
 ctx=p/'helper-image';ctx.mkdir();shutil.copy2(F.R/'backend-express/python-worker/result_footer.py',ctx/'result_footer.py');shutil.copy2(F.R/'backend-express/python-worker/basic_api.py',ctx/'basic_api.py');shutil.copy2(F.R/'backend-express/python-worker/basic_edit.py',ctx/'basic_edit.py');shutil.copy2(F.R/'backend-express/python-worker/basic_edit.py',ctx/'basic_edit.py')
 (ctx/'Dockerfile').write_text('FROM '+before['Config']['Image']+'\nCOPY result_footer.py basic_api.py basic_edit.py /engine/\n')
 image='photobooth-express:'+p.name+'-helper'
 subprocess.run(['docker','build','--network','none','-t',image,str(ctx)],check=True)
 for name,img in (('compose.fast-prompt.json',image),('compose.rollback.json',before['Config']['Image'])):
  c=json.loads((p/name).read_text());c['services'][HELPER]={'image':img};F.save(p/name,c)
 m['images'][HELPER]=image;m['previous_images'][HELPER]=before['Config']['Image'];m['previous_ids'][HELPER]=before['Id']
 m['changed_files']+=['python-worker/result_footer.py','python-worker/basic_api.py','python-worker/basic_edit.py'];F.save(p/'manifest.json',m)
 args,e=F.command(p);F.run(args+['config','--quiet'],env=e);print(json.dumps(m,indent=2))
if __name__=='__main__':
 action=sys.argv[1] if len(sys.argv)>1 else ''
 if action=='prepare':prepare()
 elif action in ('deploy','rollback'):
  F.NAMES.append(HELPER);p=Path(F.P.read_text().strip());F.deploy(p,json.loads((p/'manifest.json').read_text()),action=='rollback')
 else:raise SystemExit('Use prepare|deploy|rollback')
