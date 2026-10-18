import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { DirectOpenAIImageProvider, GenerationApiRoutesService } from '../src/services/generation-api-routes.service.js';
import { generationApiRoutes } from '../src/routes/generation-api.routes.js';
import { AppError } from '../src/lib/errors.js';

test('Fast uses direct Images API edits, fixed Low, configured model and both reference photos', async () => {
  const png = await sharp({ create: { width: 8, height: 12, channels: 3, background: 'white' } }).png().toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  let calls = 0;
  const provider = new DirectOpenAIImageProvider('synthetic-key', 'gpt-image-2.5-flare', async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://api.openai.com/v1/images/edits');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer synthetic-key');
    const form = options?.body as FormData;
    assert.equal(form.get('quality'), 'low'); assert.equal(form.get('model'), 'gpt-image-2.5-flare');
    assert.equal(form.get('size'), '1024x1536'); assert.equal(form.get('response_format'), null);
    assert.equal(form.getAll('image[]').length, 2);
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }], usage: { input_tokens: 3858, output_tokens: 158, total_tokens: 4016 } }));
  });
  const result = await provider.generate(jpeg, 'Synthetic prompt', 'old-template-model', { bytes: png, width: 8, height: 12 });
  assert.equal(result.model, 'gpt-image-2.5-flare'); assert.equal(result.meta.input_tokens, 3858);
  assert.equal(calls, 1);
});

test('Fast unconfigured/upstream failure returns a real error and never retries via Standard', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response('synthetic-secret-must-not-leak', { status: 401 }); };
  await assert.rejects(new DirectOpenAIImageProvider('', 'gpt-image-2.5-flare', fetcher).generate(null, 'x', 'x'), { code: 'AI_PROVIDER_NOT_CONNECTED' });
  assert.equal(calls, 0);
  await assert.rejects(new DirectOpenAIImageProvider('synthetic', 'gpt-image-2.5-flare', fetcher).generate(null, 'x', 'x'), error => error instanceof AppError && error.code === 'AI_PROVIDER_ERROR' && !error.message.includes('synthetic-secret'));
  assert.equal(calls, 1);
});

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


test('Standard inherits production 9Router key/endpoint and cx model while Fast stays unconfigured', async t => {
  const db = { $queryRaw: async () => [] };
  const service = new GenerationApiRoutesService(db as never, { sessionSecret: 'synthetic-route-secret', baseUrl: 'https://synthetic-router.invalid/v1', standardKey: 'synthetic-existing-key', timeoutMs: 1000, resultOrigins: [] });
  const routes = await service.list();
  assert.equal(routes[0].model, 'cx/gpt-image-2.5'); assert.equal(routes[0].ready, true);
  assert.equal(routes[1].ready, false); assert.equal(routes[1].configured, false);
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
  const db = { $queryRaw: async () => [{ lane: 'standard', enabled: true, encrypted_key: null, model: 'synthetic/saved-model' }] };
  const service = new GenerationApiRoutesService(db as never, { sessionSecret: 'synthetic-route-secret', baseUrl: 'https://synthetic-router.invalid/v1', standardKey: 'synthetic-existing-key', timeoutMs: 1000, resultOrigins: [] });
  assert.equal((await service.list())[0].model, 'synthetic/saved-model');
});
