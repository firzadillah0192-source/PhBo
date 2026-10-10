import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerResultService } from '../src/services/customer-result.service.js';
import { WEB_RESULT_RETENTION_MS, webResultExpiresAt } from '../src/services/result-retention.js';

const identity = { account: { id: 'owner' }, guest: null } as never;
function fixture(kiosk = false) {
  const found = { kiosk, result: { id: 'a'.repeat(32), created_at: new Date(Date.now() - WEB_RESULT_RETENTION_MS - 1), deleted_at: null, storage_path: 'minio://results/aa/' + 'a'.repeat(32) + '.png' }, job: { id: 'job', account_id: 'owner' } };
  let marked = 0;
  const model = { async result() { return found; }, async assertPaid() {}, async expiredResults() { return [found.result]; }, async markDeleted() { marked++; }, async createClaim(_result: unknown, input: any) { return { claim: { expires_at: input.expiresAt }, token: 'x'.repeat(32) }; } };
  const objects = { matchesReference() { return true; }, async remove() {}, async signedUrl(_ref: string, expiry: Date) { return { url: 'https://photos.example/fixture', expires_at: expiry }; } };
  const service = new CustomerResultService(model as never, { resultsDir: '/unused', claimHours: 24, publicOrigin: 'http://localhost', production: false }, objects as never);
  return { found, service, objects, marked: () => marked };
}
test('Web expiry blocks owner access at 14 days; kiosk is unaffected; owners may delete expired photos', async () => {
  const web = fixture();
  await assert.rejects(web.service.owned(web.found.result.id, identity), { code: 'RESULT_EXPIRED' });
  await assert.rejects(web.service.delete(web.found.result.id, { account: { id: 'other' }, guest: null } as never), { code: 'RESULT_NOT_FOUND' });
  assert.equal(web.marked(), 0);
  await web.service.delete(web.found.result.id, identity);
  assert.equal(web.marked(), 1);
  const kiosk = fixture(true);
  assert.equal((await kiosk.service.owned(kiosk.found.result.id, identity)).kiosk, true);
});
test('Shared claims and signed URLs never outlive web result retention', async () => {
  const web = fixture();
  web.found.result.created_at = new Date(Date.now() - WEB_RESULT_RETENTION_MS + 3600000);
  const expiry = webResultExpiresAt(web.found.result.created_at);
  assert.equal((await web.service.createClaim(web.found.result.id, identity, { refresh: false, kioskSessionId: null })).expires_at.getTime(), expiry.getTime());
  assert.equal((await web.service.delivery(web.found.result.id, identity)).expires_at?.getTime(), expiry.getTime());
});
test('Retention keeps database state intact when object removal fails and retries safely', async () => {
  const web = fixture();
  web.objects.remove = async () => { throw new Error('Storage offline'); };
  await assert.rejects(web.service.cleanup(), { code: 'RESULT_DELETE_FAILED' });
  assert.equal(web.marked(), 0);
  web.objects.remove = async () => {};
  assert.equal((await web.service.cleanup()).deleted, 1);
  assert.equal(web.marked(), 1);
});
