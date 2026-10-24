import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { ADAPTERS } from '../src/lab/adapters/index.js';
import { WAVESPEED_CATALOG_IDS } from '../src/lab/catalog.js';
import { LabVault } from '../src/lab/crypto.js';
import { MemoryLabFiles } from '../src/lab/files.js';
import { LabService, type Actor, type RunInput } from '../src/lab/service.js';
import { MemoryLabStore } from '../src/lab/store.js';
import { LabError, type NxScenarioSource, type HttpRequest, type HttpResponse, type LabHttp } from '../src/lab/types.js';

const KEY = 'ws-live-SECRETKEY1234567890';
const admin: Actor = { actor_id: 'admin-1', role: 'superadmin' };
const png = (c = '#c44') => sharp({ create: { width: 128, height: 96, channels: 3, background: c } }).png().toBuffer();
const json = (body: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });
const NOW = new Date('2026-10-12T10:00:00Z');

// Scripted WaveSpeed. Every request is recorded; nothing touches the network.
function wave() {
  const calls: HttpRequest[] = [];
  const state = {
    price: { price: 0.02, discounted: 0.016, rate: 80 }, base: { price: 0.02, discounted: 0.016, rate: 80 }, priceError: null as null | { status: number; code: number },
    submit: 'ok' as 'ok' | 'throw' | 'http500' | 'noid' | 'http400', results: ['processing', 'completed'] as string[], resultFail: 0,
    billing: 'items' as 'items' | 'empty' | 'denied' | 'error', billItems: [] as any[], billCalls: [] as any[],
  };
  const http: LabHttp = { async request(req) {
    calls.push(req);
    const url = new URL(req.url), body = req.body && typeof req.body === 'string' ? JSON.parse(req.body) : null;
    if (url.pathname === '/api/v3/model/price') {
      if (state.priceError) return json({ code: state.priceError.code, message: 'Failed to retrieve model pricing.' }, state.priceError.status);
      const p = body.inputs ? state.price : state.base;
      return json({ code: 200, message: 'success', data: { model_id: body.model_id, price: p.price, discounted_price: p.discounted, discount_rate: p.rate, currency: 'USD' } });
    }
    if (url.pathname === '/api/v3/media/uploads') return json({ code: 200, data: { upload: { method: 'PUT', url: 'https://uploads.example.com/p', headers: {} }, download_url: `https://cdn.example.com/in/${calls.length}.png` } });
    if (req.method === 'PUT') return { status: 200, headers: {}, body: Buffer.alloc(0) };
    if (url.pathname === '/api/v3/billings/search') {
      state.billCalls.push(body);
      if (state.billing === 'denied') return json({ code: 403, message: 'Developer keys cannot use this endpoint' }, 403);
      if (state.billing === 'error') return json({ message: 'oops' }, 500);
      return json({ code: 200, data: { page: 1, has_more: false, items: state.billing === 'empty' ? [] : state.billItems } });
    }
    if (/\/predictions\/[^/]+\/result$/.test(url.pathname)) {
      if (state.resultFail > 0) { state.resultFail--; return json({ message: 'unavailable' }, 500); }
      const status = state.results.shift() ?? 'completed';
      return json({ code: 200, data: { id: url.pathname.split('/')[4], status, outputs: status === 'completed' ? ['https://cdn.example.com/out/1.png'] : [], timings: { inference: 2500 } } });
    }
    if (url.pathname === '/out/1.png') return { status: 200, headers: {}, body: await png('#2a6') };
    if (url.pathname.startsWith('/api/v3/') && req.method === 'POST') {
      if (state.submit === 'throw') throw new Error(`socket hang up ${KEY}`);
      if (state.submit === 'http500') return json({ message: 'bad gateway' }, 502);
      if (state.submit === 'http400') return json({ code: 400, message: 'invalid input' }, 400);
      return json({ code: 200, data: state.submit === 'noid' ? { status: 'created' } : { id: 'pred-1', status: 'created', outputs: [] } });
    }
    return json({}, 404);
  } };
  return { http, calls, state, submits: () => calls.filter(c => c.method === 'POST' && !/model\/price|media\/uploads|billings/.test(c.url)) };
}
async function setup(opts: { now?: () => Date; scenarios?: NxScenarioSource } = {}) {
  const fake = wave(), audits: { action: string; meta?: unknown }[] = [];
  const lab = new LabService({ store: new MemoryLabStore(), files: new MemoryLabFiles(), vault: new LabVault('lab-test-encryption-key-123'), adapters: ADAPTERS, http: () => fake.http, ...(opts.scenarios ? { scenarios: opts.scenarios } : {}),
    now: opts.now ?? (() => NOW), sleep: async () => undefined, audit: async (_a, action, _t, _i, _r, meta) => { audits.push({ action, meta }); } });
  const provider = await lab.createProvider({ name: 'WaveSpeed', type: 'wavespeed' }, admin);
  await lab.setCredential(provider.id, KEY, admin); await lab.updateProvider(provider.id, { enabled: true }, admin);
  const seeded = await lab.seedWavespeedModels(provider.id, admin), by = (id: string) => seeded.models.find(m => m.model_id === id)!;
  await lab.updateSettings({ enforce_sequence: false }, admin);
  return { lab, fake, provider, audits, by };
}
const zImage = (ctx: Awaited<ReturnType<typeof setup>>, extra: Partial<RunInput> = {}): RunInput => ({ model_ref: ctx.by('wavespeed-ai/z-image/turbo').id, prompt: 'A red fox in snow', images: [], ...extra });
const confirm = (usd: number) => ({ confirm: true, total_usd: usd });
async function runZ(ctx: Awaited<ReturnType<typeof setup>>, usd = 0.016, extra: Partial<RunInput> = {}) {
  const created = await ctx.lab.createRuns([zImage(ctx, extra)], admin, confirm(usd)); await created.done; return ctx.lab.getRun(created.runs[0]!.id);
}

test('Phase 1: all candidate and edit models register without contacting the provider, with verified schemas', async () => {
  const ctx = await setup();
  assert.equal(ctx.fake.calls.length, 0, 'registration makes no provider request');
  assert.equal((await ctx.lab.listModels()).length, 44);
  assert.deepEqual(WAVESPEED_CATALOG_IDS.slice(0, 8), ['wavespeed-ai/z-image/turbo', 'openai/gpt-image-2.5-flare/text-to-image', 'openai/gpt-image-2/text-to-image', 'bytedance/seedream-v5.0-flash',
    'alibaba/qwen-image-3.0/text-to-image', 'bytedance/seedream-v5.0-pro', 'google/nano-banana-2/text-to-image', 'google/nano-banana-pro/text-to-image']);
  for (const id of WAVESPEED_CATALOG_IDS.slice(0, 8)) { const m = ctx.by(id); assert.deepEqual(m.tasks, ['text-to-image'], id); assert.equal(m.max_reference_images, 0, id); assert.ok(m.sequence && m.sequence <= 8); }
  for (const id of ['bytedance/seedream-v5.0-flash/edit', 'bytedance/seedream-v5.0-pro/edit', 'google/nano-banana-2/edit', 'openai/gpt-image-2.5-flare/edit', 'wavespeed-ai/qwen-image/edit-plus', 'openai/gpt-image-2/edit', 'google/nano-banana-pro/edit', 'alibaba/qwen-image-3.0/edit', 'openai/gpt-image-2.5-sunburst/edit']) {
    const m = ctx.by(id); assert.ok(m.tasks.includes('image-to-image'), id); assert.ok(!m.tasks.includes('text-to-image'), id); assert.equal(m.sequence, null);
  }
  const names = (id: string) => ctx.by(id).params!.map(p => p.name);
  assert.deepEqual(names('wavespeed-ai/z-image/turbo'), ['size', 'seed', 'output_format']);
  assert.deepEqual(ctx.by('openai/gpt-image-2.5-flare/text-to-image').params!.find(p => p.name === 'quality')!.values, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(ctx.by('openai/gpt-image-2/text-to-image').params!.find(p => p.name === 'quality')!.values, ['low', 'medium', 'high']);
  assert.equal(ctx.by('alibaba/qwen-image-3.0/text-to-image').prompt_max, 800);
  assert.deepEqual(ctx.by('google/nano-banana-2/text-to-image').params!.find(p => p.name === 'resolution')!.values, ['0.5k', '1k', '2k', '4k']);
  assert.equal(ctx.by('openai/gpt-image-2.5-sunburst/text-to-image').sequence, null); assert.deepEqual(ctx.by('openai/gpt-image-2.5-sunburst/text-to-image').tasks, ['text-to-image']);
  assert.equal(ctx.by('google/nano-banana-2/edit').max_reference_images, 14); assert.equal(ctx.by('bytedance/seedream-v5.0-pro/edit').max_reference_images, 10); assert.equal(ctx.by('wavespeed-ai/qwen-image/edit-plus').max_reference_images, 3);
  for (const m of await ctx.lab.listModels()) { assert.ok(!m.params!.some(p => /sync|base64/.test(p.name))); assert.equal(m.pricing.method, 'provider_quote'); assert.ok(m.schema_source!.endsWith('/llms.txt')); }
  assert.deepEqual((await ctx.lab.seedWavespeedModels(ctx.provider.id, admin)).created, 0, 'idempotent');
});
test('Phase 2: quotation uses POST /model/price with the full inputs and shows original, discounted and discount', async () => {
  const ctx = await setup(), q = await ctx.lab.quoteRun(zImage(ctx, { params: { size: '1024*1024', seed: -1, output_format: 'png' } }));
  assert.equal(q.available, true); assert.equal(q.source, 'provider');
  assert.deepEqual([q.quote!.original_usd, q.quote!.discounted_usd, q.quote!.payable_percent, q.quote!.effective_discount_percent, q.quote!.currency], [0.02, 0.016, 80, 20, 'USD']);
  assert.ok(q.quote!.quoted_at); assert.deepEqual(q.quote!.params, { size: '1024*1024', seed: -1, output_format: 'png' });
  const priced = ctx.fake.calls.filter(c => c.url.endsWith('/model/price')), full = JSON.parse(String(priced[0]!.body));
  assert.equal(full.model_id, 'wavespeed-ai/z-image/turbo'); assert.deepEqual(full.inputs, { prompt: 'A red fox in snow', size: '1024*1024', seed: -1, output_format: 'png' });
  assert.equal(JSON.parse(String(priced[1]!.body)).inputs, undefined, 'base price is a separate comparison query');
  assert.deepEqual(q.comparison_to_base, { base_discounted_usd: 0.016, difference_usd: 0, equal: true });
  assert.equal(ctx.fake.submits().length, 0, 'quoting never submits a generation');
  ctx.fake.state.price = { price: 0.03, discounted: 0.03, rate: 100 };
  assert.equal((await ctx.lab.quoteRun(zImage(ctx, { params: { size: '1536*1536' } }))).usd, 0.03, 'recalculated when inputs change');
  assert.equal(q.idr, null, 'IDR hidden until a rate is configured');
  await ctx.lab.updateSettings({ fx_usd_to_idr: 16000, fx_source: 'manual', fx_date: NOW.toISOString() }, admin);
  assert.equal((await ctx.lab.quoteRun(zImage(ctx))).idr, 480);
});
test('Phase 2: a failed quotation is Pricing Unavailable, never a base-price substitute, and blocks the paid request', async () => {
  const ctx = await setup(); ctx.fake.state.priceError = { status: 400, code: 4005 };
  const q = await ctx.lab.quoteRun(zImage(ctx));
  assert.equal(q.available, false); assert.equal(q.usd, null); assert.equal(q.unavailable, true); assert.match(q.reason!, /code 4005.*Failed to retrieve model pricing/);
  await assert.rejects(ctx.lab.createRuns([zImage(ctx)], admin, { confirm: true, total_usd: 0.02, acknowledge_unknown_cost: true }), (e: LabError) => e.code === 'LAB_PRICING_UNAVAILABLE');
  assert.equal(ctx.fake.submits().length, 0); assert.equal((await ctx.lab.listRuns({})).length, 0);
});
test('confirmation must match the freshly re-quoted price', async () => {
  const ctx = await setup();
  await assert.rejects(ctx.lab.createRuns([zImage(ctx)], admin, { total_usd: 0.016 }), (e: LabError) => e.code === 'LAB_CONFIRMATION_REQUIRED');
  await assert.rejects(ctx.lab.createRuns([zImage(ctx)], admin, confirm(0.01)), (e: LabError) => e.code === 'LAB_ESTIMATE_CHANGED');
  assert.equal(ctx.fake.submits().length, 0);
});
test('edit models quote and run with the same uploaded images (single upload per file)', async () => {
  const ctx = await setup(), input: RunInput = { model_ref: ctx.by('wavespeed-ai/qwen-image/edit-plus').id, prompt: 'swap face', images: [{ bytes: await png('#111'), role: 'template' }, { bytes: await png('#222'), role: 'reference' }] };
  const q = await ctx.lab.quoteRun(input); assert.equal(q.images, 2);
  const priced = JSON.parse(String(ctx.fake.calls.find(c => c.url.endsWith('/model/price'))!.body)); assert.equal(priced.inputs.images.length, 2);
  const created = await ctx.lab.createRuns([input], admin, confirm(0.016)); await created.done;
  assert.equal(ctx.fake.calls.filter(c => c.url.endsWith('/media/uploads')).length, 2, 'quote and run share the cached uploads');
  assert.equal(JSON.parse(String(ctx.fake.submits()[0]!.body)).images.length, 2);
});
test('Phase 4: generation is submitted once, the prediction id is stored, quote and tokens are recorded', async () => {
  const ctx = await setup(), run = await runZ(ctx, 0.016, { params: { size: '1024*1024', seed: 7 } });
  assert.equal(run.status, 'SUCCEEDED'); assert.equal(run.provider_request_id, 'pred-1'); assert.equal(ctx.fake.submits().length, 1);
  const sent = JSON.parse(String(ctx.fake.submits()[0]!.body));
  assert.deepEqual(sent, { prompt: 'A red fox in snow', size: '1024*1024', seed: 7, enable_base64_output: false, enable_sync_mode: false });
  assert.equal(ctx.fake.submits()[0]!.headers!.Authorization, `Bearer ${KEY}`);
  assert.deepEqual([run.quote!.original_usd, run.quote!.discounted_usd, run.quote!.effective_discount_percent, run.quote!.source], [0.02, 0.016, 20, 'provider']);
  assert.deepEqual(run.tokens, { availability: 'not_reported', source: null, input: null, output: null, total: null });
  assert.equal(run.duration_ms, 2500);
  assert.ok(ctx.fake.calls.filter(c => c.url.endsWith('/result')).length >= 2, 'polls the supported result endpoint');
});
test('the prediction id is saved before polling, and result polling retries transient failures only', async () => {
  const ok = await setup(); ok.fake.state.resultFail = 2;
  assert.equal((await runZ(ok)).status, 'SUCCEEDED'); assert.equal(ok.fake.submits().length, 1);
  const bad = await setup(); bad.fake.state.resultFail = 99;
  const run = await runZ(bad);
  assert.equal(run.status, 'FAILED'); assert.equal(run.provider_request_id, 'pred-1', 'id kept so billing and results can still be looked up'); assert.equal(bad.fake.submits().length, 1, 'generation POST never repeated');
});
test('ambiguous submissions are never retried, hold their budget and can be resolved', async () => {
  for (const mode of ['throw', 'http500', 'noid'] as const) {
    const ctx = await setup(); ctx.fake.state.submit = mode;
    const run = await runZ(ctx);
    assert.equal(run.status, 'AMBIGUOUS', mode); assert.equal(run.error_code, 'LAB_SUBMIT_AMBIGUOUS'); assert.equal(ctx.fake.submits().length, 1, `${mode}: no retry`); assert.ok(!run.error_message!.includes(KEY));
    assert.equal((await ctx.lab.budget()).spent.today_usd, 0.016, 'ambiguous run keeps its reservation');
    if (mode === 'throw') {
      await assert.rejects(ctx.lab.resolveAmbiguous(run.id, { outcome: 'not_billed', reason: 'short' }, admin));
      const resolved = await ctx.lab.resolveAmbiguous(run.id, { outcome: 'not_billed', reason: 'Dashboard shows no charge' }, admin);
      assert.equal(resolved.status, 'FAILED'); assert.equal((await ctx.lab.budget()).spent.today_usd, 0); assert.ok(ctx.audits.some(a => a.action === 'lab.ambiguous_resolve'));
    }
  }
  const definitive = await setup(); definitive.fake.state.submit = 'http400';
  assert.equal((await runZ(definitive)).status, 'FAILED', 'a 4xx rejection is definitive, not ambiguous');
});
test('an ambiguous submission is matched through the billing window, then its result is fetched without resubmitting', async () => {
  const ctx = await setup(); ctx.fake.state.submit = 'throw';
  const run = await runZ(ctx); assert.equal(run.status, 'AMBIGUOUS');
  ctx.fake.state.billItems = [{ uuid: 'b1', billing_type: 'deduct', price: 0.016, created_at: NOW.toISOString(), prediction: { uuid: 'predX', model_uuid: 'wavespeed-ai/z-image/turbo', status: 'completed' } }];
  const linked = await ctx.lab.reconcileBilling(run.id, admin);
  assert.equal(linked.provider_request_id, 'predX'); assert.equal(linked.billing!.status, 'confirmed'); assert.equal(ctx.fake.state.billCalls.at(-1).model_uuid, 'wavespeed-ai/z-image/turbo');
  ctx.fake.state.results = ['completed'];
  const recovered = await ctx.lab.recheckResult(run.id, admin);
  assert.equal(recovered.status, 'SUCCEEDED'); assert.ok(recovered.output); assert.equal(ctx.fake.submits().length, 1);
});
test('Phase 4: billing reconciliation - confirmed, pending, delayed, denied, duplicates, refunds, review', async () => {
  const item = (uuid: string, type: string, price: number) => ({ uuid, billing_type: type, price, created_at: NOW.toISOString(), prediction: { uuid: 'pred-1', model_uuid: 'wavespeed-ai/z-image/turbo' } });
  const ctx = await setup(); let run = await runZ(ctx);
  assert.equal((await ctx.lab.runView(run.id)).cost_status, 'Pending Billing');
  ctx.fake.state.billing = 'empty'; let v = await ctx.lab.reconcileBilling(run.id, admin);
  assert.equal(v.billing!.status, 'pending'); assert.equal(v.cost_status, 'Pending Billing');
  assert.deepEqual(ctx.fake.state.billCalls.at(-1), { prediction_uuids: ['pred-1'], page: 1, page_size: 10 });
  ctx.fake.state.billing = 'items'; ctx.fake.state.billItems = [item('b1', 'deduct', 0.016), item('b1', 'deduct', 0.016)]; // duplicate response
  v = await ctx.lab.reconcileBilling(run.id, admin);
  assert.equal(v.billing!.status, 'confirmed'); assert.equal(v.billing!.confirmed_usd, 0.016); assert.equal(v.billing!.records.length, 1); assert.equal(v.cost_status, 'Confirmed'); assert.equal(v.cost_difference_usd, 0);
  assert.equal(v.effective_cost_usd, 0.016); assert.equal((await ctx.lab.budget()).spent.today_usd, 0.016);
  ctx.fake.state.billItems = [item('b1', 'deduct', 0.02)]; v = await ctx.lab.reconcileBilling(run.id, admin);
  assert.equal(v.cost_difference_usd, 0.004, 'billed more than quoted'); assert.equal((await ctx.lab.budget()).spent.today_usd, 0.02, 'budget follows the confirmed charge');
  ctx.fake.state.billItems = [item('b1', 'deduct', 0.016), item('b2', 'refund', 0.016)]; v = await ctx.lab.reconcileBilling(run.id, admin);
  assert.deepEqual([v.billing!.status, v.billing!.confirmed_usd], ['adjusted', 0]);
  ctx.fake.state.billItems = [item('b1', 'deduct', 0.016), item('b2', 'deduct', 0.016)]; v = await ctx.lab.reconcileBilling(run.id, admin);
  assert.equal(v.billing!.status, 'review'); assert.equal(v.billing!.confirmed_usd, null); assert.equal(v.billing!.net_known_usd, 0.032); assert.equal(v.cost_status, 'Review');
  ctx.fake.state.billItems = [item('b1', 'deduct', 0.016), item('b3', 'promo_credit', 0.01)]; v = await ctx.lab.reconcileBilling(run.id, admin);
  assert.equal(v.billing!.status, 'review'); assert.match(v.billing!.message, /promo_credit/);
  ctx.fake.state.billing = 'denied'; v = await ctx.lab.reconcileBilling(run.id, admin);
  assert.equal(v.billing!.status, 'access_denied'); assert.match(v.billing!.message, /Owner, Admin or Billing/); assert.equal(v.cost_status, 'Unavailable');
  ctx.fake.state.billing = 'error'; v = await ctx.lab.reconcileBilling(run.id, admin); assert.equal(v.billing!.status, 'error');
  assert.ok(!JSON.stringify(v).includes(KEY));
  let t = NOW.getTime(); const late = await setup({ now: () => new Date(t) }); const lateRun = await runZ(late); late.fake.state.billing = 'empty';
  t += 25 * 3600 * 1000; assert.equal((await late.lab.reconcileBilling(lateRun.id, admin)).billing!.status, 'not_found');
});
test('billing lookup is skipped for providers without it and rejected for runs without a prediction', async () => {
  const ctx = await setup(); ctx.fake.state.priceError = null;
  ctx.fake.state.submit = 'http400'; const failed = await runZ(ctx);
  await assert.rejects(ctx.lab.reconcileBilling(failed.id, admin), (e: LabError) => e.code === 'LAB_NO_PREDICTION');
});
test('Phase 6: per-test ceiling, daily budget, one active generation, and batch off by default', async () => {
  const ctx = await setup(); await ctx.lab.updateSettings({ per_request_usd: 0.15, daily_usd: 1, max_active_runs: 1, max_runs_per_request: 1 }, admin);
  assert.deepEqual([(await ctx.lab.settings()).per_request_usd, (await ctx.lab.settings()).daily_usd], [0.15, 1]);
  ctx.fake.state.price = { price: 0.2, discounted: 0.2, rate: 100 };
  await assert.rejects(ctx.lab.createRuns([zImage(ctx)], admin, confirm(0.2)), (e: LabError) => e.code === 'LAB_BUDGET_EXCEEDED' && /per-request/.test(e.message));
  ctx.fake.state.price = { price: 0.016, discounted: 0.016, rate: 100 };
  await assert.rejects(ctx.lab.createRuns([zImage(ctx), zImage(ctx)], admin, confirm(0.032)), (e: LabError) => e.code === 'LAB_BATCH_DISABLED');
  // two simultaneous submissions: only one may be active
  ctx.fake.state.results = Array(5).fill('processing'); (ctx.lab as any).d.pollIntervalMs = 1;
  const settled = await Promise.allSettled([ctx.lab.createRuns([zImage(ctx)], admin, confirm(0.016)), ctx.lab.createRuns([zImage(ctx)], admin, confirm(0.016))]);
  assert.equal(settled.filter(r => r.status === 'fulfilled').length, 1); assert.ok(settled.some(r => r.status === 'rejected' && (r.reason as LabError).code === 'LAB_BUSY'));
  for (const r of settled) if (r.status === 'fulfilled') await r.value.done;
  // daily budget: 0.016 spent; a larger request over the remainder is refused even when concurrent
  await ctx.lab.updateSettings({ daily_usd: 0.02 }, admin);
  await assert.rejects(ctx.lab.createRuns([zImage(ctx)], admin, confirm(0.016)), (e: LabError) => /daily/.test(e.message));
});
test('Phase 7: models run strictly one by one; verified needs a confirmed billing record; blocked also unlocks the next', async () => {
  const ctx = await setup(); await ctx.lab.updateSettings({ enforce_sequence: true }, admin);
  const second: RunInput = { model_ref: ctx.by('openai/gpt-image-2.5-flare/text-to-image').id, prompt: 'p', images: [] };
  await assert.rejects(ctx.lab.createRuns([second], admin, confirm(0.016)), (e: LabError) => e.code === 'LAB_SEQUENCE_BLOCKED' && /Z-Image Turbo/.test(e.message));
  assert.match((await ctx.lab.quoteRun(second)).blocked_reason!, /Z-Image Turbo/);
  // registrations are unaffected
  assert.equal((await ctx.lab.listModels()).length, 44);
  const run = await runZ(ctx);
  await assert.rejects(ctx.lab.setVerification(ctx.by('wavespeed-ai/z-image/turbo').id, { status: 'verified', run_id: run.id }, admin), (e: LabError) => e.code === 'LAB_VERIFY_NEEDS_BILLING');
  ctx.fake.state.billItems = [{ uuid: 'b1', billing_type: 'deduct', price: 0.016, created_at: NOW.toISOString(), prediction: { uuid: 'pred-1', model_uuid: 'wavespeed-ai/z-image/turbo' } }];
  await ctx.lab.reconcileBilling(run.id, admin);
  const verified = await ctx.lab.setVerification(ctx.by('wavespeed-ai/z-image/turbo').id, { status: 'verified', run_id: run.id, note: 'ok' }, admin);
  assert.deepEqual([verified.verification!.status, verified.verification!.difference_usd, verified.verification!.run_id], ['verified', 0, run.id]);
  assert.equal((await ctx.lab.quoteRun(second)).blocked_reason, null);
  await assert.rejects(ctx.lab.setVerification(ctx.by('openai/gpt-image-2.5-flare/text-to-image').id, { status: 'blocked', note: '' }, admin));
  await ctx.lab.setVerification(ctx.by('openai/gpt-image-2.5-flare/text-to-image').id, { status: 'blocked', note: 'model not enabled on this account' }, admin);
  assert.equal((await ctx.lab.quoteRun({ model_ref: ctx.by('openai/gpt-image-2/text-to-image').id, prompt: 'p', images: [] })).blocked_reason, null, 'a blocked model does not stall the queue');
});
test('prompt limits and parameter schemas are enforced per model; unsupported parameters are never sent', async () => {
  const ctx = await setup(), qwen = ctx.by('alibaba/qwen-image-3.0/text-to-image').id;
  await assert.rejects(ctx.lab.quoteRun({ model_ref: qwen, prompt: 'x'.repeat(801), images: [] }), (e: LabError) => e.code === 'LAB_PROMPT_TOO_LONG');
  const q = await ctx.lab.quoteRun({ model_ref: qwen, prompt: 'ok', images: [], params: { resolution: '4k', aspect_ratio: '16:9', quality: 'high', enable_prompt_expansion: true, seed: 5, output_format: 'png' } });
  assert.deepEqual(q.params_sent, { aspect_ratio: '16:9', enable_prompt_expansion: true, seed: 5 }); assert.deepEqual(q.ignored.sort(), ['output_format', 'quality', 'resolution']);
  await assert.rejects(ctx.lab.quoteRun({ model_ref: ctx.by('wavespeed-ai/z-image/turbo').id, prompt: 'p', images: [{ bytes: await png(), role: 'template' }] }), (e: LabError) => e.code === 'LAB_INPUT_UNSUPPORTED');
  const z = await ctx.lab.quoteRun(zImage(ctx, { params: { size: '4000*4000' } })); assert.deepEqual(z.params_sent, {}); assert.deepEqual(z.ignored, ['size']);
});
test('Phase 3: tokens are shown only when the provider reports them', async () => {
  const ctx = await setup(), run = await runZ(ctx);
  assert.equal(run.tokens!.availability, 'not_reported'); assert.equal(run.tokens!.total, null);
  const run2 = await ctx.lab.getRun(run.id); (run2 as any).usage = { input_tokens: 10, output_tokens: 20, total_tokens: 30 };
  assert.deepEqual((ctx.lab as any).tokensOf(run2.usage), { availability: 'reported', source: 'provider response usage', input: 10, output: 20, total: 30 });
  assert.equal((ctx.lab as any).tokensOf({}).availability, 'not_reported');
});
test('Phase 8: report shows estimated vs confirmed cost, N/A tokens, latency, ratings and cost per accepted image; CSV export', async () => {
  const ctx = await setup(); const run = await runZ(ctx);
  ctx.fake.state.billItems = [{ uuid: 'b1', billing_type: 'deduct', price: 0.02, created_at: NOW.toISOString(), prediction: { uuid: 'pred-1', model_uuid: 'wavespeed-ai/z-image/turbo' } }];
  await ctx.lab.reconcileBilling(run.id, admin); await ctx.lab.rate(run.id, { scores: { overall: 5 } }, admin);
  const row = (await ctx.lab.report()).rows.find(r => r.model_id === 'wavespeed-ai/z-image/turbo')!;
  assert.deepEqual([row.runs, row.succeeded, row.avg_estimated_usd, row.avg_confirmed_usd, row.avg_cost_difference_usd, row.accepted, row.cost_per_accepted_usd, row.avg_latency_ms], [1, 1, 0.016, 0.02, 0.004, 1, 0.02, 2500]);
  assert.equal(row.tokens.total, null);
  const csv = await ctx.lab.reportCsv(); const line = csv.split('\n').find(l => l.startsWith('Z-Image Turbo'))!;
  assert.match(line, /N\/A/); assert.ok(!csv.includes(KEY) && !csv.includes('red fox') && !csv.includes('pred-1'));
  assert.match(await ctx.lab.exportCsv({}), /confirmed_usd,billing_status,tokens_total/);
});

test('NXBooth Basic/Advanced: pick template + model; only image-editing models can run it, with the production canvas ratio', async () => {
  const basic = { async catalog() { return { basic: [], advanced: { experiences: [], frame_styles: [] } }; },
    async plan(sel: any) {
      const advanced = sel.kind === 'advanced';
      return { kind: sel.kind, label: advanced ? 'Advanced · Space + Gold' : 'Basic · Royal', production_model: null, meta: {}, prompt: 'PRODUCTION PROMPT', production_size: advanced ? { width: 1024, height: 1024 } : { width: 1024, height: 1536 },
        images: advanced ? [{ bytes: await png('#456'), role: 'reference' as const }] : [{ bytes: await png('#123'), role: 'template' as const }, { bytes: await png('#456'), role: 'reference' as const }] };
    } } as NxScenarioSource;
  const ctx = await setup({ scenarios: basic }), face = await png('#999');
  const plan = await ctx.lab.planScenario({ kind: 'basic', template_id: 't' }, face);
  const edit = ctx.by('bytedance/seedream-v5.0-flash/edit').id;
  const q = await ctx.lab.quoteRun({ model_ref: edit, prompt: plan.prompt, scenario: plan, images: plan.images });
  assert.equal(q.available, true); assert.deepEqual(q.params_sent, { aspect_ratio: '2:3' }); assert.equal(q.images, 2);
  const priced = JSON.parse(String(ctx.fake.calls.find(c => c.url.endsWith('/model/price'))!.body)); assert.equal(priced.inputs.prompt, 'PRODUCTION PROMPT'); assert.equal(priced.inputs.images.length, 2);
  const created = await ctx.lab.createRuns([{ model_ref: edit, prompt: plan.prompt, scenario: plan, images: plan.images }], admin, confirm(0.016)); await created.done;
  const run = await ctx.lab.getRun(created.runs[0]!.id), sent = JSON.parse(String(ctx.fake.submits()[0]!.body));
  assert.equal(run.status, 'SUCCEEDED'); assert.deepEqual(run.inputs.map(i => i.slot), ['template', 'reference']); assert.equal(sent.aspect_ratio, '2:3'); assert.equal(sent.prompt, 'PRODUCTION PROMPT');
  // Advanced: face only, square request (production post-processes it into the print master)
  const adv = await ctx.lab.planScenario({ kind: 'advanced', experience_id: 'e', frame_style_id: 'f' }, face);
  assert.deepEqual((await ctx.lab.quoteRun({ model_ref: edit, prompt: adv.prompt, scenario: adv, images: adv.images })).params_sent, { aspect_ratio: '1:1' });
  // Text-to-image models cannot take a face/template photo, so they cannot run Basic or Advanced
  for (const id of ['wavespeed-ai/z-image/turbo', 'bytedance/seedream-v5.0-flash', 'google/nano-banana-2/text-to-image'])
    await assert.rejects(ctx.lab.quoteRun({ model_ref: ctx.by(id).id, prompt: plan.prompt, scenario: plan, images: plan.images }), (e: LabError) => e.code === 'LAB_INPUT_UNSUPPORTED', id);
  // gpt-image-2.5-flare/edit is the closest WaveSpeed model to production's gpt-image-2.5: it must accept the same template + face request
  const flare = await ctx.lab.quoteRun({ model_ref: ctx.by('openai/gpt-image-2.5-flare/edit').id, prompt: plan.prompt, scenario: plan, images: plan.images });
  assert.equal(flare.available, true); assert.equal(flare.images, 2); assert.deepEqual(flare.params_sent, { aspect_ratio: '2:3' });
  const sunburst = await ctx.lab.quoteRun({ model_ref: ctx.by('openai/gpt-image-2.5-sunburst/edit').id, prompt: plan.prompt, scenario: plan, images: plan.images });
  assert.equal(sunburst.available, true); assert.equal(ctx.by('openai/gpt-image-2.5-sunburst/edit').max_reference_images, 16);
  assert.equal((await ctx.lab.quoteRun({ model_ref: ctx.by('openai/gpt-image-2.5-flare/edit').id, prompt: adv.prompt, scenario: adv, images: adv.images })).available, true);
});

test('Qwen Image 3.0 edit refuses scenario prompts longer than its 800-character limit instead of truncating them', async () => {
  const ctx = await setup({ scenarios: { async catalog() { return { basic: [], advanced: { experiences: [], frame_styles: [] } }; },
    async plan() { return { kind: 'basic' as const, label: 'Basic', production_model: null, meta: {}, prompt: 'P'.repeat(4000), production_size: { width: 1024, height: 1536 }, images: [{ bytes: await png(), role: 'template' as const }, { bytes: await png(), role: 'reference' as const }] }; } } as NxScenarioSource });
  const plan = await ctx.lab.planScenario({ kind: 'basic', template_id: 't' }, await png());
  await assert.rejects(ctx.lab.quoteRun({ model_ref: ctx.by('alibaba/qwen-image-3.0/edit').id, prompt: plan.prompt, scenario: plan, images: plan.images }), (e: LabError) => e.code === 'LAB_PROMPT_TOO_LONG');
});

test('re-registering refreshes models created from an older catalog and keeps verification, enabled and status', async () => {
  const ctx = await setup(), flare = ctx.by('openai/gpt-image-2.5-flare/edit');
  const store = (ctx.lab as any).d.store;
  await store.put('model', flare.id, { ...flare, max_reference_images: 1, catalog_version: undefined, enabled: false, status: 'ok', verification: { status: 'blocked', note: 'kept', run_id: null, difference_usd: null, at: null, by: null } });
  const result = await ctx.lab.seedWavespeedModels(ctx.provider.id, admin);
  assert.deepEqual([result.created, result.updated], [0, ['openai/gpt-image-2.5-flare/edit']]);
  const after = result.models.find(m => m.id === flare.id)!;
  assert.equal(after.max_reference_images, 16); assert.equal(after.catalog_version, 5); assert.equal(after.enabled, false); assert.equal(after.status, 'ok'); assert.equal(after.verification!.note, 'kept');
  assert.deepEqual((await ctx.lab.seedWavespeedModels(ctx.provider.id, admin)).updated, [], 'only once per catalog version');
});

test('every catalog model has a verified schema: unique ids, doc links, consistent task/image settings', async () => {
  const ctx = await setup(), models = await ctx.lab.listModels();
  assert.equal(new Set(models.map(m => m.model_id)).size, models.length);
  for (const m of models) {
    assert.ok(m.schema_source!.endsWith(`${m.model_id}/llms.txt`), m.model_id); assert.ok(m.params!.length > 0, m.model_id);
    if (m.tasks.includes('text-to-image')) { assert.deepEqual(m.tasks, ['text-to-image']); assert.equal(m.max_reference_images, 0); } else assert.ok(m.max_reference_images >= 1, m.model_id);
    for (const p of m.params!) if (p.type === 'enum') assert.ok(p.values!.length > 0, `${m.model_id}.${p.name}`);
  }
  for (const id of ['wavespeed-ai/minimax-h3/text-to-image', 'wavespeed-ai/qwen-image-2.0/text-to-image', 'alibaba/wan-2.7/text-to-image', 'bytedance/seedream-v5.0-lite', 'wavespeed-ai/flux-2-klein-9b/text-to-image', 'google/nano-banana-2.1/edit', 'alibaba/wan-2.6/image-edit'])
    assert.ok(models.some(m => m.model_id === id), id);
});
test('models with a pixel size (not aspect ratio) get the production canvas, and a default-on boolean can be turned off explicitly', async () => {
  const ctx = await setup({ scenarios: { async catalog() { return { basic: [], advanced: { experiences: [], frame_styles: [] } }; },
    async plan() { return { kind: 'basic' as const, label: 'Basic', production_model: null, meta: {}, prompt: 'PROD', production_size: { width: 1024, height: 1536 }, images: [{ bytes: await png(), role: 'template' as const }, { bytes: await png(), role: 'reference' as const }] }; } } as NxScenarioSource });
  const plan = await ctx.lab.planScenario({ kind: 'basic', template_id: 't' }, await png());
  const wan = await ctx.lab.quoteRun({ model_ref: ctx.by('alibaba/wan-2.7/image-edit').id, prompt: plan.prompt, scenario: plan, images: plan.images });
  assert.deepEqual(wan.params_sent, { size: '1024*1536' });
  const flux = await ctx.lab.quoteRun({ model_ref: ctx.by('wavespeed-ai/flux-2-klein-9b/edit').id, prompt: plan.prompt, scenario: plan, images: plan.images });
  assert.deepEqual(flux.params_sent, { size: '1024*1536' });
  const thinking = await ctx.lab.quoteRun({ model_ref: ctx.by('alibaba/wan-2.7/text-to-image').id, prompt: 'p', images: [], params: { thinking_mode: false, size: '1024*1024' } });
  assert.deepEqual(thinking.params_sent, { thinking_mode: false, size: '1024*1024' });
});
test('single-image models send `image` (not `images`) and cannot run Basic', async () => {
  const ctx = await setup({ scenarios: { async catalog() { return { basic: [], advanced: { experiences: [], frame_styles: [] } }; },
    async plan(sel: any) { return { kind: sel.kind, label: 'x', production_model: null, meta: {}, prompt: 'PROD', production_size: { width: 1024, height: 1536 },
      images: sel.kind === 'basic' ? [{ bytes: await png(), role: 'template' as const }, { bytes: await png(), role: 'reference' as const }] : [{ bytes: await png(), role: 'reference' as const }] }; } } as NxScenarioSource });
  const single = ctx.by('wavespeed-ai/qwen-image/edit'), basic = await ctx.lab.planScenario({ kind: 'basic', template_id: 't' }, await png()), adv = await ctx.lab.planScenario({ kind: 'advanced', experience_id: 'e', frame_style_id: 'f' }, await png());
  await assert.rejects(ctx.lab.quoteRun({ model_ref: single.id, prompt: basic.prompt, scenario: basic, images: basic.images }), (e: LabError) => e.code === 'LAB_INPUT_LIMIT');
  const created = await ctx.lab.createRuns([{ model_ref: single.id, prompt: adv.prompt, scenario: adv, images: adv.images }], admin, confirm(0.016)); await created.done;
  const sent = JSON.parse(String(ctx.fake.submits()[0]!.body));
  assert.equal(typeof sent.image, 'string'); assert.equal(sent.images, undefined); assert.equal((await ctx.lab.getRun(created.runs[0]!.id)).status, 'SUCCEEDED');
  const priced = JSON.parse(String(ctx.fake.calls.filter(c => c.url.endsWith('/model/price')).at(-2)!.body)); assert.equal(typeof priced.inputs.image, 'string');
});

function scenarioCtx(prompt: string, compact?: string) {
  return setup({ scenarios: { async catalog() { return { basic: [], advanced: { experiences: [], frame_styles: [] } }; },
    async plan(sel: any) { return { kind: sel.kind, label: 'x', production_model: null, meta: {}, prompt, ...(compact && sel.kind === 'basic' ? { compact_prompt: compact } : {}), production_size: { width: 1024, height: 1536 },
      images: sel.kind === 'basic' ? [{ bytes: await png(), role: 'template' as const }, { bytes: await png(), role: 'reference' as const }] : [{ bytes: await png(), role: 'reference' as const }] }; } } as NxScenarioSource });
}
const lastPricedPrompt = (ctx: Awaited<ReturnType<typeof setup>>) => JSON.parse(String(ctx.fake.calls.filter(c => c.url.endsWith('/model/price')).at(-2)!.body)).inputs.prompt as string;
test('adaptation: models with a prompt cap get the condensed prompt for Basic (flagged); Advanced without one is still refused', async () => {
  const compact = 'Edit Image 1 using the person in Image 2. '.repeat(10);
  const ctx = await scenarioCtx('P'.repeat(4000) + ' Image 1 Image 2', compact);
  const basic = await ctx.lab.planScenario({ kind: 'basic', template_id: 't' }, await png()), adv = await ctx.lab.planScenario({ kind: 'advanced', experience_id: 'e', frame_style_id: 'f' }, await png());
  const q = await ctx.lab.quoteRun({ model_ref: ctx.by('alibaba/qwen-image-3.0/edit').id, prompt: basic.prompt, scenario: basic, images: basic.images });
  assert.equal(q.available, true); assert.equal(lastPricedPrompt(ctx), compact.trim()); assert.match(q.adapted[0]!, /condensed prompt \(model limit 800/);
  const created = await ctx.lab.createRuns([{ model_ref: ctx.by('alibaba/qwen-image-3.0/edit').id, prompt: basic.prompt, scenario: basic, images: basic.images }], admin, confirm(0.016)); await created.done;
  const run = await ctx.lab.getRun(created.runs[0]!.id); assert.equal(run.prompt, compact.trim()); assert.ok((run.params.prompt_adapted as string[]).length === 1);
  await assert.rejects(ctx.lab.quoteRun({ model_ref: ctx.by('alibaba/qwen-image-3.0/edit').id, prompt: adv.prompt, scenario: adv, images: adv.images }), (e: LabError) => e.code === 'LAB_PROMPT_TOO_LONG');
  const full = await ctx.lab.quoteRun({ model_ref: ctx.by('bytedance/seedream-v5.0-flash/edit').id, prompt: basic.prompt, scenario: basic, images: basic.images });
  assert.deepEqual(full.adapted, []); assert.equal(lastPricedPrompt(ctx), basic.prompt, 'models without a cap get the full production prompt');
});
test('adaptation: input images are named the way each model expects', async () => {
  const ctx = await scenarioCtx('Use Image 1 as the base. Image 2 is the person. Do not edit Image 1 text.');
  const basic = await ctx.lab.planScenario({ kind: 'basic', template_id: 't' }, await png());
  const q1 = await ctx.lab.quoteRun({ model_ref: ctx.by('bytedance/seedream-v5.0-lite/edit').id, prompt: basic.prompt, scenario: basic, images: basic.images });
  assert.equal(lastPricedPrompt(ctx), 'Use Figure 1 as the base. Figure 2 is the person. Do not edit Figure 1 text.'); assert.match(q1.adapted[0]!, /Figure N/);
  await ctx.lab.quoteRun({ model_ref: ctx.by('wavespeed-ai/minimax-h3/image-edit').id, prompt: basic.prompt, scenario: basic, images: basic.images });
  assert.equal(lastPricedPrompt(ctx), 'Use <Picture 1> as the base. <Picture 2> is the person. Do not edit <Picture 1> text.');
  await ctx.lab.quoteRun({ model_ref: ctx.by('google/nano-banana-2/edit').id, prompt: basic.prompt, scenario: basic, images: basic.images });
  assert.equal(lastPricedPrompt(ctx), basic.prompt, 'other models keep "Image N"');
});
test('adaptation: an explicit valid size overrides the production canvas; empty keeps it', async () => {
  const ctx = await scenarioCtx('p'), basic = await ctx.lab.planScenario({ kind: 'basic', template_id: 't' }, await png()), model = ctx.by('alibaba/wan-2.7/image-edit').id;
  assert.deepEqual((await ctx.lab.quoteRun({ model_ref: model, prompt: basic.prompt, scenario: basic, images: basic.images })).params_sent, { size: '1024*1536' });
  assert.deepEqual((await ctx.lab.quoteRun({ model_ref: model, prompt: basic.prompt, scenario: basic, images: basic.images, params: { size: '1536*2304' } })).params_sent, { size: '1536*2304' });
  const bad = await ctx.lab.quoteRun({ model_ref: model, prompt: basic.prompt, scenario: basic, images: basic.images, params: { size: '99999*99999' } });
  assert.deepEqual(bad.params_sent, { size: '1024*1536' }); assert.ok(bad.ignored.includes('size'));
});
test('catalog models stay editable (patching keeps schema, image field and reference naming)', async () => {
  const ctx = await setup(), single = ctx.by('wavespeed-ai/qwen-image/edit'), lite = ctx.by('bytedance/seedream-v5.0-lite/edit');
  const a = await ctx.lab.saveModel(single.id, { display_name: 'Qwen Edit (renamed)', enabled: false }, admin), b = await ctx.lab.saveModel(lite.id, { notes: 'edited' }, admin);
  assert.equal(a.display_name, 'Qwen Edit (renamed)'); assert.equal(a.image_field, 'image'); assert.equal(a.params!.length, single.params!.length); assert.equal(a.catalog_version, 5);
  assert.equal(b.ref_style, 'figure'); assert.equal(b.notes, 'edited');
});
