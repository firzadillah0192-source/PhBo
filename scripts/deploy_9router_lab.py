"""Deploy the committed 9Router Lab patch onto the current live source only.

Usage: python3 -I scripts/deploy_9router_lab.py prepare|deploy|rollback|status
Deployment requires explicit owner approval. No database or worker changes.
The patch is kept separately because the live Lab baseline is not fully committed.
"""
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path('/opt/photobooth')
PATCH = REPO / 'scripts/patches/9router_lab.patch'
FILES = ['backend-express/src/lab/adapters/openai.ts', 'backend-express/src/lab/service.ts',
         'frontend/src/components/admin/AiProviderLab.jsx']


def run(*args):
    subprocess.run(list(args), check=True)


def engine():
    spec = importlib.util.spec_from_file_location('lab_release', REPO / 'scripts/deploy_ai_lab.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.POINTER = module.RELEASES / '.9router-lab-current'
    module.API_MODIFIED = [p.removeprefix('backend-express/') for p in FILES if p.startswith('backend-express/')]
    module.API_NEW = []
    module.WEB_MODIFIED = ['src/components/admin/AiProviderLab.jsx']
    module.WEB_NEW = []
    return module


def verify_scope(module):
    old_hash = module.live_hash('/usr/share/nginx/html/index.html')
    source = next((p.parent.parent for p in sorted(module.RELEASES.glob('*/frontend/dist/index.html'), reverse=True)
                   if hashlib.sha256(p.read_bytes()).hexdigest() == old_hash), None)
    assert source, 'No frontend source snapshot matches live HTML'
    with tempfile.TemporaryDirectory(prefix='nxbooth-9router-scope-') as tmp:
        root = Path(tmp)
        for path in FILES:
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            if path.startswith('backend-express/'):
                run('docker', 'cp', 'photobooth-express:/app/' + path.removeprefix('backend-express/'), str(target))
            else:
                target.write_bytes((source / path.removeprefix('frontend/')).read_bytes())
        subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '-p1', '-i', str(PATCH)], cwd=root, check=True)
        for path in FILES:
            assert (root / path).read_bytes() == (REPO / path).read_bytes(), 'Unrelated source changes in ' + path


def main():
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    assert action in ('prepare', 'deploy', 'rollback', 'status'), 'Use prepare|deploy|rollback|status'
    module = engine()
    if action in ('prepare', 'deploy'):
        run('python3', '-I', str(REPO / 'scripts/snapshot_express_compose.py'), 'validate')
    if action == 'prepare':
        verify_scope(module)
        module.prepare()
        manifest_path = Path(module.POINTER.read_text().strip()) / 'manifest.json'
        manifest = json.loads(manifest_path.read_text())
        manifest.update(task='9router-lab-fix', patch_sha256=hashlib.sha256(PATCH.read_bytes()).hexdigest(),
                        source_files=FILES, commit=subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip())
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    else:
        if action == 'rollback':
            original_get = module.get
            # The previous release already has the authenticated Lab endpoint.
            module.get = lambda path, expect=200: original_get(path, 401 if path == '/api/admin/lab/overview' else expect)
        module.main()
        if action in ('deploy', 'rollback'):
            run('python3', '-I', str(REPO / 'scripts/snapshot_express_compose.py'), 'generate')
            run('python3', '-I', str(REPO / 'scripts/snapshot_express_compose.py'), 'validate')


if __name__ == '__main__':
    main()
