"""No Docker calls: private webhook env_file must preserve compatibility without secret literals."""
import importlib.util,json,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('snapshot',Path(__file__).with_name('snapshot_express_compose.py'));s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class SnapshotWebhookTest(unittest.TestCase):
 def fixture(self):return {'Config':{'Image':'synthetic','User':'','WorkingDir':'/app','Cmd':['node','dist/migration-server.js'],'Env':['WEBHOOK_SECRET_ENCRYPTION_KEY=synthetic-private-value','WEBHOOK_SECRET_ENCRYPTION_VERSION=v1'],'Labels':{}},'HostConfig':{'RestartPolicy':{'Name':'unless-stopped'},'Binds':[]},'Image':'synthetic'}
 def test_keyring_uses_private_file_no_literal_or_manual_environment_needed(self):
  with patch.object(s,'inspect',return_value=self.fixture()),patch.object(s,'image_env',return_value={}),patch.object(s,'webhook_env',return_value={'WEBHOOK_SECRET_ENCRYPTION_KEY':'synthetic-private-value','WEBHOOK_SECRET_ENCRYPTION_VERSION':'v1'}):result=s.service_def('photobooth-express',{})
  self.assertNotIn('synthetic-private-value',json.dumps(result));self.assertNotIn('WEBHOOK_SECRET_ENCRYPTION_KEY',result['environment']);self.assertEqual(result['env_file'],[str(s.WEBHOOK_ENV)])
 def test_missing_or_different_private_config_blocks_snapshot(self):
  with patch.object(s,'inspect',return_value=self.fixture()),patch.object(s,'image_env',return_value={}),patch.object(s,'webhook_env',return_value={}):
   with self.assertRaises(AssertionError):s.service_def('photobooth-express',{})
if __name__=='__main__':unittest.main()
