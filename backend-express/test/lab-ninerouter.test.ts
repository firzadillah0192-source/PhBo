import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTERS } from '../src/lab/adapters/index.js';
import { LabError, type HttpRequest, type HttpResponse } from '../src/lab/types.js';
import { LabVault } from '../src/lab/crypto.js';
import { MemoryLabFiles } from '../src/lab/files.js';
import { LabService, type Actor } from '../src/lab/service.js';
import { MemoryLabStore } from '../src/lab/store.js';
const KEY = 'router-fixture-key-123456';
const admin: Actor = { actor_id: 'a1', role: 'superadmin' };
const json = (body: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });
async function routerLab(handler: (req: HttpRequest) => HttpResponse) {
  const calls: HttpRequest[] = [];
  const lab = new LabService({ store: new MemoryLabStore(), files: new MemoryLabFiles(), vault: new LabVault('router-test-encryption-key'), adapters: ADAPTERS,
    policy: { internalOrigin: 'http://router:20128/v1' }, http: () => ({ async request(req) { calls.push(req); return handler(req); } }),
    sleep: async () => {}, audit: async () => {} });
  const p = await lab.createProvider({ name: '9Router test', type: '9router' }, admin);
  return { lab, p, calls };
}

test('9Router registration defaults to the configured gateway and rejects other origins', async () => {
  const { lab, p, calls } = await routerLab(() => json({ data: [] }));
  assert.equal(p.base_url, 'http://router:20128/v1');
  await assert.rejects(lab.createProvider({ name: 'Wrong gateway', type: '9router', base_url: 'http://localhost:20128/v1' }, admin), (e: LabError) => e.code === 'LAB_URL_FORBIDDEN');
  assert.equal(calls.length, 0);
});

test('9Router imports the image catalog, including names without image keywords; duplicate imports are idempotent', async () => {
  const { lab, p, calls } = await routerLab(req => req.url.endsWith('/v1/models/image')
    ? json({ data: [{ id: 'nb/nanobanana-pro' }, { id: 'openai/gpt-image-1' }, { id: 'nb/nanobanana-pro' }] })
    : json({ data: [{ id: 'chat-only' }] }));
  await lab.setCredential(p.id, KEY, admin);
  const result = await lab.registerModels(p.id, admin);
  assert.equal(result.discovered, true);
  assert.deepEqual(result.models.map(m => m.model_id).sort(), ['nb/nanobanana-pro', 'openai/gpt-image-1']);
  assert.ok(result.models.every(m => m.pricing.method === 'unknown'));
  assert.ok(calls.every(req => req.method === 'GET' && req.url === 'http://router:20128/v1/models/image'));
  const again = await lab.registerModels(p.id, admin);
  assert.equal(again.created, 0); assert.equal(again.skipped.length, 2);
});

test('9Router model import requires a key and surfaces HTTP and malformed-catalog failures', async () => {
  const missing = await routerLab(() => json({ data: [] }));
  await assert.rejects(missing.lab.registerModels(missing.p.id, admin), (e: LabError) => e.code === 'LAB_CREDENTIAL_MISSING');
  assert.equal(missing.calls.length, 0);
  for (const [response, code] of [[json({ error: KEY }, 401), 'LAB_PROVIDER_AUTH'], [json({}, 404), 'LAB_PROVIDER_ERROR'], [json({ data: [{ name: 'invalid' }] }), 'LAB_PROVIDER_ERROR']] as const) {
    const { lab, p, calls } = await routerLab(() => response);
    await lab.setCredential(p.id, KEY, admin);
    await assert.rejects(lab.registerModels(p.id, admin), (e: LabError) => e.code === code && !e.message.includes(KEY));
    assert.equal(calls.length, 1); assert.equal((await lab.listModels()).length, 0);
  }
});

