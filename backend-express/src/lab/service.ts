import { z } from 'zod';
import { maskSecret, redact, type LabVault } from './crypto.js';
import { newId, validateImage, type LabFiles, type ValidImage } from './files.js';
import { SafeHttp, validateBaseUrl, type NetworkPolicy } from './net.js';
import { calculateFromUsage, emptyPricing, estimate, validatePricing, type PriceEstimate } from './pricing.js';
import type { LabStore } from './store.js';
import {
  LabError, RATING_KEYS, type AdapterContext, type AdapterRequest, type CostBlock, type ImageInput, type LabAdapter, type LabHttp, type LabModel,
  type LabProvider, type LabRun, type LabSettings, type NxScenarioSource, type Pricing, type ProviderType, type Rating, type RunStatus, type ScenarioPlan, type ScenarioSelection, type Task,
} from './types.js';

export type Actor = { actor_id: string; role: string };
export type LabDeps = {
  store: LabStore; files: LabFiles; vault: LabVault; adapters: Partial<Record<ProviderType, LabAdapter>>;
  audit: (actor: Actor, action: string, targetType: string, targetId: string, reason: string, metadata?: object) => Promise<void>;
  policy?: NetworkPolicy; http?: (apiHost: string) => LabHttp; now?: () => Date; sleep?: (ms: number) => Promise<void>;
  maxUploadBytes?: number; timeoutMs?: number; pollIntervalMs?: number; scenarios?: NxScenarioSource;
};
export const DEFAULT_SETTINGS: LabSettings = { fx_usd_to_idr: null, fx_source: '', fx_date: null, per_request_usd: 0.25, daily_usd: 2, monthly_usd: 20, max_unpriced_runs_per_day: 5, retention_days: 7, auto_retry: false };
const TASKS: Task[] = ['text-to-image', 'image-to-image', 'multi-reference-edit'];
const FX_STALE_DAYS = 14;
const COUNTED_FAILURES = new Set(['LAB_TIMEOUT', 'LAB_INTERRUPTED']); // may still be billed by the provider

export type RunInput = {
  model_ref: string; prompt: string; negative_prompt?: string; size?: string; quality?: string; seed?: number; output_format?: string;
  images: { bytes: Buffer; role: 'template' | 'reference' | 'extra' }[];
  confirm?: boolean; confirmed_estimate_usd?: number | null; acknowledge_unknown_cost?: boolean; override_reason?: string; session_id?: string;
  scenario?: ScenarioPlan;
};
const ratingSchema = z.object({ scores: z.partialRecord(z.enum(RATING_KEYS), z.number().int().min(1).max(5)), notes: z.string().max(1000).default('') }).strict();
const providerPatch = z.object({ name: z.string().trim().min(2).max(80).optional(), base_url: z.string().trim().max(300).optional(), enabled: z.boolean().optional(), auth_method: z.enum(['bearer', 'key_header']).optional() }).strict();
const modelBody = z.object({
  provider_id: z.string().min(1).max(64), model_id: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._\/:-]*$/), display_name: z.string().trim().min(1).max(120),
  tasks: z.array(z.enum(['text-to-image', 'image-to-image', 'multi-reference-edit'])).min(1), sizes: z.array(z.string().trim().max(24)).max(40).default([]),
  max_reference_images: z.number().int().min(0).max(16).default(0),
  supports: z.object({ negative_prompt: z.boolean().default(false), seed: z.boolean().default(false), size: z.boolean().default(false), quality: z.array(z.string().max(24)).max(10).default([]), output_format: z.array(z.string().max(12)).max(6).default([]) }).prefault({}),
  pricing: z.unknown().optional(), enabled: z.boolean().default(true),
}).strict();
const settingsPatch = z.object({
  fx_usd_to_idr: z.number().positive().max(1e6).nullable().optional(), fx_source: z.string().max(200).optional(), fx_date: z.string().max(40).nullable().optional(),
  per_request_usd: z.number().min(0).max(1000).optional(), daily_usd: z.number().min(0).max(100000).optional(), monthly_usd: z.number().min(0).max(1000000).optional(),
  max_unpriced_runs_per_day: z.number().int().min(0).max(1000).optional(), retention_days: z.number().int().min(1).max(90).optional(),
}).strict();

type Prepared = Awaited<ReturnType<LabService['prepare']>>;
export class LabService {
  private readonly d: Required<Pick<LabDeps, 'now' | 'sleep' | 'maxUploadBytes' | 'timeoutMs' | 'pollIntervalMs'>> & LabDeps;
  constructor(deps: LabDeps) {
    this.d = { now: () => new Date(), sleep: ms => new Promise(r => setTimeout(r, ms)), maxUploadBytes: 12 * 1024 * 1024, timeoutMs: 240000, pollIntervalMs: 2000, ...deps };
  }
  private iso() { return this.d.now().toISOString(); }
  get encryptionReady() { return this.d.vault.ready; }

  // ---- settings -----------------------------------------------------------------------------------------------
  async settings(): Promise<LabSettings & { fx_stale: boolean }> {
    const stored = await this.d.store.get<Partial<LabSettings>>('settings', 'main');
    const value = { ...DEFAULT_SETTINGS, ...stored, auto_retry: false as const };
    const age = value.fx_date ? (this.d.now().getTime() - new Date(value.fx_date).getTime()) / 86400000 : Infinity;
    return { ...value, fx_stale: value.fx_usd_to_idr === null || !(age <= FX_STALE_DAYS) };
  }
  async updateSettings(body: unknown, actor: Actor) {
    const patch = settingsPatch.parse(body), current = await this.settings();
    const { fx_stale: _s, ...base } = current;
    const next: LabSettings = { ...base, ...patch, auto_retry: false };
    if (patch.fx_usd_to_idr !== undefined && patch.fx_usd_to_idr !== null && (!next.fx_source.trim() || !next.fx_date)) throw new LabError(422, 'LAB_FX_SOURCE_REQUIRED', 'Exchange rate needs a source and a date.');
    await this.d.store.put('settings', 'main', next);
    await this.d.audit(actor, 'lab.settings_update', 'lab_settings', 'main', '', { changed: Object.keys(patch) });
    return this.settings();
  }

  // ---- providers ----------------------------------------------------------------------------------------------
  private view(p: LabProvider) {
    const { secret_enc, secret_last4, ...rest } = p;
    return { ...rest, credential: { configured: Boolean(secret_enc), masked: maskSecret(secret_last4), updated_at: p.secret_updated_at }, adapter_available: Boolean(this.d.adapters[p.type]) };
  }
  async listProviders() { return (await this.d.store.list<LabProvider>('provider')).map(p => this.view(p)); }
  private async provider(id: string) { const p = await this.d.store.get<LabProvider>('provider', id); if (!p) throw new LabError(404, 'LAB_PROVIDER_NOT_FOUND', 'Provider not found.'); return p; }
  async createProvider(body: unknown, actor: Actor) {
    const input = z.object({ name: z.string().trim().min(2).max(80), type: z.enum(['wavespeed', 'fal', 'openai', 'openai_compatible', '9router', 'custom_rest']), base_url: z.string().trim().max(300).optional(), auth_method: z.enum(['bearer', 'key_header']).optional() }).strict().parse(body);
    const adapter = this.d.adapters[input.type];
    const base = validateBaseUrl(input.type, input.base_url || adapter?.defaultBaseUrl || (input.type === '9router' ? this.d.policy?.internalOrigin ?? '' : ''), this.d.policy);
    const now = this.iso();
    const provider: LabProvider = { id: newId(), name: input.name, type: input.type, base_url: base, auth_method: input.auth_method ?? (input.type === 'fal' ? 'key_header' : 'bearer'),
      secret_enc: null, secret_last4: null, secret_updated_at: null, enabled: false, last_success_at: null, last_test_status: 'untested', last_test_message: '', created_at: now, updated_at: now };
    await this.d.store.put('provider', provider.id, provider);
    await this.d.audit(actor, 'lab.provider_create', 'lab_provider', provider.id, '', { type: provider.type });
    return this.view(provider);
  }
  async updateProvider(id: string, body: unknown, actor: Actor) {
    const patch = providerPatch.parse(body), p = await this.provider(id);
    if (patch.base_url !== undefined) { p.base_url = validateBaseUrl(p.type, patch.base_url, this.d.policy); p.last_test_status = 'untested'; }
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.auth_method !== undefined) p.auth_method = patch.auth_method;
    if (patch.enabled !== undefined) {
      if (patch.enabled && !p.secret_enc) throw new LabError(409, 'LAB_CREDENTIAL_MISSING', 'Add a credential before enabling this provider for the Lab.');
      p.enabled = patch.enabled;
    }
    p.updated_at = this.iso();
    await this.d.store.put('provider', id, p);
    await this.d.audit(actor, 'lab.provider_update', 'lab_provider', id, '', { changed: Object.keys(patch) });
    return this.view(p);
  }
  async setCredential(id: string, secret: unknown, actor: Actor) {
    const value = z.string().trim().min(8).max(512).regex(/^[\x21-\x7e]+$/, 'Credential must be a single token without spaces.').parse(secret), p = await this.provider(id);
    const rotated = Boolean(p.secret_enc);
    p.secret_enc = this.d.vault.encrypt(value); p.secret_last4 = value.slice(-4); p.secret_updated_at = this.iso(); p.last_test_status = 'untested'; p.last_test_message = ''; p.updated_at = p.secret_updated_at;
    await this.d.store.put('provider', id, p);
    await this.d.audit(actor, rotated ? 'lab.credential_rotate' : 'lab.credential_set', 'lab_provider', id, '', {});
    return this.view(p);
  }
  async removeCredential(id: string, actor: Actor) {
    const p = await this.provider(id);
    p.secret_enc = null; p.secret_last4 = null; p.secret_updated_at = null; p.enabled = false; p.last_test_status = 'untested'; p.updated_at = this.iso();
    await this.d.store.put('provider', id, p);
    await this.d.audit(actor, 'lab.credential_remove', 'lab_provider', id, '', {});
    return this.view(p);
  }
  async deleteProvider(id: string, actor: Actor) {
    await this.provider(id);
    for (const m of (await this.d.store.list<LabModel>('model')).filter(m => m.provider_id === id)) await this.d.store.remove('model', m.id);
    await this.d.store.remove('provider', id);
    await this.d.audit(actor, 'lab.provider_delete', 'lab_provider', id, '', {});
  }
  private context(p: LabProvider, secret: string): AdapterContext {
    const host = new URL(p.base_url).host;
    return { baseUrl: p.base_url, secret, authMethod: p.auth_method, http: this.d.http ? this.d.http(host) : new SafeHttp(host, this.d.policy), sleep: this.d.sleep, timeoutMs: this.d.timeoutMs, pollIntervalMs: this.d.pollIntervalMs };
  }
  async testConnection(id: string, actor: Actor) {
    const p = await this.provider(id), adapter = this.d.adapters[p.type];
    if (!adapter) throw new LabError(501, 'LAB_ADAPTER_UNAVAILABLE', 'No safe adapter exists for this provider type yet.');
    if (!p.secret_enc) throw new LabError(409, 'LAB_CREDENTIAL_MISSING', 'Add a credential first.');
    const secret = this.d.vault.decrypt(p.secret_enc);
    let result: { ok: boolean; message: string; inconclusive?: boolean };
    try { result = await adapter.testConnection(this.context(p, secret)); }
    catch (error) { result = { ok: false, message: error instanceof LabError ? redact(error.message, [secret]) : 'The provider could not be reached.' }; }
    if (!result.inconclusive) p.last_test_status = result.ok ? 'ok' : 'failed';
    p.last_test_message = result.message;
    if (result.ok) p.last_success_at = this.iso();
    await this.d.store.put('provider', id, p);
    await this.d.audit(actor, 'lab.provider_test', 'lab_provider', id, '', { ok: result.ok });
    return { ...result, provider: this.view(p) };
  }

  // ---- models -------------------------------------------------------------------------------------------------
  listModels() { return this.d.store.list<LabModel>('model'); }
  private async model(id: string) { const m = await this.d.store.get<LabModel>('model', id); if (!m) throw new LabError(404, 'LAB_MODEL_NOT_FOUND', 'Model not found.'); return m; }
  async saveModel(id: string | null, body: unknown, actor: Actor) {
    const existing = id ? await this.model(id) : null;
    const input = modelBody.parse(id ? { ...existing, ...(body as object) } : body);
    await this.provider(input.provider_id);
    let pricing: Pricing;
    try { pricing = input.pricing === undefined ? existing?.pricing ?? emptyPricing() : validatePricing(input.pricing); } catch (e) { throw new LabError(422, 'LAB_PRICING_INVALID', (e as Error).message); }
    const now = this.iso();
    const model: LabModel = { id: existing?.id ?? newId(), provider_id: input.provider_id, model_id: input.model_id, display_name: input.display_name, tasks: input.tasks, sizes: input.sizes,
      max_reference_images: input.max_reference_images, supports: input.supports, pricing, status: existing?.status ?? 'untested', enabled: input.enabled, last_tested_at: existing?.last_tested_at ?? null, created_at: existing?.created_at ?? now, updated_at: now };
    await this.d.store.put('model', model.id, model);
    await this.d.audit(actor, existing ? 'lab.model_update' : 'lab.model_create', 'lab_model', model.id, '', { pricing_method: pricing.method });
    return model;
  }
  async deleteModel(id: string, actor: Actor) { await this.model(id); await this.d.store.remove('model', id); await this.d.audit(actor, 'lab.model_delete', 'lab_model', id, ''); }

  // ---- NXBooth scenarios (Basic / Advanced) ------------------------------------------------------------------
  scenarioCatalog() {
    if (!this.d.scenarios) throw new LabError(503, 'LAB_SCENARIOS_UNAVAILABLE', 'NXBooth scenarios are not connected in this deployment.');
    return this.d.scenarios.catalog();
  }
  async planScenario(selection: ScenarioSelection, face: Buffer): Promise<ScenarioPlan> {
    if (!this.d.scenarios) throw new LabError(503, 'LAB_SCENARIOS_UNAVAILABLE', 'NXBooth scenarios are not connected in this deployment.');
    await validateImage(face, { maxBytes: this.d.maxUploadBytes });
    return this.d.scenarios.plan(selection, face);
  }

  // ---- estimates ----------------------------------------------------------------------------------------------
  private sizeOf(size: string | undefined, fallback?: { width: number; height: number }) {
    const m = size?.match(/^(\d{2,5})[x*](\d{2,5})$/);
    return m ? { width: Number(m[1]), height: Number(m[2]) } : fallback && !size ? fallback : undefined;
  }
  private toIdr(usd: number | null, s: LabSettings & { fx_stale: boolean }) { return usd === null || s.fx_usd_to_idr === null ? null : Math.round(usd * s.fx_usd_to_idr); }
  async estimateFor(body: unknown) {
    const input = z.object({ model_ref: z.string().min(1), reference_images: z.number().int().min(0).max(16).default(0), size: z.string().max(24).optional(), count: z.number().int().min(1).max(20).default(1) }).parse(body);
    const model = await this.model(input.model_ref), settings = await this.settings();
    const size = this.sizeOf(input.size);
    const est = estimate(model.pricing, { reference_images: input.reference_images, ...(size ?? {}), count: input.count });
    return { estimate: est, estimated_idr: this.toIdr(est.usd, settings), fx: { rate: settings.fx_usd_to_idr, source: settings.fx_source, date: settings.fx_date, stale: settings.fx_stale }, pricing: { source: model.pricing.source, verified_at: model.pricing.verified_at, currency: 'USD' }, budget: await this.budget() };
  }
  private spent(run: LabRun) {
    if (run.status === 'SUCCEEDED') return run.cost.provider_reported_usd ?? run.cost.calculated_usd ?? run.cost.estimated_usd ?? 0;
    if (run.status === 'FAILED') return run.error_code && COUNTED_FAILURES.has(run.error_code) ? run.reserved_usd : 0;
    return run.reserved_usd;
  }
  private totals(runs: LabRun[]) {
    const now = this.d.now(), day = now.toISOString().slice(0, 10), month = now.toISOString().slice(0, 7);
    let today = 0, thisMonth = 0, unpricedToday = 0;
    for (const run of runs) {
      const value = this.spent(run);
      if (run.created_at.startsWith(day)) { today += value; if (run.unpriced) unpricedToday++; }
      if (run.created_at.startsWith(month)) thisMonth += value;
    }
    return { today_usd: Math.round(today * 1e6) / 1e6, month_usd: Math.round(thisMonth * 1e6) / 1e6, unpriced_today: unpricedToday };
  }
  async budget() {
    const settings = await this.settings();
    return { limits: { per_request_usd: settings.per_request_usd, daily_usd: settings.daily_usd, monthly_usd: settings.monthly_usd, max_unpriced_runs_per_day: settings.max_unpriced_runs_per_day }, spent: this.totals(await this.d.store.list<LabRun>('run', 5000)) };
  }

  // ---- runs ---------------------------------------------------------------------------------------------------
  private async prepare(input: RunInput) {
    const model = await this.model(input.model_ref), provider = await this.provider(model.provider_id);
    if (!provider.enabled || !provider.secret_enc) throw new LabError(409, 'LAB_PROVIDER_NOT_READY', 'Provider is disabled or has no credential.');
    if (!model.enabled) throw new LabError(409, 'LAB_MODEL_DISABLED', 'This model is disabled.');
    const adapter = this.d.adapters[provider.type];
    if (!adapter) throw new LabError(501, 'LAB_ADAPTER_UNAVAILABLE', 'No safe adapter exists for this provider type yet.');
    const prompt = z.string().trim().min(1).max(input.scenario ? 20000 : 4000).parse(input.prompt);
    const imageTask = model.tasks.some(t => t !== 'text-to-image');
    if (input.images.length && !imageTask) throw new LabError(422, 'LAB_INPUT_UNSUPPORTED', 'This model does not accept input images.');
    if (!input.images.length && !model.tasks.includes('text-to-image')) throw new LabError(422, 'LAB_INPUT_REQUIRED', 'This model needs at least one input image.');
    if (input.images.length > model.max_reference_images) throw new LabError(422, 'LAB_INPUT_LIMIT', `This model accepts at most ${model.max_reference_images} input images.`);
    const valid: (ValidImage & { role: ImageInput['role'] })[] = [];
    for (const image of input.images) valid.push({ ...await validateImage(image.bytes, { maxBytes: this.d.maxUploadBytes }), role: image.role });
    // Unsupported parameters are dropped, never sent to the provider.
    const ignored: string[] = [], params: Record<string, unknown> = {};
    const take = (key: string, ok: boolean, value: unknown) => { if (value === undefined || value === '') return; if (ok) params[key] = value; else ignored.push(key); };
    take('size', model.supports.size && (!model.sizes.length || model.sizes.includes(input.size ?? '')), input.size);
    take('quality', model.supports.quality.includes(input.quality ?? ''), input.quality);
    take('seed', model.supports.seed && Number.isSafeInteger(input.seed), input.seed);
    take('output_format', model.supports.output_format.includes(input.output_format ?? ''), input.output_format);
    const negative = model.supports.negative_prompt ? (input.negative_prompt ?? '').slice(0, 2000) : '';
    if (input.negative_prompt && !model.supports.negative_prompt) ignored.push('negative_prompt');
    // Scenario runs use the production canvas, formatted the way each provider expects.
    const production = input.scenario?.production_size ?? null;
    if (production) {
      const wire = `${production.width}${provider.type === 'wavespeed' ? '*' : 'x'}${production.height}`;
      if (model.supports.size && (!model.sizes.length || model.sizes.includes(wire))) params.size = wire; else if (model.supports.size) ignored.push('size');
    }
    const size = production ?? this.sizeOf(params.size as string | undefined, valid[0] ? { width: valid[0].width, height: valid[0].height } : undefined);
    const est = estimate(model.pricing, { reference_images: Math.max(0, valid.length - 1), ...(size ?? {}) });
    return { model, provider, adapter, prompt, negative, valid, params, ignored, est, scenario: input.scenario ?? null };
  }
  async createRuns(inputs: RunInput[], actor: Actor, confirmedTotal: { confirm?: boolean; total_usd?: number | null; acknowledge_unknown_cost?: boolean; override_reason?: string }) {
    if (!inputs.length || inputs.length > 6) throw new LabError(422, 'LAB_RUN_COUNT', 'Run between 1 and 6 models at a time.');
    await this.purgeExpired();
    const prepared: Prepared[] = [];
    for (const input of inputs) prepared.push(await this.prepare(input));
    // 1. Explicit confirmation of the server-calculated estimate (the client cannot pick the number).
    const known = prepared.every(p => p.est.known), total = known ? Math.round(prepared.reduce((s, p) => s + p.est.usd!, 0) * 1e6) / 1e6 : null;
    if (confirmedTotal.confirm !== true) throw new LabError(409, 'LAB_CONFIRMATION_REQUIRED', 'Explicit confirmation is required before a paid generation.');
    if (known) { if (typeof confirmedTotal.total_usd !== 'number' || Math.abs(confirmedTotal.total_usd - total!) > 1e-6) throw new LabError(409, 'LAB_ESTIMATE_CHANGED', `The estimate is now ${total} USD. Review and confirm again.`); }
    else if (confirmedTotal.acknowledge_unknown_cost !== true) throw new LabError(409, 'LAB_UNKNOWN_COST_UNCONFIRMED', 'Pricing is unknown for this model. Acknowledge that the cost cannot be estimated to continue.');
    const settings = await this.settings(), overrideReason = (confirmedTotal.override_reason ?? '').trim();
    const created = await this.d.store.locked(async store => {
      // 2. Budget check + reservation under one lock so concurrent requests cannot both pass.
      const totals = this.totals(await store.list<LabRun>('run', 5000)), reasons: string[] = [];
      if (known) {
        if (prepared.some(p => p.est.usd! > settings.per_request_usd)) reasons.push(`a request exceeds the per-request ceiling of ${settings.per_request_usd} USD`);
        if (totals.today_usd + total! > settings.daily_usd) reasons.push(`daily Lab limit of ${settings.daily_usd} USD would be exceeded (spent ${totals.today_usd})`);
        if (totals.month_usd + total! > settings.monthly_usd) reasons.push(`monthly Lab limit of ${settings.monthly_usd} USD would be exceeded (spent ${totals.month_usd})`);
      }
      const unpriced = prepared.filter(p => !p.est.known).length;
      if (unpriced && totals.unpriced_today + unpriced > settings.max_unpriced_runs_per_day) reasons.push(`more than ${settings.max_unpriced_runs_per_day} runs with unknown pricing today`);
      let override: LabRun['override'] = null;
      if (reasons.length) {
        if (overrideReason.length < 10) throw new LabError(402, 'LAB_BUDGET_EXCEEDED', `Budget exceeded: ${reasons.join('; ')}. A superadmin may override with a written reason.`);
        if (actor.role !== 'superadmin') throw new LabError(403, 'ADMIN_FORBIDDEN', 'Only a superadmin can override Lab spending limits.');
        override = { reason: overrideReason.slice(0, 300), actor: actor.actor_id };
      }
      const runs: LabRun[] = [];
      for (const [index, p] of prepared.entries()) {
        const id = newId(), now = this.iso();
        const run: LabRun = { id, provider_id: p.provider.id, provider_name: p.provider.name, provider_type: p.provider.type, model_ref: p.model.id, model_id: p.model.model_id, model_name: p.model.display_name,
          status: 'RESERVED', prompt: p.prompt, negative_prompt: p.negative, params: { ...p.params, ...(p.ignored.length ? { ignored_unsupported: p.ignored } : {}) }, inputs: [], output: null,
          cost: { estimated_usd: p.est.usd, provider_reported_usd: null, calculated_usd: null, basis: p.est.known ? 'estimated from configured pricing' : 'pricing unknown' },
          reserved_usd: p.est.usd ?? 0, unpriced: !p.est.known, override, duration_ms: null, provider_request_id: null, error_code: null, error_message: null, usage: null,
          session_id: inputs[index]!.session_id ?? null, rating: null, raw_output: null,
          scenario: p.scenario ? { kind: p.scenario.kind, label: p.scenario.label, production_model: p.scenario.production_model, meta: p.scenario.meta } : null, created_by: actor.actor_id, created_at: now, finished_at: null,
          expires_at: new Date(this.d.now().getTime() + settings.retention_days * 86400000).toISOString() };
        await store.put('run', id, run); runs.push(run);
      }
      return runs;
    });
    await this.d.audit(actor, 'lab.paid_execution', 'lab_run', created.map(r => r.id).join(','), overrideReason, { estimated_usd: total, models: created.map(r => r.model_name), override: Boolean(created[0]?.override) });
    if (created[0]?.override) await this.d.audit(actor, 'lab.budget_override', 'lab_run', created[0].id, overrideReason, { estimated_usd: total });
    // 3. Persist inputs, then execute in the background; the caller polls GET /runs/:id.
    const done = created.map((run, index) => this.execute(run, prepared[index]!, actor));
    return { runs: created, done: Promise.all(done), estimate_usd: total };
  }
  private async execute(run: LabRun, p: Prepared, _actor: Actor) {
    const started = Date.now(), secret = this.d.vault.decrypt(p.provider.secret_enc!);
    const save = (patch: Partial<LabRun>) => { Object.assign(run, patch); return this.d.store.put('run', run.id, run); };
    try {
      const slots = new Map<string, number>();
      for (const [index, image] of p.valid.entries()) {
        const n = (slots.get(image.role) ?? 0) + 1; slots.set(image.role, n);
        const slot = `${image.role}${n > 1 ? n : ''}`, file = `in-${index}-${image.role}.${image.ext}`;
        await this.d.files.write(run.id, file, image.bytes);
        run.inputs.push({ slot, file, content_type: image.contentType, width: image.width, height: image.height });
      }
      await save({ status: 'PROCESSING' });
      const request: AdapterRequest = { model_id: p.model.model_id, prompt: p.prompt, images: p.valid.map(i => ({ bytes: i.bytes, contentType: i.contentType, width: i.width, height: i.height, role: i.role })),
        ...(p.negative ? { negative_prompt: p.negative } : {}), ...(p.params as Partial<AdapterRequest>) };
      const result = await p.adapter.generate(this.context(p.provider, secret), request);
      const image = result.images[0];
      if (!image) throw new LabError(502, 'LAB_OUTPUT_UNAVAILABLE', 'The provider returned no image.');
      const valid = await validateImage(image.bytes, { maxBytes: 40 * 1024 * 1024, minSide: 16, maxSide: 12000 });
      let shown = valid, raw: LabRun['raw_output'] = null;
      if (p.scenario?.finish) {
        // Same finishing step production applies to this mode. If it fails the paid image is kept unfinished.
        try { const finished = await validateImage(await p.scenario.finish(valid.bytes), { maxBytes: 60 * 1024 * 1024, minSide: 16, maxSide: 12000 });
          await this.d.files.write(run.id, `raw.${valid.ext}`, valid.bytes); raw = { file: `raw.${valid.ext}`, content_type: valid.contentType }; shown = finished; }
        catch { run.params = { ...run.params, finish_failed: true }; }
      }
      const file = `out.${shown.ext}`;
      await this.d.files.write(run.id, file, shown.bytes);
      const usage = result.usage ?? null, calculated = calculateFromUsage(p.model.pricing, usage, result.inference_ms ?? null, Math.max(0, p.valid.length - 1));
      const cost: CostBlock = { estimated_usd: run.cost.estimated_usd, provider_reported_usd: result.reported_cost_usd ?? null, calculated_usd: calculated,
        basis: result.reported_cost_usd !== undefined ? 'provider-reported' : calculated !== null ? 'calculated from measured usage and configured prices' : run.cost.estimated_usd !== null ? 'estimate only; the provider did not expose the billed amount' : 'pricing unknown' };
      await save({ status: 'SUCCEEDED', raw_output: raw, output: { file, content_type: shown.contentType, width: shown.width, height: shown.height }, cost, usage, provider_request_id: result.request_id, duration_ms: Date.now() - started, finished_at: this.iso() });
      p.model.status = 'ok'; p.model.last_tested_at = this.iso(); await this.d.store.put('model', p.model.id, p.model);
      const provider = await this.d.store.get<LabProvider>('provider', p.provider.id);
      if (provider) { provider.last_success_at = this.iso(); await this.d.store.put('provider', provider.id, provider); }
    } catch (error) {
      const known = error instanceof LabError;
      await save({ status: 'FAILED', error_code: known ? error.code : 'LAB_RUN_ERROR', error_message: known ? redact(error.message, [secret]) : 'The generation failed unexpectedly.', duration_ms: Date.now() - started, finished_at: this.iso() }).catch(() => undefined);
      p.model.status = 'failing'; p.model.last_tested_at = this.iso(); await this.d.store.put('model', p.model.id, p.model).catch(() => undefined);
    }
  }
  private async sweepStale(run: LabRun) {
    if ((run.status === 'RESERVED' || run.status === 'PROCESSING') && this.d.now().getTime() - new Date(run.created_at).getTime() > this.d.timeoutMs + 120000) {
      Object.assign(run, { status: 'FAILED' as RunStatus, error_code: 'LAB_INTERRUPTED', error_message: 'The run was interrupted (service restart or timeout). The provider may still have billed it.', finished_at: this.iso() });
      await this.d.store.put('run', run.id, run);
    }
    return run;
  }
  async getRun(id: string) { const run = await this.d.store.get<LabRun>('run', id); if (!run) throw new LabError(404, 'LAB_RUN_NOT_FOUND', 'Test run not found.'); return this.sweepStale(run); }
  async runView(id: string) { return this.withIdr(await this.getRun(id)); }
  private async withIdr(run: LabRun) { const s = await this.settings(); const usd = run.cost.provider_reported_usd ?? run.cost.calculated_usd ?? run.cost.estimated_usd; return { ...run, effective_cost_usd: usd, effective_cost_idr: this.toIdr(usd, s) }; }
  private filter(runs: LabRun[], f: { provider_id?: string; model_ref?: string; status?: string; from?: string; to?: string; session_id?: string }) {
    const from = f.from ? new Date(f.from).getTime() : null, to = f.to ? new Date(f.to).getTime() + 86400000 : null;
    return runs.filter(r => (!f.provider_id || r.provider_id === f.provider_id) && (!f.model_ref || r.model_ref === f.model_ref) && (!f.status || r.status === f.status) && (!f.session_id || r.session_id === f.session_id)
      && (from === null || new Date(r.created_at).getTime() >= from) && (to === null || new Date(r.created_at).getTime() < to));
  }
  async listRuns(f: Record<string, string | undefined>, limit = 200) {
    const all = await this.d.store.list<LabRun>('run', 5000); for (const r of all) await this.sweepStale(r);
    return Promise.all(this.filter(all, f).slice(0, limit).map(r => this.withIdr(r)));
  }
  async runFile(id: string, slot: string) {
    const run = await this.getRun(id);
    const file = slot === 'output' ? run.output : slot === 'raw' ? run.raw_output : run.inputs.find(i => i.slot === slot);
    if (!file) throw new LabError(404, 'LAB_FILE_NOT_FOUND', 'Image not available.');
    return { bytes: await this.d.files.read(id, file.file), contentType: file.content_type, name: `lab-${id.slice(0, 8)}-${slot}.${file.file.split('.').pop()}` };
  }
  async deleteRunFiles(id: string, actor: Actor) {
    const run = await this.getRun(id); await this.d.files.removeRun(id);
    run.inputs = []; run.output = null; run.raw_output = null; await this.d.store.put('run', id, run);
    await this.d.audit(actor, 'lab.run_files_delete', 'lab_run', id, '');
  }
  // Retention: image files expire; sanitized metadata (cost, latency, ratings) is kept for history.
  async purgeExpired() {
    const now = this.d.now().getTime(); let purged = 0;
    for (const run of await this.d.store.list<LabRun>('run', 5000)) {
      if ((run.inputs.length || run.output) && new Date(run.expires_at).getTime() < now && run.status !== 'PROCESSING') { await this.d.files.removeRun(run.id); run.inputs = []; run.output = null; run.raw_output = null; await this.d.store.put('run', run.id, run); purged++; }
    }
    return { purged };
  }

  // ---- ratings, sessions, benchmarks, candidates --------------------------------------------------------------
  async rate(id: string, body: unknown, actor: Actor) {
    const input = ratingSchema.parse(body), run = await this.getRun(id);
    if (run.status !== 'SUCCEEDED') throw new LabError(409, 'LAB_RUN_NOT_RATEABLE', 'Only successful runs can be rated.');
    run.rating = { scores: input.scores, notes: input.notes, rated_by: actor.actor_id, rated_at: this.iso() } satisfies Rating;
    await this.d.store.put('run', id, run); return this.withIdr(run);
  }
  async saveSession(body: unknown, actor: Actor) {
    const input = z.object({ name: z.string().trim().min(1).max(120), notes: z.string().max(1000).default(''), run_ids: z.array(z.string().regex(/^[a-f0-9]{32}$/)).min(1).max(12), session_id: z.string().optional() }).strict().parse(body);
    for (const id of input.run_ids) await this.getRun(id);
    const id = input.session_id ?? newId(), existing = await this.d.store.get<{ created_at: string; created_by: string }>('session', id);
    const session = { id, name: input.name, notes: input.notes, run_ids: input.run_ids, created_by: existing?.created_by ?? actor.actor_id, created_at: existing?.created_at ?? this.iso(), updated_at: this.iso() };
    await this.d.store.put('session', id, session); return session;
  }
  listSessions() { return this.d.store.list<{ id: string }>('session', 200); }
  async getSession(id: string) {
    const session = await this.d.store.get<{ id: string; run_ids: string[] }>('session', id);
    if (!session) throw new LabError(404, 'LAB_SESSION_NOT_FOUND', 'Session not found.');
    const runs = []; for (const rid of session.run_ids) { const r = await this.d.store.get<LabRun>('run', rid); if (r) runs.push(await this.withIdr(await this.sweepStale(r))); }
    return { ...session, runs, benchmarks: this.benchmark(runs, 4) };
  }
  // "Accepted" = successful run whose administrator rating for overall suitability meets the threshold.
  benchmark(runs: LabRun[], threshold: number) {
    const groups = new Map<string, LabRun[]>(); for (const r of runs) groups.set(r.model_ref, [...(groups.get(r.model_ref) ?? []), r]);
    return [...groups.entries()].map(([model_ref, group]) => {
      const ok = group.filter(r => r.status === 'SUCCEEDED'), accepted = ok.filter(r => (r.rating?.scores.overall ?? 0) >= threshold);
      const spend = group.reduce((s, r) => s + this.spent(r), 0), rated = ok.filter(r => r.rating), avg = (key: typeof RATING_KEYS[number]) => { const v = rated.map(r => r.rating!.scores[key]).filter((x): x is number => typeof x === 'number'); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100 : null; };
      const times = ok.map(r => r.duration_ms).filter((x): x is number => x !== null);
      return { model_ref, provider_name: group[0]!.provider_name, model_name: group[0]!.model_name, runs: group.length, succeeded: ok.length, failed: group.length - ok.length, rated: rated.length, accepted, accepted_count: accepted.length,
        total_spend_usd: Math.round(spend * 1e6) / 1e6, cost_per_accepted_usd: accepted.length ? Math.round(spend / accepted.length * 1e6) / 1e6 : null,
        avg_duration_ms: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null, avg_scores: Object.fromEntries(RATING_KEYS.map(k => [k, avg(k)])), threshold,
        label: 'Cost per Accepted Image = total spend of the runs in scope / successful runs rated overall >= threshold. Ratings are manual and subjective.' };
    }).map(({ accepted: _a, ...rest }) => rest);
  }
  async benchmarks(f: Record<string, string | undefined>, threshold = 4) { return this.benchmark(this.filter(await this.d.store.list<LabRun>('run', 5000), f), threshold); }
  async markCandidate(body: unknown, actor: Actor) {
    const input = z.object({ model_ref: z.string().min(1), note: z.string().trim().max(500).default(''), threshold: z.number().min(1).max(5).default(4) }).strict().parse(body);
    const model = await this.model(input.model_ref), provider = await this.provider(model.provider_id);
    const snapshot = this.benchmark((await this.d.store.list<LabRun>('run', 5000)).filter(r => r.model_ref === model.id), input.threshold)[0] ?? null;
    // Record only. Marking a candidate never changes production routing, models, secrets or fallback.
    const candidate = { id: newId(), model_ref: model.id, provider_name: provider.name, model_name: model.display_name, note: input.note, benchmark: snapshot, production_activated: false as const, created_by: actor.actor_id, created_at: this.iso() };
    await this.d.store.put('candidate', candidate.id, candidate);
    await this.d.audit(actor, 'lab.production_candidate_mark', 'lab_model', model.id, input.note, { production_activated: false });
    return candidate;
  }
  listCandidates() { return this.d.store.list('candidate', 200); }

  // ---- analytics ----------------------------------------------------------------------------------------------
  async analytics(f: Record<string, string | undefined>) {
    const all = await this.d.store.list<LabRun>('run', 5000), runs = this.filter(all, f), s = await this.settings();
    const pct = (values: number[], p: number) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1)]!; };
    const durations = runs.filter(r => r.status === 'SUCCEEDED' && r.duration_ms !== null).map(r => r.duration_ms!);
    const by = new Map<string, LabRun[]>(); for (const r of runs) by.set(r.model_ref, [...(by.get(r.model_ref) ?? []), r]);
    const day = new Map<string, { runs: number; estimated_usd: number }>();
    for (const r of runs) { const key = r.created_at.slice(0, 10), v = day.get(key) ?? { runs: 0, estimated_usd: 0 }; v.runs++; v.estimated_usd += r.cost.estimated_usd ?? 0; day.set(key, v); }
    const sum = (rs: LabRun[], pick: (r: LabRun) => number | null) => Math.round(rs.reduce((a, r) => a + (pick(r) ?? 0), 0) * 1e6) / 1e6;
    const reportedRuns = runs.filter(r => r.cost.provider_reported_usd !== null).length;
    return {
      totals: { requests: runs.length, succeeded: runs.filter(r => r.status === 'SUCCEEDED').length, failed: runs.filter(r => r.status === 'FAILED').length, in_progress: runs.filter(r => r.status === 'RESERVED' || r.status === 'PROCESSING').length,
        estimated_usd: sum(runs, r => r.cost.estimated_usd), provider_reported_usd: reportedRuns ? sum(runs, r => r.cost.provider_reported_usd) : null, provider_reported_runs: reportedRuns, unpriced_runs: runs.filter(r => r.unpriced).length },
      latency_ms: { average: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null, p50: pct(durations, 50), p95: pct(durations, 95) },
      by_model: [...by.entries()].map(([model_ref, rs]) => { const d = rs.filter(r => r.status === 'SUCCEEDED' && r.duration_ms !== null).map(r => r.duration_ms!); return { model_ref, provider_name: rs[0]!.provider_name, model_name: rs[0]!.model_name, runs: rs.length, succeeded: rs.filter(r => r.status === 'SUCCEEDED').length, failed: rs.filter(r => r.status === 'FAILED').length, estimated_usd: sum(rs, r => r.cost.estimated_usd), provider_reported_usd: rs.some(r => r.cost.provider_reported_usd !== null) ? sum(rs, r => r.cost.provider_reported_usd) : null, p50_ms: pct(d, 50), p95_ms: pct(d, 95) }; }),
      daily: [...day.entries()].sort().map(([date, v]) => ({ date, runs: v.runs, estimated_usd: Math.round(v.estimated_usd * 1e6) / 1e6 })),
      spend: this.totals(all), fx: { rate: s.fx_usd_to_idr, source: s.fx_source, date: s.fx_date, stale: s.fx_stale }, estimated_idr: this.toIdr(sum(runs, r => r.cost.estimated_usd), s),
      note: 'Estimated = configured price schedule. Provider-reported appears only when the provider exposes it. Lab spend is tracked separately from production credits and billing.',
    };
  }
  async exportCsv(f: Record<string, string | undefined>) {
    const runs = this.filter(await this.d.store.list<LabRun>('run', 5000), f).reverse();
    const cell = (v: unknown) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const header = ['created_at', 'provider', 'model', 'status', 'duration_ms', 'estimated_usd', 'provider_reported_usd', 'calculated_usd', 'cost_basis', 'output_width', 'output_height', 'error_code', 'rating_overall', 'session_id'];
    // Deliberately excludes prompts, image references, provider request ids and credentials.
    const rows = runs.map(r => [r.created_at, r.provider_name, r.model_name, r.status, r.duration_ms, r.cost.estimated_usd, r.cost.provider_reported_usd, r.cost.calculated_usd, r.cost.basis, r.output?.width, r.output?.height, r.error_code, r.rating?.scores.overall, r.session_id].map(cell).join(','));
    return [header.join(','), ...rows].join('\n') + '\n';
  }
}
export type { PriceEstimate };
