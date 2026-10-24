import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { ADAPTERS } from '../src/lab/adapters/index.js';
import { validateBaseUrl } from '../src/lab/net.js';
import { LabError, type AdapterContext, type HttpRequest, type HttpResponse } from '../src/lab/types.js';

const KEY = 'sk-test-SECRET1234567890';
const png = () => sharp({ create: { width: 64, height: 64, channels: 3, background: '#4a8' } }).png().toBuffer();
const json = (body: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });
function ctxOf(type: 'recraft' | 'runway', handler: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>) {
  const calls: HttpRequest[] = [];
  const ctx: AdapterContext = { baseUrl: ADAPTERS[type]!.defaultBaseUrl, secret: KEY, authMethod: 'bearer', sleep: async () => {}, timeoutMs: 5000, pollIntervalMs: 1,
    http: { async request(req) { calls.push(req); return handler(req); } } };
  return { ctx, calls };
}

test('provider hosts are pinned for Recraft and Runway', () => {
  assert.equal(validateBaseUrl('recraft', 'https://external.api.recraft.ai/v1'), 'https://external.api.recraft.ai/v1');
  assert.equal(validateBaseUrl('runway', 'https://api.dev.runwayml.com/v1'), 'https://api.dev.runwayml.com/v1');
  assert.throws(() => validateBaseUrl('recraft', 'https://evil.example.com/v1'), /not allowed/);
  assert.throws(() => validateBaseUrl('runway', 'http://api.dev.runwayml.com/v1'), /HTTPS/);
});

test('Runway: single submit, polls the task, downloads the output; version header and reference images sent', async () => {
  const out = await png(); let polls = 0;
  const { ctx, calls } = ctxOf('runway', req => {
    const url = new URL(req.url);
    if (url.pathname === '/v1/text_to_image') return json({ id: 'task-1' });
    if (url.pathname === '/v1/tasks/task-1') return json(++polls < 2 ? { status: 'RUNNING' } : { status: 'SUCCEEDED', output: ['https://cdn.example.com/out.png'] });
    if (url.hostname === 'cdn.example.com') return { status: 200, headers: {}, body: out };
    return json({}, 404);
  });
  let submitted = '';
  const result = await ADAPTERS.runway!.generate(ctx, { model_id: 'gen4_image', prompt: 'p', size: '1024x1024', images: [{ bytes: await png(), contentType: 'image/png' } as never, { bytes: await png(), contentType: 'image/png' } as never], onSubmitted: async id => { submitted = id; } });
  assert.equal(result.request_id, 'task-1'); assert.equal(submitted, 'task-1'); assert.equal(result.images.length, 1);
  const submit = calls.filter(c => c.method === 'POST'); assert.equal(submit.length, 1);
  assert.equal(submit[0]!.headers!['X-Runway-Version'], '2024-11-06');
  const body = JSON.parse(String(submit[0]!.body)); assert.equal(body.ratio, '1024:1024'); assert.equal(body.referenceImages.length, 2);
});
test('Runway: failed task and rejected credentials give sanitized errors', async () => {
  const failed = ctxOf('runway', req => new URL(req.url).pathname.endsWith('/text_to_image') ? json({ id: 't' }) : json({ status: 'FAILED', failure: 'content moderation' }));
  await assert.rejects(ADAPTERS.runway!.generate(failed.ctx, { model_id: 'gen4_image', prompt: 'p', images: [] }), /failed: content moderation/);
  const denied = ctxOf('runway', () => json({ error: `bad key ${KEY}` }, 401));
  await assert.rejects(ADAPTERS.runway!.generate(denied.ctx, { model_id: 'gen4_image', prompt: 'p', images: [] }), (e: any) => e instanceof LabError && e.code === 'LAB_PROVIDER_AUTH' && !e.message.includes(KEY));
  assert.equal((await ADAPTERS.runway!.testConnection(denied.ctx)).ok, false);
});

test('Recraft: text-to-image uses JSON generations; one image uses multipart imageToImage; two images are refused before any request', async () => {
  const out = await png();
  const { ctx, calls } = ctxOf('recraft', req => new URL(req.url).hostname === 'cdn.example.com' ? { status: 200, headers: {}, body: out } : json({ data: [{ url: 'https://cdn.example.com/r.png' }] }));
  await ADAPTERS.recraft!.generate(ctx, { model_id: 'recraftv4_1', prompt: 'p', size: '1024x1024', images: [] });
  assert.match(calls[0]!.url, /\/images\/generations$/); assert.equal(JSON.parse(String(calls[0]!.body)).model, 'recraftv4_1');
  const one = { bytes: await png(), contentType: 'image/png' } as never;
  await ADAPTERS.recraft!.generate(ctx, { model_id: 'recraftv3', prompt: 'p', images: [one] });
  const i2i = calls.find(c => c.url.endsWith('/images/imageToImage'))!; assert.match(i2i.headers!['Content-Type']!, /^multipart\/form-data/);
  const before = calls.length;
  await assert.rejects(ADAPTERS.recraft!.generate(ctx, { model_id: 'recraftv3', prompt: 'p', images: [one, one] }), /one input image/);
  assert.equal(calls.length, before);
});

import { LabVault } from '../src/lab/crypto.js';
import { MemoryLabFiles } from '../src/lab/files.js';
import { LabService, type Actor } from '../src/lab/service.js';
import { MemoryLabStore } from '../src/lab/store.js';
const admin: Actor = { actor_id: 'a1', role: 'superadmin' };
async function labWith(type: string, http: (req: HttpRequest) => HttpResponse, withKey = true) {
  const lab = new LabService({ store: new MemoryLabStore(), files: new MemoryLabFiles(), vault: new LabVault(Buffer.alloc(32, 7).toString('base64')), adapters: ADAPTERS, http: () => ({ request: async (r: HttpRequest) => http(r) }),
    now: () => new Date('2026-10-13T10:00:00Z'), sleep: async () => {}, audit: async () => {}, timeoutMs: 5000, pollIntervalMs: 1 } as never);
  const p = await lab.createProvider({ name: `${type} test`, type }, admin);
  if (withKey) await lab.setCredential(p.id, KEY, admin);
  return { lab, p };
}
test('Register models works for non-WaveSpeed providers: documented candidates are filtered by the live list, no price is invented', async () => {
  const { lab, p } = await labWith('openai', req => req.url.endsWith('/v1/models') ? json({ data: [{ id: 'gpt-image-1' }, { id: 'gpt-4o' }, { id: 'gpt-image-2' }] }) : json({}, 404));
  const r = await lab.registerModels(p.id, admin);
  const ids = r.models.map(m => m.model_id).sort();
  assert.deepEqual(ids, ['gpt-image-1', 'gpt-image-2']); assert.ok(r.unavailable.includes('gpt-image-2.5-flare') && r.unavailable.includes('gpt-image-1-mini')); assert.equal(r.discovered, true);
  assert.ok(r.models.every(m => m.pricing.method === 'tokens'));
  const again = await lab.registerModels(p.id, admin); assert.equal(again.created, 0); assert.equal(again.skipped.length, 2);
});
test('Register models without a credential falls back to documented candidates (Runway keeps vendor prices)', async () => {
  const { lab, p } = await labWith('runway', () => json({}, 500), false);
  const r = await lab.registerModels(p.id, admin);
  assert.equal(r.discovered, false); assert.equal(r.created, 2);
  assert.equal(r.models.find(m => m.model_id === 'gen4_image_turbo')!.pricing.per_image_usd, 0.02);
});

import { estimate } from '../src/lab/pricing.js';
test('OpenAI token pricing: estimate follows the chosen quality; unpriced tiers and a missing quality stay unknown', async () => {
  const { lab, p } = await labWith('openai', () => json({}, 404), false);
  const flare = (await lab.registerModels(p.id, admin)).models.find(m => m.model_id === 'gpt-image-2.5-flare')!;
  assert.equal(flare.pricing.input_usd_per_million_tokens, 8); assert.equal(flare.pricing.output_usd_per_million_tokens, 30);
  const medium = estimate(flare.pricing, { reference_images: 1, quality: 'medium' }), high = estimate(flare.pricing, { reference_images: 1, quality: 'high' });
  assert.equal(medium.known, true); assert.equal(medium.usd, 0.07701); assert.ok(high.usd! > medium.usd! * 2);
  assert.equal(estimate(flare.pricing, { reference_images: 1, quality: 'xhigh' }).known, false);
  assert.match(estimate(flare.pricing, { reference_images: 1 }).reason!, /Choose a quality/);
});
