"""Activation safety checks; mocks block all production operations."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('activation',Path(__file__).with_name('deploy_generation_webhooks.py'));d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
class ActivationTest(unittest.TestCase):
 def test_stale_candidate_stops_before_secret_creation_or_container_mutation(self):
  with patch.object(d.h,'snapshot'),patch.object(d,'schema_ready'),patch.object(d.h,'ins',return_value={'Id':'changed-live-release'}),patch.object(d,'keyring') as keyring,patch.object(d,'run') as run:
   with self.assertRaisesRegex(AssertionError,'Live release changed'):d.deploy(Path('/synthetic'),{'status':'PREPARED_PENDING_ACTIVATION','deployed':False,'previous_ids':{n:'original' for n in d.TARGETS}})
   keyring.assert_not_called();run.assert_not_called()
 def test_sql_hash_guard_precedes_dump_and_database_mutation(self):
  with tempfile.TemporaryDirectory(dir='/srv/photobooth/tmp',prefix='webhook-activation-test-') as folder:
   p=Path(folder);(p/'backend/migrations').mkdir(parents=True);(p/'backend/migrations/027_generation_webhooks.sql').write_text('-- synthetic edited SQL')
   with patch.object(d,'run') as run:
    with self.assertRaisesRegex(AssertionError,'Reviewed SQL changed'):d.apply_sql(p,{'deployed':False,'migration_sha256':'wrong-hash'})
    run.assert_not_called()
 def test_private_config_is_stable_and_rejects_readable_or_symlink_paths(self):
  with tempfile.TemporaryDirectory(dir='/srv/photobooth/tmp',prefix='webhook-activation-test-') as folder:
   p=Path(folder)/'private';ring,version=d.keyring(p);second=d.keyring(p);self.assertTrue((ring,version)==second);values=dict(line.split('=',1) for line in (p/'runtime.env').read_text().splitlines());self.assertTrue(values['WEBHOOK_SECRET_ENCRYPTION_KEY']==ring);self.assertEqual((p/'runtime.env').stat().st_mode&0o777,0o600);self.assertEqual(len(json.loads(ring)[version]),64)
   (p/'keyring.json').chmod(0o644)
   with self.assertRaisesRegex(AssertionError,'must be private'):d.keyring(p)
   alias=Path(folder)/'alias';alias.symlink_to(p,target_is_directory=True)
   with self.assertRaises(AssertionError):d.keyring(alias)
if __name__=='__main__':unittest.main()
