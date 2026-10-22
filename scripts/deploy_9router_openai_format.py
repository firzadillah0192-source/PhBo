"""API-only follow-up for OpenAI GPT Image response_format compatibility.

Usage: python3 -I scripts/deploy_9router_openai_format.py prepare|deploy|rollback|status
Deploy/rollback require owner approval. No paid generation or database migration.
"""
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path('/opt/photobooth')
SOURCE = 'backend-express/src/lab/adapters/openai.ts'
PATCH = REPO / 'scripts/patches/9router_openai_format.patch'


def run(*args):
    subprocess.run(list(args), check=True)


def main():
    action = sys.argv[1] if len(sys.argv) == 2 else ''
    assert action in ('prepare', 'deploy', 'rollback', 'status'), 'Use prepare|deploy|rollback|status'
    spec = importlib.util.spec_from_file_location('lab_release', REPO / 'scripts/deploy_ai_lab.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.POINTER = module.RELEASES / '.9router-openai-format-current'
    module.changed_api_files = lambda: (['src/lab/adapters/openai.ts'], [])
    if action in ('prepare', 'deploy'):
        run('python3', '-I', str(REPO / 'scripts/snapshot_express_compose.py'), 'validate')
    if action == 'prepare':
        with tempfile.TemporaryDirectory(prefix='nxbooth-openai-format-scope-') as tmp:
            target = Path(tmp) / SOURCE
            target.parent.mkdir(parents=True)
            run('docker', 'cp', 'photobooth-express:/app/src/lab/adapters/openai.ts', str(target))
            subprocess.run(['patch', '--batch', '--forward', '--fuzz=0', '-p1', '-i', str(PATCH)], cwd=tmp, check=True)
            assert target.read_bytes() == (REPO / SOURCE).read_bytes(), 'Unrelated changes in adapter'
        module.prepare(api_only=True)
        manifest_path = Path(module.POINTER.read_text().strip()) / 'manifest.json'
        manifest = json.loads(manifest_path.read_text())
        manifest.update(task='9router-openai-response-format', source_files=[SOURCE],
                        patch_sha256=hashlib.sha256(PATCH.read_bytes()).hexdigest(), source_committed=False)
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    else:
        module.main()
        if action in ('deploy', 'rollback'):
            run('python3', '-I', str(REPO / 'scripts/snapshot_express_compose.py'), 'generate')
            run('python3', '-I', str(REPO / 'scripts/snapshot_express_compose.py'), 'validate')


if __name__ == '__main__':
    main()
