import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { LabVault, redact } from '../src/lab/crypto.js';
import { MemoryLabFiles } from '../src/lab/files.js';
import { isPublicAddress, validateBaseUrl } from '../src/lab/net.js';
import { calculateFromUsage, estimate } from '../src/lab/pricing.js';
import { labRoutes } from '../src/lab/routes.js';
import { LabService, type Actor } from '../src/lab/service.js';
import { MemoryLabStore } from '../src/lab/store.js';
import { ADAPTERS } from '../src/lab/adapters/index.js';
import { AppError } from '../src/lib/errors.js';
import { LabError, type HttpRequest, type HttpResponse, type LabHttp, type Pricing } from '../src/lab/types.js';

const KEY = 'ws-live-SECRETKEY1234567890';
const admin: Actor = { actor_id: 'admin-1', role: 'superadmin' };
const png = (color = '#c44') => sharp({ create: { width: 128, height: 96, channels: 3, background: color } }).png().toBuffer();
const json = (body: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });

// Scripted WaveSpeed-shaped fake. Records every request; no network.
const PRICES: Record<string, number> = { 'wavespeed-ai/qwen-image/edit': 0.03 };
function waveSpeedFake(opts: { statuses?: string[]; failSubmit?: number; outputBytes?: Buffer } = {}) {
  const calls: HttpRequest[] = []; const statuses = [...(opts.statuses ?? ['processing', 'completed'])];
  const http: LabHttp = { async request(req) {
    calls.push(req);
    const url = new URL(req.url);
    if (url.pathname === '/api/v3/model/price') { const model = JSON.parse(String(req.body)).model_id as string, price = PRICES[model] ?? 0.02; return json({ code: 200, data: { model_id: model, price, discounted_price: price, discount_rate: 100, currency: 'USD' } }); }
    if (url.pathname.endsWith('/images/edits') || url.pathname.endsWith('/images/generations')) return json({ data: [{ b64_json: (await png('#2a6')).toString('base64') }] });
    if (url.pathname === '/api/v3/media/uploads') return json({ code: 200, data: { upload: { method: 'PUT', url: 'https://uploads.example.com/put/1', headers: { 'Content-Type': 'image/png' } }, download_url: `https://cdn.example.com/in/${calls.length}.png` } });
    if (req.method === 'PUT') return { status: 200, headers: {}, body: Buffer.alloc(0) };
    if (url.pathname.startsWith('/api/v3/wavespeed-ai/')) return opts.failSubmit ? json({ message: `bad key ${KEY}` }, opts.failSubmit) : json({ code: 200, data: { id: 'pred-1', status: 'created', outputs: [] } });
    if (url.pathname === '/api/v3/predictions/pred-1/result') { const status = statuses.shift() ?? 'completed'; return json({ code: 200, data: { id: 'pred-1', status, outputs: status === 'completed' ? ['https://cdn.example.com/out/1.png'] : [], timings: { inference: 4321 } } }); }
    if (url.pathname === '/out/1.png') return { status: 200, headers: {}, body: opts.outputBytes ?? await png('#2a6') };
    if (url.pathname === '/api/v3/predictions') return json({ code: 200, data: { items: [] } });
    return json({}, 404);
  } };
  return { http, calls };
}
async function setup(fake: ReturnType<typeof waveSpeedFake> = waveSpeedFake(), now = () => new Date('2026-10-12T10:00:00Z')) {
  const store = new MemoryLabStore(), files = new MemoryLabFiles(), audits: { action: string; meta?: unknown }[] = [];
  const lab = new LabService({ store, files, vault: new LabVault('lab-test-encryption-key-123'), adapters: ADAPTERS, http: () => fake.http, now, sleep: async () => undefined,
    audit: async (_a, action, _t, _id, _r, meta) => { audits.push({ action, meta }); } });
  const provider = await lab.createProvider({ name: 'WaveSpeed', type: 'wavespeed' }, admin);
  await lab.setCredential(provider.id, KEY, admin);
  await lab.updateProvider(provider.id, { enabled: true }, admin);
  const pricing: Pricing = { method: 'per_image', currency: 'USD', per_image_usd: 0.02, source: 'WaveSpeed docs (test fixture)', verified_at: '2026-10-01T00:00:00Z', assumptions: 'fixture' };
  const model = await lab.saveModel(null, { provider_id: provider.id, model_id: 'wavespeed-ai/qwen-image/edit-plus', display_name: 'Qwen Edit Plus', tasks: ['image-to-image', 'multi-reference-edit'],
    sizes: ['1024*1024'], max_reference_images: 3, supports: { seed: true, size: true, negative_prompt: false, quality: [], output_format: ['png'] }, pricing }, admin);
  await lab.updateSettings({ per_request_usd: 0.25, daily_usd: 2, monthly_usd: 20, max_runs_per_request: 6, max_active_runs: 6, enforce_sequence: false }, admin);
  return { lab, store, files, provider, model, audits, fake };
}
const images = async () => [{ bytes: await png('#c44'), role: 'template' as const }, { bytes: await png('#48c'), role: 'reference' as const }];
const confirmed = (usd: number | null, extra = {}) => ({ confirm: true, total_usd: usd, ...extra });
async function runOnce(ctx: Awaited<ReturnType<typeof setup>>, extra: Partial<Parameters<LabService['createRuns']>[0][0]> = {}, conf = confirmed(0.02)) {
  const { runs, done } = await ctx.lab.createRuns([{ model_ref: ctx.model.id, prompt: 'Put the person into the template', images: await images(), ...extra }], admin, conf);
  await done; return ctx.lab.getRun(runs[0]!.id);
}

test('provider registration never exposes the API key and encrypts it at rest', async () => {
  const { lab, store, provider } = await setup();
  const [view] = await lab.listProviders();
  assert.equal(view!.credential.configured, true); assert.equal(view!.credential.masked, '••••••••7890');
  assert.ok(!JSON.stringify(view).includes(KEY));
  const raw = JSON.stringify(await store.get('provider', provider.id));
  assert.ok(!raw.includes(KEY), 'secret must be encrypted in storage');
  assert.ok(!JSON.stringify(await lab.listProviders()).includes('secret_enc'));
});
test('credential removal disables the provider; rotation and removal are audited', async () => {
  const { lab, provider, audits } = await setup();
  await lab.setCredential(provider.id, 'new-key-abcdefgh-9999', admin);
  const removed = await lab.removeCredential(provider.id, admin);
  assert.equal(removed.credential.configured, false); assert.equal(removed.enabled, false);
  assert.deepEqual(audits.map(a => a.action).filter(a => a.includes('credential')), ['lab.credential_set', 'lab.credential_rotate', 'lab.credential_remove']);
});
test('credentials cannot be stored without a Lab encryption key', async () => {
  const lab = new LabService({ store: new MemoryLabStore(), files: new MemoryLabFiles(), vault: new LabVault(''), adapters: ADAPTERS, audit: async () => undefined });
  const p = await lab.createProvider({ name: 'WS', type: 'wavespeed' }, admin);
  await assert.rejects(lab.setCredential(p.id, 'abcdefgh1234', admin), (e: LabError) => e.code === 'LAB_ENCRYPTION_NOT_CONFIGURED');
});
test('redact removes known secrets and token-looking strings', () => {
  assert.ok(!redact(`failed Bearer abcdefghijklmnop and ${KEY}`, [KEY]).includes('abcdefghijklmnop'));
  assert.ok(!redact(`api_key: ${KEY}`, [KEY]).includes(KEY));
});
test('SSRF protection: HTTPS only, fixed hosts, no IP literals or internal addresses', () => {
  assert.throws(() => validateBaseUrl('custom_rest', 'http://example.com'), /HTTPS/);
  assert.throws(() => validateBaseUrl('custom_rest', 'https://127.0.0.1'), /IP-literal/);
  assert.throws(() => validateBaseUrl('custom_rest', 'https://localhost'), /Internal/);
  assert.throws(() => validateBaseUrl('custom_rest', 'https://user:pw@example.com'), /credentials/);
  assert.throws(() => validateBaseUrl('custom_rest', 'https://example.com:8443'), /port/);
  assert.throws(() => validateBaseUrl('wavespeed', 'https://evil.example.com'), /not allowed/);
  assert.throws(() => validateBaseUrl('9router', 'http://169.254.169.254'), /gateway configured/);
  assert.equal(validateBaseUrl('9router', 'http://router:20128/v1', { internalOrigin: 'http://router:20128/v1' }), 'http://router:20128/v1');
  assert.equal(validateBaseUrl('wavespeed', 'https://api.wavespeed.ai/'), 'https://api.wavespeed.ai');
  for (const a of ['10.0.0.1', '172.16.5.5', '192.168.1.1', '127.0.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(isPublicAddress(a), false, a);
  assert.equal(isPublicAddress('8.8.8.8'), true);
});
test('pricing: every method, reference fees and Pricing Unknown', () => {
  const base = { currency: 'USD', source: 's', verified_at: null, assumptions: '' } as const;
  assert.equal(estimate({ ...base, method: 'per_image', per_image_usd: 0.02, reference_image_fee_usd: 0.005 }, { reference_images: 2 }).usd, 0.03);
  assert.equal(estimate({ ...base, method: 'per_megapixel', per_megapixel_usd: 0.04 }, { reference_images: 0, width: 1000, height: 1000 }).usd, 0.04);
  assert.equal(estimate({ ...base, method: 'per_megapixel', per_megapixel_usd: 0.04 }, { reference_images: 0 }).known, false);
  assert.equal(estimate({ ...base, method: 'tokens', input_usd_per_million_tokens: 5, output_usd_per_million_tokens: 40, assumed_input_tokens: 1000, assumed_output_tokens: 1000 }, { reference_images: 0 }).usd, 0.045);
  assert.equal(estimate({ ...base, method: 'compute_time', per_second_usd: 0.001, assumed_seconds: 10 }, { reference_images: 0, count: 3 }).usd, 0.03);
  const unknown = estimate({ ...base, method: 'unknown' }, { reference_images: 1 });
  assert.deepEqual([unknown.known, unknown.usd], [false, null]); assert.match(unknown.reason!, /Pricing Unknown/);
  assert.equal(estimate({ ...base, method: 'per_image' }, { reference_images: 0 }).known, false);
  assert.equal(calculateFromUsage({ ...base, method: 'tokens', input_usd_per_million_tokens: 5, output_usd_per_million_tokens: 40 }, { input_tokens: 2000, output_tokens: 500 }, null, 0), 0.03);
  assert.equal(calculateFromUsage({ ...base, method: 'per_image', per_image_usd: 1 }, { input_tokens: 2000, output_tokens: 500 }, null, 0), null);
});
test('generation requires explicit confirmation of the exact server estimate', async () => {
  const ctx = await setup(), input = { model_ref: ctx.model.id, prompt: 'p', images: await images() };
  await assert.rejects(ctx.lab.createRuns([input], admin, { total_usd: 0.02 }), (e: LabError) => e.code === 'LAB_CONFIRMATION_REQUIRED');
  await assert.rejects(ctx.lab.createRuns([input], admin, confirmed(0.001)), (e: LabError) => e.code === 'LAB_ESTIMATE_CHANGED');
  assert.equal((await ctx.lab.listRuns({})).length, 0);
  assert.equal(ctx.fake.calls.filter(c => c.url.includes('/wavespeed-ai/qwen-image/edit-plus')).length, 0, 'no generation submitted before confirmation');
});
test('WaveSpeed async lifecycle: upload, submit, poll, download; sanitized history persisted', async () => {
  const ctx = await setup(waveSpeedFake({ statuses: ['created', 'processing', 'completed'] }));
  const run = await runOnce(ctx, { seed: 7, size: '1024*1024', output_format: 'png' });
  assert.equal(run.status, 'SUCCEEDED'); assert.equal(run.provider_request_id, 'pred-1');
  assert.equal(run.cost.estimated_usd, 0.02); assert.equal(run.cost.provider_reported_usd, null); assert.match(run.cost.basis, /provider quotation; awaiting billing/); assert.equal(run.billing!.status, 'not_started');
  assert.deepEqual([run.output!.width, run.output!.height], [128, 96]);
  const submit = ctx.fake.calls.find(c => c.url.endsWith('/api/v3/wavespeed-ai/qwen-image/edit-plus'))!;
  const body = JSON.parse(String(submit.body));
  assert.equal(body.images.length, 2); assert.equal(body.seed, 7); assert.equal(body.size, '1024*1024'); assert.equal(body.enable_sync_mode, false);
  assert.equal(submit.headers!.Authorization, `Bearer ${KEY}`);
  assert.equal(ctx.fake.calls.filter(c => c.url.endsWith('/result')).length, 3);
  assert.ok((await ctx.lab.runFile(run.id, 'output')).bytes.length > 0);
  const history = await ctx.lab.listRuns({}); assert.equal(history.length, 1);
  assert.ok(!JSON.stringify(history).includes(KEY));
  const downloads = ctx.fake.calls.filter(c => c.method === 'GET' && c.url.includes('/out/'));
  assert.ok(downloads.every(c => !c.auth), 'credentials never sent when downloading outputs');
});
test('unsupported parameters are dropped, not sent', async () => {
  const ctx = await setup();
  const run = await runOnce(ctx, { negative_prompt: 'blurry', quality: 'high', size: '999*999' });
  const body = JSON.parse(String(ctx.fake.calls.find(c => c.url.endsWith('/wavespeed-ai/qwen-image/edit-plus'))!.body));
  assert.ok(!('negative_prompt' in body) && !('quality' in body) && !('size' in body));
  assert.deepEqual((run.params as { ignored_unsupported: string[] }).ignored_unsupported.sort(), ['negative_prompt', 'quality', 'size']);
});
test('provider failure is recorded with a redacted message, never retried, and does not count as spend', async () => {
  const ctx = await setup(waveSpeedFake({ failSubmit: 400 }));
  const run = await runOnce(ctx);
  assert.equal(run.status, 'FAILED'); assert.equal(run.error_code, 'LAB_PROVIDER_ERROR'); assert.ok(!run.error_message!.includes(KEY));
  assert.equal(ctx.fake.calls.filter(c => c.url.endsWith('/wavespeed-ai/qwen-image/edit-plus')).length, 1, 'no automatic retry');
  assert.equal((await ctx.lab.budget()).spent.today_usd, 0);
  assert.equal((await ctx.lab.listModels())[0]!.status, 'failing');
});
test('rate limit and auth failures map to stable codes', async () => {
  for (const [status, code] of [[429, 'LAB_PROVIDER_RATE_LIMITED'], [401, 'LAB_PROVIDER_AUTH']] as const) {
    const run = await runOnce(await setup(waveSpeedFake({ failSubmit: status })));
    assert.equal(run.error_code, code);
  }
});
test('provider-reported failure statuses end the run', async () => {
  const run = await runOnce(await setup(waveSpeedFake({ statuses: ['processing', 'failed'] })));
  assert.equal(run.error_code, 'LAB_PROVIDER_FAILED');
});
test('timeouts are counted as possible spend', async () => {
  const fake = waveSpeedFake({ statuses: Array(500).fill('processing') });
  let t = Date.parse('2026-10-12T10:00:00Z');
  const ctx = await setup(fake, () => new Date(t));
  (ctx.lab as unknown as { d: { sleep: (ms: number) => Promise<void>; timeoutMs: number } }).d.sleep = async ms => { t += ms; };
  const real = Date.now; Date.now = () => t; try {
    const run = await runOnce(ctx); assert.equal(run.error_code, 'LAB_TIMEOUT');
  } finally { Date.now = real; }
  assert.equal((await ctx.lab.budget()).spent.today_usd, 0.02);
});
test('an output that is not an image fails the run', async () => {
  const run = await runOnce(await setup(waveSpeedFake({ outputBytes: Buffer.from('<html>not an image</html>') })));
  assert.equal(run.status, 'FAILED'); assert.equal(run.error_code, 'LAB_OUTPUT_INVALID');
});
test('invalid or oversized inputs are rejected before any paid call', async () => {
  const ctx = await setup(), input = { model_ref: ctx.model.id, prompt: 'p' };
  await assert.rejects(ctx.lab.createRuns([{ ...input, images: [{ bytes: Buffer.from('GIF89a-not-really'), role: 'template' }] }], admin, confirmed(0.02)), (e: LabError) => e.code === 'LAB_IMAGE_INVALID');
  const four = await Promise.all([1, 2, 3, 4].map(async () => ({ bytes: await png(), role: 'extra' as const })));
  await assert.rejects(ctx.lab.createRuns([{ ...input, images: four }], admin, confirmed(0.04)), (e: LabError) => e.code === 'LAB_INPUT_LIMIT');
  assert.equal(ctx.fake.calls.length, 0);
});
test('spending limits: per-request, daily and monthly are enforced; override needs a reason and is audited', async () => {
  const ctx = await setup();
  await ctx.lab.updateSettings({ per_request_usd: 0.01 }, admin);
  await assert.rejects(ctx.lab.createRuns([{ model_ref: ctx.model.id, prompt: 'p', images: await images() }], admin, confirmed(0.02)), (e: LabError) => e.code === 'LAB_BUDGET_EXCEEDED' && /per-request/.test(e.message));
  await assert.rejects(ctx.lab.createRuns([{ model_ref: ctx.model.id, prompt: 'p', images: await images() }], admin, confirmed(0.02, { override_reason: 'short' })), (e: LabError) => e.code === 'LAB_BUDGET_EXCEEDED');
  const ok = await runOnce(ctx, {}, confirmed(0.02, { override_reason: 'Benchmarking before vendor decision' }));
  assert.equal(ok.override!.actor, 'admin-1');
  assert.ok(ctx.audits.some(a => a.action === 'lab.budget_override')); assert.ok(ctx.audits.some(a => a.action === 'lab.paid_execution'));
  await ctx.lab.updateSettings({ per_request_usd: 1, daily_usd: 0.03 }, admin);
  await assert.rejects(ctx.lab.createRuns([{ model_ref: ctx.model.id, prompt: 'p', images: await images() }, { model_ref: ctx.model.id, prompt: 'p', images: await images() }], admin, confirmed(0.04)), (e: LabError) => /daily/.test(e.message));
  await ctx.lab.updateSettings({ daily_usd: 10, monthly_usd: 0.03 }, admin);
  await assert.rejects(ctx.lab.createRuns([{ model_ref: ctx.model.id, prompt: 'p', images: await images() }, { model_ref: ctx.model.id, prompt: 'p', images: await images() }], admin, confirmed(0.04)), (e: LabError) => /monthly/.test(e.message));
});
test('concurrent requests cannot jointly exceed the daily limit', async () => {
  const ctx = await setup(); await ctx.lab.updateSettings({ daily_usd: 0.05 }, admin);
  const attempts = await Promise.allSettled(Array.from({ length: 6 }, async () => (await ctx.lab.createRuns([{ model_ref: ctx.model.id, prompt: 'p', images: await images() }], admin, confirmed(0.02))).done));
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 2);
  assert.equal(attempts.filter(a => a.status === 'rejected').length, 4);
});
test('unknown pricing: requires acknowledgement, is labeled, and is rate-capped', async () => {
  const ctx = await setup();
  // Providers without a pricing API fall back to the Admin-configured schedule; with none configured the price is unknown.
  const compat = await ctx.lab.createProvider({ name: 'Compat', type: 'openai_compatible', base_url: 'https://api.example-ai.com/v1' }, admin);
  await ctx.lab.setCredential(compat.id, 'compat-key-1234567890', admin); await ctx.lab.updateProvider(compat.id, { enabled: true }, admin);
  const unpriced = await ctx.lab.saveModel(null, { provider_id: compat.id, model_id: 'other-model', display_name: 'Other', tasks: ['image-to-image'], max_reference_images: 2 }, admin);
  assert.equal(unpriced.pricing.method, 'unknown');
  const est = await ctx.lab.estimateFor({ model_ref: unpriced.id });
  assert.equal(est.estimate.known, false); assert.equal(est.estimate.usd, null);
  const input = { model_ref: unpriced.id, prompt: 'p', images: await images() };
  await assert.rejects(ctx.lab.createRuns([input], admin, confirmed(null)), (e: LabError) => e.code === 'LAB_UNKNOWN_COST_UNCONFIRMED');
  await ctx.lab.updateSettings({ max_unpriced_runs_per_day: 1 }, admin);
  const first = await ctx.lab.createRuns([input], admin, confirmed(null, { acknowledge_unknown_cost: true })); await first.done;
  assert.equal(first.runs[0]!.cost.estimated_usd, null); assert.match(first.runs[0]!.cost.basis, /pricing unknown/);
  await assert.rejects(ctx.lab.createRuns([input], admin, confirmed(null, { acknowledge_unknown_cost: true })), (e: LabError) => e.code === 'LAB_BUDGET_EXCEEDED');
});
test('IDR conversion uses the configured rate and flags a stale or missing rate', async () => {
  const ctx = await setup();
  let est = await ctx.lab.estimateFor({ model_ref: ctx.model.id });
  assert.equal(est.estimated_idr, null); assert.equal(est.fx.stale, true);
  await assert.rejects(ctx.lab.updateSettings({ fx_usd_to_idr: 16000 }, admin), (e: LabError) => e.code === 'LAB_FX_SOURCE_REQUIRED');
  await ctx.lab.updateSettings({ fx_usd_to_idr: 16000, fx_source: 'manual (BI)', fx_date: '2026-10-10T00:00:00Z' }, admin);
  est = await ctx.lab.estimateFor({ model_ref: ctx.model.id, count: 5 });
  assert.equal(est.estimate.usd, 0.1); assert.equal(est.estimated_idr, 1600); assert.equal(est.fx.stale, false);
  await ctx.lab.updateSettings({ fx_date: '2026-08-01T00:00:00Z' }, admin);
  assert.equal((await ctx.lab.estimateFor({ model_ref: ctx.model.id })).fx.stale, true);
});
test('comparison, ratings, cost per accepted image and candidate marking (record only)', async () => {
  const ctx = await setup(), prod = { AI_PROVIDER: process.env.AI_PROVIDER, NINEROUTER_API_KEY: process.env.NINEROUTER_API_KEY };
  const second = await ctx.lab.saveModel(null, { provider_id: ctx.provider.id, model_id: 'wavespeed-ai/qwen-image/edit', display_name: 'Qwen Edit', tasks: ['image-to-image'], max_reference_images: 2,
    pricing: { method: 'per_image', currency: 'USD', per_image_usd: 0.03, source: 'fixture', verified_at: null, assumptions: '' } }, admin);
  const imgs = await images();
  const created = await ctx.lab.createRuns([ctx.model.id, second.id].map(model_ref => ({ model_ref, prompt: 'same', images: imgs })), admin, confirmed(0.05));
  await created.done;
  const [a, b] = created.runs;
  await ctx.lab.rate(a!.id, { scores: { overall: 5, identity: 4 }, notes: 'good' }, admin);
  await ctx.lab.rate(b!.id, { scores: { overall: 2 } }, admin);
  await assert.rejects(ctx.lab.rate(a!.id, { scores: { overall: 9 } }, admin));
  const session = await ctx.lab.saveSession({ name: 'Round 1', run_ids: created.runs.map(r => r.id) }, admin);
  const full = await ctx.lab.getSession(session.id);
  assert.equal(full.runs.length, 2);
  const bench = new Map(full.benchmarks.map(x => [x.model_ref, x]));
  assert.equal(bench.get(ctx.model.id)!.cost_per_accepted_usd, 0.02); assert.equal(bench.get(second.id)!.cost_per_accepted_usd, null);
  const candidate = await ctx.lab.markCandidate({ model_ref: ctx.model.id, note: 'best identity' }, admin);
  assert.equal(candidate.production_activated, false); assert.ok(candidate.benchmark);
  assert.deepEqual({ AI_PROVIDER: process.env.AI_PROVIDER, NINEROUTER_API_KEY: process.env.NINEROUTER_API_KEY }, prod, 'production environment untouched');
});
test('analytics, percentiles and CSV export without secrets or sensitive data', async () => {
  const ctx = await setup(); await runOnce(ctx); await runOnce(ctx);
  const a = await ctx.lab.analytics({});
  assert.equal(a.totals.requests, 2); assert.equal(a.totals.succeeded, 2); assert.equal(a.totals.estimated_usd, 0.04); assert.equal(a.totals.provider_reported_usd, null);
  assert.ok(a.latency_ms.p50 !== null && a.latency_ms.p95 !== null); assert.equal(a.daily[0]!.runs, 2);
  assert.equal((await ctx.lab.analytics({ status: 'FAILED' })).totals.requests, 0);
  const csv = await ctx.lab.exportCsv({});
  assert.equal(csv.trim().split('\n').length, 3);
  for (const forbidden of [KEY, 'Put the person', 'pred-1', 'cdn.example.com', 'secret']) assert.ok(!csv.includes(forbidden), forbidden);
});
test('retention purge deletes image files but keeps metadata', async () => {
  let now = new Date('2026-10-12T10:00:00Z'); const ctx = await setup(waveSpeedFake(), () => now);
  const run = await runOnce(ctx); assert.ok((ctx.files as MemoryLabFiles).files.size > 0);
  now = new Date('2026-10-30T10:00:00Z'); assert.deepEqual(await ctx.lab.purgeExpired(), { purged: 1 });
  assert.equal((ctx.files as MemoryLabFiles).files.size, 0);
  const kept = await ctx.lab.getRun(run.id); assert.equal(kept.status, 'SUCCEEDED'); assert.equal(kept.output, null);
  await assert.rejects(ctx.lab.runFile(run.id, 'output'), (e: LabError) => e.status === 404);
});
test('WaveSpeed Test Connection: GET /balance, no generation, no duplicate /api/v3, balance shown', async () => {
  for (const base of [undefined, 'https://api.wavespeed.ai/api/v3', 'https://api.wavespeed.ai/api/v3/']) {
    const calls: HttpRequest[] = [];
    const ctx = await setup({ http: { async request(req: HttpRequest) { calls.push(req); return json({ code: 200, message: 'success', data: { balance: 50.25 } }); } } } as never);
    if (base) await ctx.lab.updateProvider(ctx.provider.id, { base_url: base }, admin);
    const r = await ctx.lab.testConnection(ctx.provider.id, admin);
    assert.equal(r.ok, true); assert.match(r.message, /Balance: \$50\.25/); assert.equal(r.provider.last_test_status, 'ok'); assert.ok(r.provider.last_success_at);
    assert.equal(calls.length, 1); assert.equal(calls[0]!.method, 'GET'); assert.equal(calls[0]!.url, 'https://api.wavespeed.ai/api/v3/balance');
    assert.equal(calls[0]!.body, undefined); assert.equal(calls[0]!.headers!.Authorization, `Bearer ${KEY}`);
  }
});
test('WaveSpeed Test Connection: provider errors are shown sanitized, never the key', async () => {
  const cases: [number, unknown, RegExp][] = [
    [400, { code: 400, message: `invalid request for key ${KEY}` }, /HTTP 400 — invalid request for key \[redacted\]/],
    [401, { code: 401, message: 'Invalid API key' }, /rejected the API key \(HTTP 401\) — Invalid API key/],
    [403, { code: 403, message: 'forbidden' }, /HTTP 403.*Owner, Admin, Developer or Billing/],
    [429, { message: 'slow down' }, /rate limit.*429.*slow down/],
    [500, { message: 'boom' }, /HTTP 500 — boom/],
    [502, '<html><body><h1>Bad gateway</h1></body></html>', /HTTP 502 — Bad gateway/],
    [200, { code: 401, message: 'Unauthorized' }, /code 401 — Unauthorized/],
  ];
  for (const [status, body, expected] of cases) {
    const ctx = await setup({ http: { async request() { return typeof body === 'string' ? { status, headers: {}, body: Buffer.from(body) } : json(body, status); } } } as never);
    const r = await ctx.lab.testConnection(ctx.provider.id, admin);
    assert.equal(r.ok, false, String(status)); assert.match(r.message, expected); assert.ok(!r.message.includes(KEY));
    assert.equal(r.provider.last_test_status, 'failed'); assert.equal(r.provider.last_test_message, r.message);
  }
});
test('WaveSpeed Test Connection: network failure is reported without leaking details; stored credential is kept', async () => {
  const ctx = await setup({ http: { async request() { throw new LabError(502, 'LAB_PROVIDER_UNREACHABLE', 'The provider could not be reached.'); } } } as never);
  const r = await ctx.lab.testConnection(ctx.provider.id, admin);
  assert.equal(r.ok, false); assert.match(r.message, /Could not reach WaveSpeed/);
  assert.equal((await ctx.lab.listProviders())[0]!.credential.configured, true);
});

// ---- HTTP layer: authorization and CSRF-relevant behaviour ------------------------------------------------------
function app(role: string | null) {
  const store = new MemoryLabStore(), lab = new LabService({ store, files: new MemoryLabFiles(), vault: new LabVault('lab-test-encryption-key-123'), adapters: ADAPTERS, audit: async () => undefined });
  const auth = { resolve: async (cookies: Record<string, unknown>) => { if (!cookies.s) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Admin sign-in required.'); return { actor_id: 'a', role: String(cookies.s) }; },
    requireRole: (p: { role: string }, role: string) => { if (p.role !== 'superadmin' && p.role !== role) throw new AppError(403, 'ADMIN_FORBIDDEN', 'no'); } };
  const a = express(); a.use(express.json()); a.use((req, _res, next) => { req.cookies = role ? { s: role } : {}; next(); });
  a.use('/lab', labRoutes(auth as never, lab, 1024 * 1024));
  a.use(((error: unknown, _req: express.Request, res: express.Response, _n: express.NextFunction) => { res.status(error instanceof AppError ? error.status : 500).json({ code: (error as AppError).code ?? 'ERR' }); }) as express.ErrorRequestHandler);
  return a;
}
test('every Lab endpoint rejects anonymous, operator and content_manager callers server-side', async () => {
  const routes: [string, string][] = [['get', '/lab/overview'], ['get', '/lab/providers'], ['post', '/lab/providers'], ['put', '/lab/providers/x/credential'], ['delete', '/lab/providers/x/credential'], ['post', '/lab/providers/x/test'],
    ['get', '/lab/models'], ['post', '/lab/models'], ['post', '/lab/estimate'], ['post', '/lab/runs'], ['post', '/lab/compare'], ['get', '/lab/runs'], ['get', '/lab/runs/x/image/output'], ['get', '/lab/analytics'], ['get', '/lab/export.csv'],
    ['get', '/lab/sessions'], ['get', '/lab/benchmarks'], ['post', '/lab/candidates'], ['put', '/lab/settings'], ['post', '/lab/purge'], ['post', '/lab/quote'], ['get', '/lab/report'], ['get', '/lab/report.csv'], ['post', '/lab/providers/x/seed-models'], ['post', '/lab/models/x/verification'], ['post', '/lab/runs/x/billing'], ['post', '/lab/runs/x/recheck'], ['post', '/lab/runs/x/resolve']];
  for (const role of [null, 'operator', 'content_manager']) for (const [method, path] of routes) {
    const res = await (request(app(role)) as unknown as Record<string, (p: string) => request.Test>)[method]!(path).send({});
    assert.ok([401, 403].includes(res.status), `${role} ${method} ${path} -> ${res.status}`);
  }
  assert.equal((await request(app('superadmin')).get('/lab/providers')).status, 200);
});
test('provider API responses never contain the credential', async () => {
  const a = app('superadmin');
  const created = await request(a).post('/lab/providers').send({ name: 'WaveSpeed', type: 'wavespeed' }).expect(201);
  const put = await request(a).put(`/lab/providers/${created.body.id}/credential`).send({ secret: KEY }).expect(200);
  assert.ok(!JSON.stringify(put.body).includes(KEY)); assert.equal(put.body.credential.masked, '••••••••7890');
  assert.ok(!JSON.stringify((await request(a).get('/lab/overview')).body).includes(KEY));
});

// ---- Production isolation ---------------------------------------------------------------------------------------
test('Lab code imports nothing from the production generation, credit, customer or provider pipeline', () => {
  const allowed = [/^\.\/[a-z-]+\.js$/, /^\.\.\/types\.js$/, /^\.\.\/crypto\.js$/, /^\.\/common\.js$/, /^\.\.\/services\/admin-auth\.service\.js$/, /^\.\.\/lib\/errors\.js$/];
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  for (const file of walk('src/lab').filter(f => f.endsWith('.ts'))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
      const spec = m[1]!; if (!spec.startsWith('.')) continue;
      assert.ok(allowed.some(r => r.test(spec)) || /^\.\.?\/(adapters\/)?[a-z-]+\.js$/.test(spec) && !/native-provider|ninerouter|generation|credit|customer|queue|provider-run/.test(spec), `${file} imports ${spec}`);
      assert.ok(!/native-provider|ninerouter|generation|credit|customer|queue|provider-run/.test(spec), `${file} imports ${spec}`);
    }
  }
});
test('Lab writes only to lab_docs and Lab storage; no production table is referenced', () => {
  const source = readdirSync('src/lab').filter(f => f.endsWith('.ts')).map(f => readFileSync(join('src/lab', f), 'utf8')).join('\n');
  const tables = [...source.matchAll(/(?:FROM|INTO|UPDATE|DELETE FROM)\s+([a-z_]+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(tables)], ['lab_docs']);
});
