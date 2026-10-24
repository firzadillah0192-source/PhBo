import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { GenerationApiRoutesService } from '../src/services/generation-api-routes.service.js';
import { generationApiRoutes } from '../src/routes/generation-api.routes.js';
import { AppError } from '../src/lib/errors.js';

test('route management requires Superadmin and does not echo submitted API keys', async () => {
  let saves = 0;
  const app = express(); app.use(express.json());
  const auth = { resolve: async (_cookies: unknown, header: string) => ({ actor_id: 'fixture-admin', role: header }), requireRole: (actor: { role: string }) => { if (actor.role !== 'superadmin') throw new AppError(403, 'ADMIN_FORBIDDEN', 'Forbidden'); } };
  const service = { list: async () => [{ lane: 'fast', configured: false }], save: async (lane: string, body: unknown) => { saves++; return { lane, configured: true }; } };
  app.use('/routes', generationApiRoutes(auth as never, service as never));
  app.use((error: AppError, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status || 422).json({ error: error.code }));
  assert.equal((await request(app).get('/routes').set('x-admin-token', 'operator')).status, 403);
  assert.equal((await request(app).put('/routes/fast').set('x-admin-token', 'operator').send({ api_key: 'synthetic-key' })).status, 403);
  assert.equal(saves, 0);
  const response = await request(app).put('/routes/fast').set('x-admin-token', 'superadmin').send({ api_key: 'synthetic-key' });
  assert.equal(response.status, 200); assert.equal(response.text.includes('synthetic-key'), false); assert.equal(saves, 1);
});


test('Standard inherits production 9Router key/endpoint and cx model while Fast stays disabled', async t => {
  const db = { $queryRaw: async () => [] };
  const service = new GenerationApiRoutesService(db as never, { sessionSecret: 'synthetic-route-secret', baseUrl: 'https://synthetic-router.invalid/v1', standardKey: 'synthetic-existing-key', timeoutMs: 1000, resultOrigins: [] });
  const routes = await service.list();
  assert.equal(routes[0].model, 'cx/gpt-image-2.5'); assert.equal(routes[0].ready, true);
  assert.equal(routes[1].ready, false); assert.equal(routes[1].configured, true);
  assert.equal(routes[1].model, 'openai/gpt-image-2.5-flare');
  assert.equal(JSON.stringify(routes).includes('synthetic-existing-key'), false);
  await assert.rejects(service.provider('fast'), { code: 'AI_PROVIDER_NOT_CONNECTED' });
  const png = await sharp({ create: { width: 8, height: 12, channels: 3, background: 'white' } }).png().toBuffer();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++; assert.equal(url, 'https://synthetic-router.invalid/v1/images/generations');
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-existing-key');
    const payload = JSON.parse(options.body as string);
    assert.equal(payload.model, 'cx/gpt-image-2.5'); assert.equal(payload.quality, 'low');
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
  });
  const provider = await service.provider('standard');
  const generated = await provider.generate(png, 'Synthetic prompt', 'unused-template-model');
  assert.equal(generated.model, 'cx/gpt-image-2.5'); assert.equal(calls, 1);
});

test('explicitly saved Standard model is preserved', async () => {
  const db = { $queryRaw: async () => [{ lane: 'standard', enabled: true, encrypted_key: null, model: 'cx/saved-model' }] };
  const service = new GenerationApiRoutesService(db as never, { sessionSecret: 'synthetic-route-secret', baseUrl: 'https://synthetic-router.invalid/v1', standardKey: 'synthetic-existing-key', timeoutMs: 1000, resultOrigins: [] });
  assert.equal((await service.list())[0].model, 'cx/saved-model');
});

const config = { sessionSecret: 'synthetic-route-secret', baseUrl: 'https://synthetic-router.invalid/v1', standardKey: 'synthetic-router-key', timeoutMs: 1000, resultOrigins: [] };
type RouteRow = { lane: string; enabled: boolean; encrypted_key: string | null; model: string };
function fixture(initial: RouteRow[] = [], overrides = {}) {
  const rows = new Map(initial.map(row => [row.lane, row]));
  const db: any = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      if (strings.join('').includes('pg_advisory')) return [];
      const row = rows.get(String(values[0])); return row ? [row] : [];
    },
    async $executeRaw(_strings: TemplateStringsArray, lane: string, enabled: boolean, encrypted_key: string | null, model: string) { rows.set(lane, { lane, enabled, encrypted_key, model }); },
    nxAuditLog: { create: async () => ({}) },
    async $transaction(fn: (tx: any) => Promise<unknown>) { return fn(db); },
  };
  return { rows, service: new GenerationApiRoutesService(db, { ...config, ...overrides }) };
}

test('Fast uses 9Router openai model, Low, both reference images and ignores legacy OpenAI key', async t => {
  const { service } = fixture([{ lane: 'fast', enabled: true, encrypted_key: 'legacy-direct-key-must-not-be-decrypted', model: 'gpt-image-2.5-flare' }]);
  const png = await sharp({ create: { width: 8, height: 12, channels: 3, background: 'white' } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++; assert.equal(url, config.baseUrl + '/images/generations');
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer ' + config.standardKey);
    const body = JSON.parse(options.body as string);
    assert.equal(body.model, 'openai/gpt-image-2.5-flare'); assert.equal(body.quality, 'low');
    assert.equal(body.size, '8x12'); assert.equal(body.response_format, undefined);
    assert.deepEqual(body.images, [`data:image/png;base64,${png.toString('base64')}`, `data:image/jpeg;base64,${jpeg.toString('base64')}`]);
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 3858, output_tokens: 158, total_tokens: 4016 } }));
  });
  const route = (await service.list())[1];
  assert.deepEqual([route.provider, route.model, route.credits, route.quality, route.ready], ['9router', 'openai/gpt-image-2.5-flare', 100, 'low', true]);
  const result = await (await service.provider('fast')).generate(jpeg, 'Synthetic prompt', 'cx/ignored-template-model', { bytes: png, width: 8, height: 12 });
  assert.equal(result.meta.requested_model, 'openai/gpt-image-2.5-flare'); assert.equal(calls, 1);
});

test('Fast inherits saved Standard gateway key; encrypted Fast gateway override can be cleared', async t => {
  const { service, rows } = fixture();
  await service.save('standard', { enabled: true, model: 'cx/gpt-image-2.5', api_key: 'synthetic-saved-standard', confirm: true }, 'fixture-admin');
  await service.save('fast', { enabled: true, model: 'openai/gpt-image-2.5-sunburst', confirm: true }, 'fixture-admin');
  let expected = 'synthetic-saved-standard';
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, config.baseUrl + '/images/generations');
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer ' + expected);
    return new Response('', { status: 401 });
  });
  const attempt = async () => assert.rejects((await service.provider('fast')).generate(null, 'prompt', 'unused'), { code: 'AI_PROVIDER_ERROR' });
  await attempt();
  await service.save('fast', { enabled: true, model: 'openai/gpt-image-2.5-sunburst', api_key: 'synthetic-fast-router', confirm: true }, 'fixture-admin');
  assert.ok(rows.get('fast')!.encrypted_key!.startsWith('9router:v1:'));
  assert.equal(rows.get('fast')!.encrypted_key!.includes('synthetic-fast-router'), false);
  expected = 'synthetic-fast-router'; await attempt();
  await service.save('fast', { enabled: true, model: 'openai/gpt-image-2.5-sunburst', clear_key: true, confirm: true }, 'fixture-admin');
  expected = 'synthetic-saved-standard'; await attempt();
  assert.equal(JSON.stringify(await service.list()).includes('synthetic-saved-standard'), false);
});

test('Fast requires gateway credentials and endpoint; failure never falls back to cx', async t => {
  const row = { lane: 'fast', enabled: true, encrypted_key: 'legacy-direct-key', model: 'gpt-image-2.5-flare' };
  const missing = fixture([row], { standardKey: '' }).service;
  assert.equal((await missing.list())[1].ready, false);
  await assert.rejects(missing.provider('fast'), { code: 'AI_PROVIDER_NOT_CONNECTED' });
  const noEndpoint = fixture([row], { baseUrl: '' }).service;
  assert.equal((await noEndpoint.list())[1].ready, false);
  await assert.rejects(noEndpoint.provider('fast'), { code: 'AI_PROVIDER_NOT_CONNECTED' });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('synthetic-secret-must-not-leak', { status: 401 }); });
  await assert.rejects((await fixture([row]).service.provider('fast')).generate(null, 'prompt', 'unused'), error => error instanceof AppError && error.code === 'AI_PROVIDER_ERROR' && !error.message.includes('synthetic-secret'));
  assert.equal(calls, 1);
});

test('route saves require openai image model for Fast and cx model for Standard', async () => {
  const { service } = fixture();
  for (const model of ['cx/gpt-image-2.5', 'gpt-image-2.5-flare', 'openai/gpt-5']) {
    await assert.rejects(service.save('fast', { enabled: true, model, confirm: true }, 'fixture-admin'), { code: 'API_ROUTE_INVALID' });
  }
  await assert.rejects(service.save('standard', { enabled: true, model: 'openai/gpt-image-2.5-flare', confirm: true }, 'fixture-admin'), { code: 'API_ROUTE_INVALID' });
  assert.equal((await service.save('fast', { enabled: true, model: 'openai/gpt-image-2.5-flare', confirm: true }, 'fixture-admin'))!.ready, true);
});
