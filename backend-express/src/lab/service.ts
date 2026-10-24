import { z } from 'zod';
import { maskSecret, redact, type LabVault } from './crypto.js';
import { newId, validateImage, type LabFiles, type ValidImage } from './files.js';
import { SafeHttp, validateBaseUrl, type NetworkPolicy } from './net.js';
import { calculateFromUsage, emptyPricing, estimate, validatePricing, type PriceEstimate } from './pricing.js';
import { CATALOG_VERSION, wavespeedCatalog } from './catalog.js';
import { candidateModel, looksLikeImageModel, STATIC_CANDIDATES, type Candidate } from './catalog-providers.js';
import type { LabStore } from './store.js';
import {
  LabError, RATING_KEYS, type AdapterContext, type AdapterRequest, type CostBlock, type ImageInput, type LabAdapter, type LabHttp, type LabModel,
  type LabProvider, type LabRun, type BillingLookup, type LabSettings, type NxScenarioSource, type ParamSpec, type RunBilling, type RunQuote, type RunTokens, type Verification, type Pricing, type ProviderType, type Rating, type RunStatus, type ScenarioPlan, type ScenarioSelection, type Task,
} from './types.js';

export type Actor = { actor_id: string; role: string };
export type LabDeps = {
  store: LabStore; files: LabFiles; vault: LabVault; adapters: Partial<Record<ProviderType, LabAdapter>>;
  audit: (actor: Actor, action: string, targetType: string, targetId: string, reason: string, metadata?: object) => Promise<void>;
  policy?: NetworkPolicy; http?: (apiHost: string) => LabHttp; now?: () => Date; sleep?: (ms: number) => Promise<void>;
  maxUploadBytes?: number; timeoutMs?: number; pollIntervalMs?: number; scenarios?: NxScenarioSource;
  autoBilling?: boolean; // background billing reconciliation after each successful run (off in unit tests)
};
export const DEFAULT_SETTINGS: LabSettings = { fx_usd_to_idr: null, fx_source: '', fx_date: null, per_request_usd: 0.15, daily_usd: 1, monthly_usd: 10, max_unpriced_runs_per_day: 5, retention_days: 7, auto_retry: false,
  max_active_runs: 1, max_runs_per_request: 1, enforce_sequence: true };
const TASKS: Task[] = ['text-to-image', 'image-to-image', 'multi-reference-edit'];
const FX_STALE_DAYS = 14;
const COUNTED_FAILURES = new Set(['LAB_TIMEOUT', 'LAB_INTERRUPTED', 'LAB_SUBMIT_AMBIGUOUS']); // may still be billed by the provider

export type RunInput = {
  model_ref: string; prompt: string; negative_prompt?: string; size?: string; quality?: string; seed?: number; output_format?: string;
  images: { bytes: Buffer; role: 'template' | 'reference' | 'extra' }[];
  confirm?: boolean; confirmed_estimate_usd?: number | null; acknowledge_unknown_cost?: boolean; override_reason?: string; session_id?: string;
  scenario?: ScenarioPlan; params?: Record<string, unknown>;
};
const ratingSchema = z.object({ scores: z.partialRecord(z.enum(RATING_KEYS), z.number().int().min(1).max(5)), notes: z.string().max(1000).default('') }).strict();
const providerPatch = z.object({ name: z.string().trim().min(2).max(80).optional(), base_url: z.string().trim().max(300).optional(), enabled: z.boolean().optional(), auth_method: z.enum(['bearer', 'key_header']).optional() }).strict();
const modelBody = z.object({
  provider_id: z.string().min(1).max(64), model_id: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._\/:-]*$/), display_name: z.string().trim().min(1).max(120),
  tasks: z.array(z.enum(['text-to-image', 'image-to-image', 'multi-reference-edit'])).min(1), sizes: z.array(z.string().trim().max(24)).max(40).default([]),
  max_reference_images: z.number().int().min(0).max(16).default(0),
  supports: z.object({ negative_prompt: z.boolean().default(false), seed: z.boolean().default(false), size: z.boolean().default(false), quality: z.array(z.string().max(24)).max(10).default([]), output_format: z.array(z.string().max(12)).max(6).default([]) }).prefault({}),
  pricing: z.unknown().optional(), enabled: z.boolean().default(true),
  params: z.array(z.object({ name: z.string().regex(/^[a-z_]{1,40}$/), label: z.string().max(80), type: z.enum(['enum', 'bool', 'int', 'text']), values: z.array(z.string().max(24)).max(40).optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(), min: z.number().optional(), max: z.number().optional(), pattern: z.string().max(80).optional(),
    side_range: z.tuple([z.number(), z.number()]).optional(), billing_relevant: z.boolean().optional(), note: z.string().max(200).optional() })).max(30).optional(),
  prompt_max: z.number().int().positive().nullable().optional(), sequence: z.number().int().min(1).max(100).nullable().optional(), notes: z.string().max(500).optional(),
  schema_source: z.string().max(300).optional(), schema_verified_at: z.string().max(40).nullable().optional(),
  catalog_version: z.number().int().optional(), image_field: z.enum(['images', 'image']).optional(), ref_style: z.enum(['figure', 'picture']).optional(),
}).strict();
const settingsPatch = z.object({
  fx_usd_to_idr: z.number().positive().max(1e6).nullable().optional(), fx_source: z.string().max(200).optional(), fx_date: z.string().max(40).nullable().optional(),
  per_request_usd: z.number().min(0).max(1000).optional(), daily_usd: z.number().min(0).max(100000).optional(), monthly_usd: z.number().min(0).max(1000000).optional(),
  max_unpriced_runs_per_day: z.number().int().min(0).max(1000).optional(), retention_days: z.number().int().min(1).max(90).optional(),
  max_active_runs: z.number().int().min(1).max(6).optional(), max_runs_per_request: z.number().int().min(1).max(6).optional(), enforce_sequence: z.boolean().optional(),
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
    const input = z.object({ name: z.string().trim().min(2).max(80), type: z.enum(['wavespeed', 'fal', 'openai', 'openai_compatible', '9router', 'recraft', 'runway', 'custom_rest']), base_url: z.string().trim().max(300).optional(), auth_method: z.enum(['bearer', 'key_header']).optional() }).strict().parse(body);
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
    return { baseUrl: p.base_url, secret, authMethod: p.auth_method, http: this.d.http ? this.d.http(host) : new SafeHttp(host, this.d.policy), cacheKey: p.id, sleep: this.d.sleep, timeoutMs: this.d.timeoutMs, pollIntervalMs: this.d.pollIntervalMs };
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
    const { id: _i, status: _s, last_tested_at: _l, created_at: _c, updated_at: _u, verification: _v, ...rest } = (existing ?? {}) as LabModel;
    const input = modelBody.parse(id ? { ...rest, ...(body as object) } : body);
    await this.provider(input.provider_id);
    let pricing: Pricing;
    try { pricing = input.pricing === undefined ? existing?.pricing ?? emptyPricing() : validatePricing(input.pricing); } catch (e) { throw new LabError(422, 'LAB_PRICING_INVALID', (e as Error).message); }
    const now = this.iso();
    const model: LabModel = { id: existing?.id ?? newId(), provider_id: input.provider_id, model_id: input.model_id, display_name: input.display_name, tasks: input.tasks, sizes: input.sizes,
      max_reference_images: input.max_reference_images, supports: input.supports, pricing, status: existing?.status ?? 'untested', enabled: input.enabled, last_tested_at: existing?.last_tested_at ?? null, created_at: existing?.created_at ?? now, updated_at: now,
      params: input.params ?? existing?.params, prompt_max: input.prompt_max ?? existing?.prompt_max ?? null, sequence: input.sequence ?? existing?.sequence ?? null, notes: input.notes ?? existing?.notes ?? '',
      schema_source: input.schema_source ?? existing?.schema_source, schema_verified_at: input.schema_verified_at ?? existing?.schema_verified_at ?? null,
      ...(input.catalog_version ?? existing?.catalog_version ? { catalog_version: input.catalog_version ?? existing?.catalog_version } : {}), ...(input.image_field ?? existing?.image_field ? { image_field: input.image_field ?? existing?.image_field } : {}), ...(input.ref_style ?? existing?.ref_style ? { ref_style: input.ref_style ?? existing?.ref_style } : {}),
      verification: existing?.verification ?? { status: 'unverified', note: '', run_id: null, difference_usd: null, at: null, by: null } };
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
    const input = z.object({ model_ref: z.string().min(1), reference_images: z.number().int().min(0).max(16).default(0), size: z.string().max(24).optional(), quality: z.string().max(24).optional(), count: z.number().int().min(1).max(20).default(1) }).parse(body);
    const model = await this.model(input.model_ref), settings = await this.settings();
    const size = this.sizeOf(input.size);
    const est = estimate(model.pricing, { reference_images: input.reference_images, ...(size ?? {}), count: input.count, ...(input.quality ? { quality: input.quality } : {}) });
    return { estimate: est, estimated_idr: this.toIdr(est.usd, settings), fx: { rate: settings.fx_usd_to_idr, source: settings.fx_source, date: settings.fx_date, stale: settings.fx_stale }, pricing: { source: model.pricing.source, verified_at: model.pricing.verified_at, currency: 'USD' }, budget: await this.budget() };
  }
  // What a run counts against the Lab budget. Provider-confirmed billing wins; otherwise the authorised quote; pending/ambiguous
  // submissions hold their reservation until reconciled.
  private finalBilling(run: LabRun) { const b = run.billing; return b && (b.status === 'confirmed' || b.status === 'adjusted' || b.status === 'manual') ? b.confirmed_usd : null; }
  private spent(run: LabRun) {
    const final = this.finalBilling(run);
    if (final !== null) return final;
    if (run.status === 'SUCCEEDED') {
      const base = run.cost.provider_reported_usd ?? run.cost.calculated_usd ?? run.cost.estimated_usd ?? 0;
      return run.billing?.status === 'review' && run.billing.net_known_usd !== null ? Math.max(base, run.billing.net_known_usd) : base;
    }
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
    return { limits: { per_request_usd: settings.per_request_usd, daily_usd: settings.daily_usd, monthly_usd: settings.monthly_usd, max_unpriced_runs_per_day: settings.max_unpriced_runs_per_day, max_active_runs: settings.max_active_runs, max_runs_per_request: settings.max_runs_per_request }, spent: this.totals(await this.d.store.list<LabRun>('run', 5000)) };
  }

  // ---- runs ---------------------------------------------------------------------------------------------------
  private legacySpecs(model: LabModel): ParamSpec[] {
    const out: ParamSpec[] = [];
    if (model.supports.size) out.push({ name: 'size', label: 'Size', type: model.sizes.length ? 'enum' : 'text', ...(model.sizes.length ? { values: model.sizes } : {}), billing_relevant: true });
    if (model.supports.quality.length) out.push({ name: 'quality', label: 'Quality', type: 'enum', values: model.supports.quality, billing_relevant: true });
    if (model.supports.seed) out.push({ name: 'seed', label: 'Seed', type: 'int' });
    if (model.supports.output_format.length) out.push({ name: 'output_format', label: 'Output format', type: 'enum', values: model.supports.output_format });
    return out;
  }
  paramSpecs(model: LabModel): ParamSpec[] { return model.params ?? this.legacySpecs(model); }
  private checkParam(spec: ParamSpec, value: unknown): string | number | boolean | undefined {
    if (spec.type === 'bool') return typeof value === 'boolean' ? value : undefined;
    if (spec.type === 'int') { const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value; return typeof n === 'number' && Number.isSafeInteger(n) && (spec.min === undefined || n >= spec.min) && (spec.max === undefined || n <= spec.max) ? n : undefined; }
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const text = String(value);
    if (spec.type === 'enum') return spec.values?.includes(text) ? text : undefined;
    if (spec.pattern && !new RegExp(spec.pattern).test(text)) return undefined;
    if (spec.side_range) { const sides = text.split(/[*x]/).map(Number); if (sides.length !== 2 || sides.some(n => !(n >= spec.side_range![0] && n <= spec.side_range![1]))) return undefined; }
    return text.length <= 40 ? text : undefined;
  }
  private async prepare(input: RunInput) {
    const model = await this.model(input.model_ref), provider = await this.provider(model.provider_id);
    if (!provider.enabled || !provider.secret_enc) throw new LabError(409, 'LAB_PROVIDER_NOT_READY', 'Provider is disabled or has no credential.');
    if (!model.enabled) throw new LabError(409, 'LAB_MODEL_DISABLED', 'This model is disabled.');
    const adapter = this.d.adapters[provider.type];
    if (!adapter) throw new LabError(501, 'LAB_ADAPTER_UNAVAILABLE', 'No safe adapter exists for this provider type yet.');
    let prompt = z.string().trim().min(1).max(input.scenario ? 20000 : 4000).parse(input.prompt);
    // Adapt scenario prompts to the model instead of refusing: a condensed prompt for models with a length cap, and the model's own
    // wording for reference images. The production prompt itself is untouched.
    const adapted: string[] = [];
    if (input.scenario && model.prompt_max && prompt.length > model.prompt_max && input.scenario.compact_prompt && input.scenario.compact_prompt.length <= model.prompt_max) { prompt = input.scenario.compact_prompt.trim(); adapted.push(`condensed prompt (model limit ${model.prompt_max} characters)`); }
    if (input.scenario && model.ref_style) { prompt = prompt.replace(/\bImage (\d+)\b/g, model.ref_style === 'figure' ? 'Figure $1' : '<Picture $1>'); adapted.push(`input images named ${model.ref_style === 'figure' ? '"Figure N"' : '"<Picture N>"'}`); }
    if (model.prompt_max && prompt.length > model.prompt_max) throw new LabError(422, 'LAB_PROMPT_TOO_LONG', `This model accepts prompts up to ${model.prompt_max} characters (yours has ${prompt.length}).`);
    const imageTask = model.tasks.some(t => t !== 'text-to-image');
    if (input.images.length && !imageTask) throw new LabError(422, 'LAB_INPUT_UNSUPPORTED', 'This model does not accept input images.');
    if (!input.images.length && !model.tasks.includes('text-to-image')) throw new LabError(422, 'LAB_INPUT_REQUIRED', 'This model needs at least one input image.');
    if (input.images.length > model.max_reference_images) throw new LabError(422, 'LAB_INPUT_LIMIT', `This model accepts at most ${model.max_reference_images} input images.`);
    const valid: (ValidImage & { role: ImageInput['role'] })[] = [];
    for (const image of input.images) valid.push({ ...await validateImage(image.bytes, { maxBytes: this.d.maxUploadBytes }), role: image.role });
    // Only parameters present in the model's verified schema, with valid values, are ever sent; everything else is dropped.
    const specs = this.paramSpecs(model), ignored: string[] = [], params: Record<string, string | number | boolean> = {};
    const requested: Record<string, unknown> = { size: input.size, quality: input.quality, seed: input.seed, output_format: input.output_format, ...(input.params ?? {}) };
    for (const [name, value] of Object.entries(requested)) {
      if (value === undefined || value === null || value === '') continue;
      const spec = specs.find(item => item.name === name), checked = spec ? this.checkParam(spec, value) : undefined;
      if (checked === undefined) ignored.push(name); else params[name] = checked;
    }
    const negative = model.supports.negative_prompt ? (input.negative_prompt ?? '').slice(0, 2000) : '';
    if (input.negative_prompt && !model.supports.negative_prompt) ignored.push('negative_prompt');
    // Scenario runs use the production canvas, formatted the way each provider expects.
    const production = input.scenario?.production_size ?? null;
    if (production) {
      const spec = specs.find(item => item.name === 'size'), wire = `${production.width}${provider.type === 'wavespeed' ? '*' : 'x'}${production.height}`;
      // An explicit, valid size from the admin wins; otherwise the production canvas.
      if (spec && params.size === undefined) { if (this.checkParam(spec, wire) !== undefined) params.size = wire; else ignored.push('size'); }
      // Models that take an aspect ratio instead of a pixel size (Seedream, Nano Banana, GPT Image) get the production canvas ratio.
      const ratioSpec = specs.find(item => item.name === 'aspect_ratio');
      if (!spec && ratioSpec) {
        const divisor = (a: number, b: number): number => b ? divisor(b, a % b) : a, g = divisor(production.width, production.height), ratio = `${production.width / g}:${production.height / g}`;
        if (this.checkParam(ratioSpec, ratio) !== undefined) params.aspect_ratio = ratio; else ignored.push('aspect_ratio');
      }
    }
    const size = production ?? this.sizeOf(typeof params.size === 'string' ? params.size : undefined, valid[0] ? { width: valid[0].width, height: valid[0].height } : undefined);
    const est = estimate(model.pricing, { reference_images: Math.max(0, valid.length - 1), ...(size ?? {}), ...(typeof params.quality === 'string' ? { quality: params.quality } : {}) });
    return { model, provider, adapter, prompt, negative, valid, params, ignored, est, adapted, scenario: input.scenario ?? null };
  }
  private adapterRequest(p: Prepared, extra: Partial<AdapterRequest> = {}): AdapterRequest {
    const legacy: Partial<AdapterRequest> = {};
    if (typeof p.params.size === 'string') legacy.size = p.params.size;
    if (typeof p.params.quality === 'string') legacy.quality = p.params.quality;
    if (typeof p.params.seed === 'number') legacy.seed = p.params.seed;
    if (typeof p.params.output_format === 'string') legacy.output_format = p.params.output_format;
    return { model_id: p.model.model_id, prompt: p.prompt, images: p.valid.map(i => ({ bytes: i.bytes, contentType: i.contentType, width: i.width, height: i.height, role: i.role })),
      ...(p.negative ? { negative_prompt: p.negative } : {}), ...legacy, params: p.params, ...(p.model.image_field ? { image_field: p.model.image_field } : {}), ...extra };
  }
  // Request-specific price. Providers with a pricing API are asked every time (non-billable); a failed quotation is "Pricing Unavailable",
  // never replaced by a base or configured price. Providers without one use the Admin-configured price schedule.
  private async priceOf(p: Prepared): Promise<{ known: boolean; usd: number | null; quote: RunQuote | null; unavailable: boolean; reason?: string }> {
    const quoted_at = this.iso(), refs = Math.max(0, p.valid.length - 1);
    if (p.adapter.quote) {
      let q;
      try { q = await p.adapter.quote(this.context(p.provider, this.d.vault.decrypt(p.provider.secret_enc!)), this.adapterRequest(p)); }
      catch (error) { q = { available: false as const, original_usd: null, discounted_usd: null, payable_percent: null, currency: 'USD', reason: error instanceof LabError ? error.message : 'Pricing could not be obtained.' }; }
      if (!q.available || q.discounted_usd === null || q.original_usd === null) return { known: false, usd: null, quote: null, unavailable: true, reason: q.reason ?? 'Pricing Unavailable' };
      const payable = q.payable_percent;
      return { known: true, usd: q.discounted_usd, unavailable: false, quote: { source: 'provider', quoted_at, original_usd: q.original_usd, discounted_usd: q.discounted_usd, payable_percent: payable,
        effective_discount_percent: payable === null ? null : Math.round((100 - payable) * 100) / 100, currency: q.currency, params: { ...p.params }, base_price_usd: q.base?.price ?? null, base_discounted_usd: q.base?.discounted_price ?? null, images: p.valid.length } };
    }
    return { known: p.est.known, usd: p.est.usd, unavailable: false, reason: p.est.reason, quote: p.est.known ? { source: 'configured', quoted_at, original_usd: p.est.usd, discounted_usd: p.est.usd, payable_percent: 100, effective_discount_percent: 0, currency: 'USD',
      params: { ...p.params }, base_price_usd: null, base_discounted_usd: null, images: refs + (p.valid.length ? 1 : 0) } : null };
  }
  private async assertSequence(model: LabModel, settings: LabSettings) {
    if (!settings.enforce_sequence || model.sequence === null || model.sequence === undefined) return;
    const blockers = (await this.listModels()).filter(m => m.provider_id === model.provider_id && typeof m.sequence === 'number' && m.sequence < model.sequence! && (m.verification?.status ?? 'unverified') === 'unverified').sort((a, b) => a.sequence! - b.sequence!);
    if (blockers[0]) throw new LabError(409, 'LAB_SEQUENCE_BLOCKED', `Validate ${blockers[0].display_name} first (mark it verified or blocked) before testing ${model.display_name}.`);
  }
  // Non-billable preview: what the provider would charge for exactly these inputs, plus budget status.
  async quoteRun(input: RunInput) {
    const p = await this.prepare(input), settings = await this.settings(), priced = await this.priceOf(p), budget = await this.budget();
    let blocked: string | null = null;
    try { await this.assertSequence(p.model, settings); } catch (e) { blocked = (e as LabError).message; }
    const usd = priced.usd, base = priced.quote?.base_discounted_usd ?? null;
    return { available: priced.known, source: priced.quote?.source ?? null, reason: priced.reason ?? null, unavailable: priced.unavailable, quote: priced.quote, usd, idr: this.toIdr(usd, settings),
      fx: { rate: settings.fx_usd_to_idr, source: settings.fx_source, date: settings.fx_date, stale: settings.fx_stale },
      comparison_to_base: priced.quote?.source === 'provider' && base !== null && usd !== null ? { base_discounted_usd: base, difference_usd: Math.round((usd - base) * 1e6) / 1e6, equal: Math.abs(usd - base) < 1e-9 } : null,
      params_sent: p.params, ignored: p.ignored, adapted: p.adapted, images: p.valid.length, budget, blocked_reason: blocked,
      within_limits: { per_request: usd === null || usd <= settings.per_request_usd, daily: usd === null || budget.spent.today_usd + usd <= settings.daily_usd, monthly: usd === null || budget.spent.month_usd + usd <= settings.monthly_usd } };
  }
  async createRuns(inputs: RunInput[], actor: Actor, confirmedTotal: { confirm?: boolean; total_usd?: number | null; acknowledge_unknown_cost?: boolean; override_reason?: string }) {
    const settings = await this.settings();
    if (!inputs.length || inputs.length > 6) throw new LabError(422, 'LAB_RUN_COUNT', 'Run between 1 and 6 models at a time.');
    if (inputs.length > settings.max_runs_per_request) throw new LabError(409, 'LAB_BATCH_DISABLED', `Batch generation is off: this Lab allows ${settings.max_runs_per_request} paid generation(s) per request. Raise "Runs per request" in Settings to compare models.`);
    await this.purgeExpired();
    const prepared: Prepared[] = [], prices: Awaited<ReturnType<LabService['priceOf']>>[] = [];
    for (const input of inputs) { const p = await this.prepare(input); await this.assertSequence(p.model, settings); prepared.push(p); prices.push(await this.priceOf(p)); }
    const unavailable = prices.findIndex(price => price.unavailable);
    if (unavailable >= 0) throw new LabError(409, 'LAB_PRICING_UNAVAILABLE', `Pricing Unavailable for ${prepared[unavailable]!.model.display_name}: ${prices[unavailable]!.reason ?? 'the provider could not quote this request'}. No generation was submitted.`);
    // 1. Explicit confirmation of the provider-quoted amount (the client cannot pick the number).
    const known = prices.every(price => price.known), total = known ? Math.round(prices.reduce((s, price) => s + price.usd!, 0) * 1e6) / 1e6 : null;
    if (confirmedTotal.confirm !== true) throw new LabError(409, 'LAB_CONFIRMATION_REQUIRED', 'Explicit confirmation is required before a paid generation.');
    if (known) { if (typeof confirmedTotal.total_usd !== 'number' || Math.abs(confirmedTotal.total_usd - total!) > 1e-6) throw new LabError(409, 'LAB_ESTIMATE_CHANGED', `The quoted price is now ${total} USD. Review and confirm again.`); }
    else if (confirmedTotal.acknowledge_unknown_cost !== true) throw new LabError(409, 'LAB_UNKNOWN_COST_UNCONFIRMED', 'Pricing is unknown for this model. Acknowledge that the cost cannot be estimated to continue.');
    const overrideReason = (confirmedTotal.override_reason ?? '').trim();
    const created = await this.d.store.locked(async store => {
      // 2. Budget + concurrency check and reservation under one lock so concurrent requests cannot both pass.
      const all = await store.list<LabRun>('run', 5000), totals = this.totals(all), reasons: string[] = [];
      for (const r of all) await this.sweepStale(r, store);
      const active = all.filter(r => r.status === 'RESERVED' || r.status === 'PROCESSING').length;
      if (active + inputs.length > settings.max_active_runs) throw new LabError(409, 'LAB_BUSY', `A paid generation is already running (limit ${settings.max_active_runs} at a time). Wait for it to finish.`);
      if (known) {
        if (prices.some(price => price.usd! > settings.per_request_usd)) reasons.push(`a request exceeds the per-request ceiling of ${settings.per_request_usd} USD`);
        if (totals.today_usd + total! > settings.daily_usd) reasons.push(`daily Lab limit of ${settings.daily_usd} USD would be exceeded (spent or reserved ${totals.today_usd})`);
        if (totals.month_usd + total! > settings.monthly_usd) reasons.push(`monthly Lab limit of ${settings.monthly_usd} USD would be exceeded (spent or reserved ${totals.month_usd})`);
      }
      const unpriced = prices.filter(price => !price.known).length;
      if (unpriced && totals.unpriced_today + unpriced > settings.max_unpriced_runs_per_day) reasons.push(`more than ${settings.max_unpriced_runs_per_day} runs with unknown pricing today`);
      let override: LabRun['override'] = null;
      if (reasons.length) {
        if (overrideReason.length < 10) throw new LabError(402, 'LAB_BUDGET_EXCEEDED', `Budget exceeded: ${reasons.join('; ')}. A superadmin may override with a written reason.`);
        if (actor.role !== 'superadmin') throw new LabError(403, 'ADMIN_FORBIDDEN', 'Only a superadmin can override Lab spending limits.');
        override = { reason: overrideReason.slice(0, 300), actor: actor.actor_id };
      }
      const runs: LabRun[] = [];
      for (const [index, p] of prepared.entries()) {
        const id = newId(), now = this.iso(), price = prices[index]!;
        const run: LabRun = { id, provider_id: p.provider.id, provider_name: p.provider.name, provider_type: p.provider.type, model_ref: p.model.id, model_id: p.model.model_id, model_name: p.model.display_name,
          status: 'RESERVED', prompt: p.prompt, negative_prompt: p.negative, params: { ...p.params, ...(p.ignored.length ? { ignored_unsupported: p.ignored } : {}), ...(p.adapted.length ? { prompt_adapted: p.adapted } : {}) }, inputs: [], output: null,
          cost: { estimated_usd: price.usd, provider_reported_usd: null, calculated_usd: null, basis: price.quote?.source === 'provider' ? 'provider price quotation (not yet billed)' : price.known ? 'estimated from configured pricing' : 'pricing unknown' },
          reserved_usd: price.usd ?? 0, unpriced: !price.known, override, duration_ms: null, provider_request_id: null, error_code: null, error_message: null, usage: null,
          session_id: inputs[index]!.session_id ?? null, rating: null, raw_output: null, quote: price.quote,
          billing: { status: 'not_started', records: [], confirmed_usd: null, net_known_usd: null, checked_at: null, attempts: 0, message: '' }, tokens: null,
          scenario: p.scenario ? { kind: p.scenario.kind, label: p.scenario.label, production_model: p.scenario.production_model, meta: p.scenario.meta } : null, created_by: actor.actor_id, created_at: now, finished_at: null,
          expires_at: new Date(this.d.now().getTime() + settings.retention_days * 86400000).toISOString() };
        await store.put('run', id, run); runs.push(run);
      }
      return runs;
    });
    await this.d.audit(actor, 'lab.paid_execution', 'lab_run', created.map(r => r.id).join(','), overrideReason, { quoted_usd: total, models: created.map(r => r.model_name), override: Boolean(created[0]?.override) });
    if (created[0]?.override) await this.d.audit(actor, 'lab.budget_override', 'lab_run', created[0].id, overrideReason, { quoted_usd: total });
    // 3. Submit once per run in the background; the caller polls GET /runs/:id.
    const done = created.map((run, index) => this.execute(run, prepared[index]!, actor));
    return { runs: created, done: Promise.all(done), estimate_usd: total };
  }
  private tokensOf(usage: Record<string, number> | null | undefined): RunTokens {
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    if (usage && (ok(usage.input_tokens) || ok(usage.output_tokens) || ok(usage.total_tokens)))
      return { availability: 'reported', source: 'provider response usage', input: ok(usage.input_tokens) ? usage.input_tokens : null, output: ok(usage.output_tokens) ? usage.output_tokens : null, total: ok(usage.total_tokens) ? usage.total_tokens : null };
    return { availability: 'not_reported', source: null, input: null, output: null, total: null }; // never derived from prices
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
      const request = this.adapterRequest(p, { onSubmitted: id => save({ provider_request_id: id }) }); // the prediction id is persisted before polling
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
        basis: result.reported_cost_usd !== undefined ? 'provider-reported' : calculated !== null ? 'calculated from measured usage and configured prices' : run.quote?.source === 'provider' ? 'provider quotation; awaiting billing record' : run.cost.estimated_usd !== null ? 'estimate only; the provider did not expose the billed amount' : 'pricing unknown' };
      await save({ status: 'SUCCEEDED', raw_output: raw, output: { file, content_type: shown.contentType, width: shown.width, height: shown.height }, cost, usage, tokens: this.tokensOf(usage),
        provider_request_id: result.request_id ?? run.provider_request_id, duration_ms: result.inference_ms ?? Date.now() - started, finished_at: this.iso() });
      p.model.status = 'ok'; p.model.last_tested_at = this.iso(); await this.d.store.put('model', p.model.id, p.model);
      const provider = await this.d.store.get<LabProvider>('provider', p.provider.id);
      if (provider) { provider.last_success_at = this.iso(); await this.d.store.put('provider', provider.id, provider); }
      if (this.d.autoBilling && p.adapter.billing && run.provider_request_id) void this.autoReconcile(run.id);
    } catch (error) {
      const known = error instanceof LabError, ambiguous = known && error.code === 'LAB_SUBMIT_AMBIGUOUS';
      // An ambiguous submission is never retried; it keeps its budget reservation until billing is reconciled or an admin resolves it.
      await save({ status: ambiguous ? 'AMBIGUOUS' : 'FAILED', error_code: known ? error.code : 'LAB_RUN_ERROR', error_message: known ? redact(error.message, [secret]) : 'The generation failed unexpectedly.', duration_ms: Date.now() - started, finished_at: this.iso() }).catch(() => undefined);
      if (!ambiguous && run.provider_request_id && p.adapter.billing && this.d.autoBilling) void this.autoReconcile(run.id);
      p.model.status = 'failing'; p.model.last_tested_at = this.iso(); await this.d.store.put('model', p.model.id, p.model).catch(() => undefined);
    }
  }

  // ---- billing reconciliation ---------------------------------------------------------------------------------
  private applyBilling(run: LabRun, lookup: BillingLookup) {
    const previous = run.billing ?? { status: 'not_started', records: [], confirmed_usd: null, net_known_usd: null, checked_at: null, attempts: 0, message: '' } as RunBilling;
    const b: RunBilling = { ...previous, attempts: previous.attempts + 1, checked_at: this.iso() };
    if (lookup.access === 'denied') { b.status = 'access_denied'; b.message = lookup.message ?? 'Billing access denied.'; }
    else if (lookup.access === 'error') { if (!['confirmed', 'adjusted', 'manual'].includes(b.status)) b.status = 'error'; b.message = lookup.message ?? 'Billing lookup failed.'; }
    else {
      const seen = new Set<string>(), records = lookup.records.filter(r => !seen.has(r.uuid) && seen.add(r.uuid)); // duplicate responses collapse by record uuid
      const deducts = records.filter(r => r.billing_type === 'deduct'), refunds = records.filter(r => /refund|reversal|return/i.test(r.billing_type)), others = records.filter(r => !deducts.includes(r) && !refunds.includes(r));
      const sum = (rs: typeof records) => Math.round(rs.reduce((a, r) => a + r.price, 0) * 1e6) / 1e6, net = Math.round((sum(deducts) - sum(refunds)) * 1e6) / 1e6;
      b.records = records;
      if (!records.length) {
        const age = this.d.now().getTime() - new Date(run.finished_at ?? run.created_at).getTime();
        b.status = age > 24 * 3600 * 1000 ? 'not_found' : 'pending'; b.confirmed_usd = null; b.net_known_usd = null;
        b.message = b.status === 'pending' ? 'No billing record yet (records can be delayed). Check again shortly.' : 'No billing record was found after 24 hours. Verify in the WaveSpeed dashboard.';
      } else if (others.length || (!deducts.length && refunds.length) || net < 0) {
        b.status = 'review'; b.confirmed_usd = null; b.net_known_usd = net; b.message = `Billing needs review: ${others.length ? `unrecognised record type(s) ${[...new Set(others.map(r => r.billing_type))].join(', ')}` : 'refund without a charge'}.`;
      } else if (deducts.length > 1 && !refunds.length) {
        b.status = 'review'; b.confirmed_usd = null; b.net_known_usd = net; b.message = `${deducts.length} separate charges were recorded for this prediction (total ${net} USD). Review before trusting this cost.`;
      } else if (refunds.length) {
        b.status = 'adjusted'; b.confirmed_usd = net; b.net_known_usd = net; b.message = `Charge adjusted by ${refunds.length} refund record(s). Net ${net} USD.`;
      } else { b.status = 'confirmed'; b.confirmed_usd = net; b.net_known_usd = net; b.message = 'Confirmed by the provider billing record.'; }
    }
    run.billing = b;
    if (b.confirmed_usd !== null) run.cost = { ...run.cost, basis: 'confirmed by provider billing record' };
    return b;
  }
  async reconcileBilling(id: string, actor?: Actor) {
    const run = await this.getRun(id), provider = await this.provider(run.provider_id), adapter = this.d.adapters[provider.type];
    if (!adapter?.billing || !provider.secret_enc) throw new LabError(501, 'LAB_BILLING_UNSUPPORTED', 'This provider has no billing lookup.');
    const secret = this.d.vault.decrypt(provider.secret_enc), ctx = this.context(provider, secret);
    if (!run.provider_request_id) {
      // Ambiguous submission: look for exactly one new prediction of this model in the billing window around the request.
      if (run.status !== 'AMBIGUOUS' || !adapter.billingWindow) throw new LabError(409, 'LAB_NO_PREDICTION', 'This run has no prediction id to reconcile.');
      const from = new Date(new Date(run.created_at).getTime() - 60000).toISOString(), to = new Date(this.d.now().getTime() + 60000).toISOString();
      const lookup = await adapter.billingWindow(ctx, run.model_id, from, to), known = new Set((await this.d.store.list<LabRun>('run', 5000)).map(r => r.provider_request_id).filter(Boolean));
      const found = [...new Set(lookup.records.filter(r => r.prediction_uuid && !known.has(r.prediction_uuid) && r.created_at >= from).map(r => r.prediction_uuid!))];
      if (lookup.access !== 'ok') { run.billing = { ...(run.billing as RunBilling), status: lookup.access === 'denied' ? 'access_denied' : 'error', message: lookup.message ?? '', checked_at: this.iso(), attempts: (run.billing?.attempts ?? 0) + 1 }; }
      else if (found.length === 1) { run.provider_request_id = found[0]!; run.error_message = 'Prediction found through billing; use Re-check result to fetch the output.'; this.applyBilling(run, { access: 'ok', records: lookup.records.filter(r => r.prediction_uuid === found[0]) }); }
      else run.billing = { ...(run.billing as RunBilling), status: 'pending', checked_at: this.iso(), attempts: (run.billing?.attempts ?? 0) + 1, message: found.length ? `${found.length} candidate predictions match; cannot choose safely. Resolve manually.` : 'No matching billing record found yet.' };
    } else this.applyBilling(run, await adapter.billing(ctx, run.provider_request_id));
    await this.d.store.put('run', run.id, run);
    if (actor) await this.d.audit(actor, 'lab.billing_reconcile', 'lab_run', run.id, '', { status: run.billing?.status });
    return this.withIdr(run);
  }
  private async autoReconcile(id: string) {
    for (const delay of [4000, 12000, 30000, 90000]) {
      await this.d.sleep(delay);
      try { const view = await this.reconcileBilling(id); if (view.billing && view.billing.status !== 'pending' && view.billing.status !== 'error' && view.billing.status !== 'not_started') return; } catch { return; }
    }
  }
  // Non-billable result lookup for runs whose output was lost (timeouts, recovered ambiguous submissions).
  async recheckResult(id: string, actor: Actor) {
    const run = await this.getRun(id), provider = await this.provider(run.provider_id), adapter = this.d.adapters[provider.type];
    if (!adapter?.result || !run.provider_request_id || !provider.secret_enc) throw new LabError(409, 'LAB_NO_PREDICTION', 'This run has no prediction id to look up.');
    if (run.status === 'SUCCEEDED' && run.output) return this.withIdr(run);
    const state = await adapter.result(this.context(provider, this.d.vault.decrypt(provider.secret_enc)), run.provider_request_id);
    if (state.state === 'completed' && state.image) {
      const valid = await validateImage(state.image.bytes, { maxBytes: 40 * 1024 * 1024, minSide: 16, maxSide: 12000 }), file = `out.${valid.ext}`;
      await this.d.files.write(run.id, file, valid.bytes);
      Object.assign(run, { status: 'SUCCEEDED', error_code: null, error_message: null, output: { file, content_type: valid.contentType, width: valid.width, height: valid.height }, tokens: this.tokensOf(null),
        duration_ms: run.duration_ms ?? state.inference_ms ?? null, finished_at: this.iso() });
    } else if (state.state === 'failed') Object.assign(run, { status: 'FAILED', error_code: 'LAB_PROVIDER_FAILED', error_message: `WaveSpeed prediction ${state.status}${state.error ? `: ${state.error}` : ''}` });
    else run.error_message = `Prediction is still ${state.status}. Check again shortly.`;
    await this.d.store.put('run', run.id, run);
    await this.d.audit(actor, 'lab.result_recheck', 'lab_run', run.id, '', { state: state.state });
    return this.withIdr(run);
  }
  async resolveAmbiguous(id: string, body: unknown, actor: Actor) {
    const input = z.object({ outcome: z.enum(['not_billed', 'billed']), actual_usd: z.number().min(0).max(1000).optional(), reason: z.string().trim().min(10).max(300) }).strict().parse(body), run = await this.getRun(id);
    if (run.status !== 'AMBIGUOUS') throw new LabError(409, 'LAB_NOT_AMBIGUOUS', 'Only ambiguous submissions can be resolved manually.');
    if (input.outcome === 'billed' && input.actual_usd === undefined) throw new LabError(422, 'LAB_AMOUNT_REQUIRED', 'Enter the amount billed.');
    const amount = input.outcome === 'billed' ? input.actual_usd! : 0;
    Object.assign(run, { status: 'FAILED', error_code: input.outcome === 'billed' ? 'LAB_SUBMIT_BILLED_MANUAL' : 'LAB_SUBMIT_NOT_BILLED', error_message: `Resolved manually: ${input.reason}`,
      billing: { status: 'manual', records: [], confirmed_usd: amount, net_known_usd: amount, checked_at: this.iso(), attempts: (run.billing?.attempts ?? 0), message: `Manually resolved by an administrator (${input.outcome}).` } });
    await this.d.store.put('run', run.id, run);
    await this.d.audit(actor, 'lab.ambiguous_resolve', 'lab_run', run.id, input.reason, { outcome: input.outcome, amount_usd: amount });
    return this.withIdr(run);
  }

  // ---- model registration, one-by-one verification ---------------------------------------------------------------
  async seedWavespeedModels(providerId: string, actor: Actor) {
    const provider = await this.provider(providerId);
    if (provider.type !== 'wavespeed') throw new LabError(422, 'LAB_PROVIDER_TYPE', 'The WaveSpeed candidate catalog applies to WaveSpeedAI providers only.');
    const existing = (await this.listModels()).filter(m => m.provider_id === providerId), have = new Map(existing.map(m => [m.model_id, m])), created: LabModel[] = [], skipped: string[] = [], updated: string[] = [];
    for (const model of wavespeedCatalog(providerId, newId, this.iso())) {
      const current = have.get(model.model_id);
      if (!current) { await this.d.store.put('model', model.id, model); created.push(model); continue; } // registration never contacts the provider or submits a request
      if ((current.catalog_version ?? 1) < CATALOG_VERSION) {
        // Refresh catalog-owned schema fields; keep the admin's enabled flag, pricing, status and verification.
        await this.d.store.put('model', current.id, { ...current, params: model.params, prompt_max: model.prompt_max, max_reference_images: model.max_reference_images, tasks: model.tasks, supports: model.supports,
          notes: model.notes, image_field: model.image_field, ref_style: model.ref_style, schema_source: model.schema_source, schema_verified_at: model.schema_verified_at, catalog_version: CATALOG_VERSION, updated_at: this.iso() });
        updated.push(model.model_id);
      } else skipped.push(model.model_id);
    }
    await this.d.audit(actor, 'lab.models_seed', 'lab_provider', providerId, '', { created: created.length, updated: updated.length, skipped: skipped.length });
    return { created: created.length, updated, skipped, models: await this.listModels() };
  }
  // Generic registration for every provider. WaveSpeed keeps its schema catalog; other providers get curated candidates
  // (filtered to what the account can actually list when the provider has a model-list endpoint) plus any image models
  // discovered live. Never submits a generation; models without a published price are registered as Pricing Unknown.
  async registerModels(providerId: string, actor: Actor) {
    const provider = await this.provider(providerId);
    if (provider.type === 'wavespeed') return { ...(await this.seedWavespeedModels(providerId, actor)), discovered: false, unavailable: [] as string[], note: '' };
    if (provider.type === 'custom_rest') throw new LabError(422, 'LAB_PROVIDER_TYPE', 'Custom REST providers have no model list. Add models by hand.');
    const adapter = this.d.adapters[provider.type];
    let live: string[] | null = null, note = '';
    if (provider.type === '9router' && !provider.secret_enc) throw new LabError(409, 'LAB_CREDENTIAL_MISSING', 'Save a 9Router access key before registering its image models.');
    if (adapter?.discover && provider.secret_enc) {
      try { live = await adapter.discover(this.context(provider, this.d.vault.decrypt(provider.secret_enc))); }
      catch (error) { if (provider.type === '9router') throw error; note = `Live model list failed (${error instanceof LabError ? redact(error.message, [this.d.vault.decrypt(provider.secret_enc)], 120) : 'unreachable'}); registered the documented candidates instead.`; }
    } else if (adapter?.discover) note = 'No credential yet, so the live model list was not read; registered the documented candidates.';
    const have = new Set((await this.listModels()).filter(m => m.provider_id === providerId).map(m => m.model_id)), now = this.iso();
    const wanted: Candidate[] = [], unavailable: string[] = [];
    for (const c of STATIC_CANDIDATES[provider.type] ?? []) { if (live && !live.includes(c.model_id)) unavailable.push(c.model_id); else wanted.push(c); }
    if (live) for (const id of live.filter(i => (provider.type === '9router' || looksLikeImageModel(i, provider.type)) && !wanted.some(c => c.model_id === i))) {
      wanted.push({ model_id: id, name: id, kind: 'edit', max_images: /gpt-image|chatgpt-image/i.test(id) ? 16 : 1, size: true, ...(/gpt-image|chatgpt-image/i.test(id) ? { quality: ['low', 'medium', 'high'], output_format: ['png', 'jpeg', 'webp'] } : {}), notes: 'Discovered from the provider model list; capabilities are assumed, check them before relying on this model.' });
    }
    const created: LabModel[] = [], skipped: string[] = [];
    for (const c of wanted) {
      if (have.has(c.model_id)) { skipped.push(c.model_id); continue; }
      const model = candidateModel(providerId, provider.type, c, newId, now, !!live); await this.d.store.put('model', model.id, model); created.push(model);
    }
    await this.d.audit(actor, 'lab.models_register', 'lab_provider', providerId, '', { created: created.length, skipped: skipped.length, unavailable: unavailable.length, discovered: !!live });
    return { created: created.length, updated: [] as string[], skipped, unavailable, discovered: !!live, note, models: await this.listModels() };
  }
  async setVerification(modelId: string, body: unknown, actor: Actor) {
    const input = z.object({ status: z.enum(['verified', 'blocked', 'unverified']), run_id: z.string().regex(/^[a-f0-9]{32}$/).optional(), note: z.string().trim().max(500).default('') }).strict().parse(body), model = await this.model(modelId);
    let run_id: string | null = null, difference: number | null = null;
    if (input.status === 'verified') {
      const run = input.run_id ? await this.getRun(input.run_id) : null;
      if (!run || run.model_ref !== model.id || run.status !== 'SUCCEEDED' || !run.provider_request_id) throw new LabError(409, 'LAB_VERIFY_NEEDS_RUN', 'Verification needs a successful run of this model with a saved prediction id.');
      if (!run.billing || !['confirmed', 'adjusted'].includes(run.billing.status) || run.billing.confirmed_usd === null) throw new LabError(409, 'LAB_VERIFY_NEEDS_BILLING', 'Verification needs a confirmed provider billing record for that run. Reconcile billing first.');
      if (run.quote?.discounted_usd == null) throw new LabError(409, 'LAB_VERIFY_NEEDS_QUOTE', 'The run has no stored price quotation.');
      run_id = run.id; difference = Math.round((run.billing.confirmed_usd - run.quote.discounted_usd) * 1e6) / 1e6;
    } else if (input.status === 'blocked' && input.note.length < 5) throw new LabError(422, 'LAB_BLOCK_NOTE', 'Say why this model is blocked.');
    model.verification = { status: input.status, note: input.note, run_id, difference_usd: difference, at: this.iso(), by: actor.actor_id };
    model.updated_at = this.iso();
    await this.d.store.put('model', model.id, model);
    await this.d.audit(actor, 'lab.model_verification', 'lab_model', model.id, input.note, { status: input.status, run_id, difference_usd: difference });
    return model;
  }
  private async sweepStale(run: LabRun, store: LabStore = this.d.store) {
    if ((run.status === 'RESERVED' || run.status === 'PROCESSING') && this.d.now().getTime() - new Date(run.created_at).getTime() > this.d.timeoutMs + 120000) {
      Object.assign(run, { status: 'FAILED' as RunStatus, error_code: 'LAB_INTERRUPTED', error_message: 'The run was interrupted (service restart or timeout). The provider may still have billed it.', finished_at: this.iso() });
      await store.put('run', run.id, run);
    }
    return run;
  }
  async getRun(id: string) { const run = await this.d.store.get<LabRun>('run', id); if (!run) throw new LabError(404, 'LAB_RUN_NOT_FOUND', 'Test run not found.'); return this.sweepStale(run); }
  async runView(id: string) { return this.withIdr(await this.getRun(id)); }
  private async withIdr(run: LabRun) { const s = await this.settings(); const final = this.finalBilling(run), usd = final ?? run.cost.provider_reported_usd ?? run.cost.calculated_usd ?? run.cost.estimated_usd, est = run.quote?.discounted_usd ?? run.cost.estimated_usd;
    const label = final !== null ? 'Confirmed' : run.billing?.status === 'review' ? 'Review' : run.status === 'SUCCEEDED' && run.billing && ['pending', 'not_started', 'error'].includes(run.billing.status) ? 'Pending Billing' : run.billing && ['access_denied', 'not_found'].includes(run.billing.status) ? 'Unavailable' : est === null ? 'Unavailable' : 'Estimated';
    return { ...run, effective_cost_usd: usd, effective_cost_idr: this.toIdr(usd, s), estimated_idr: this.toIdr(est, s), cost_status: label, cost_difference_usd: final !== null && est !== null ? Math.round((final - est) * 1e6) / 1e6 : null }; }
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

  // ---- benchmark report ------------------------------------------------------------------------------------------
  // One row per model: quoted vs billing-confirmed cost, tokens (N/A unless the provider reported them), latency, ratings and
  // cost per accepted image. Nothing is inferred: missing values stay null.
  async report(threshold = 4) {
    const models = await this.listModels(), runs = await this.d.store.list<LabRun>('run', 5000), avg = (v: number[]) => v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 1e6) / 1e6 : null;
    const rows = models.map(m => {
      const rs = runs.filter(r => r.model_ref === m.id), ok = rs.filter(r => r.status === 'SUCCEEDED'), confirmed = rs.filter(r => this.finalBilling(r) !== null);
      const accepted = ok.filter(r => (r.rating?.scores.overall ?? 0) >= threshold), spend = rs.reduce((a, r) => a + this.spent(r), 0);
      const tok = ok.filter(r => r.tokens?.availability === 'reported'), sum = (k: 'input' | 'output' | 'total') => tok.length ? tok.reduce((a, r) => a + (r.tokens![k] ?? 0), 0) : null;
      const diffs = confirmed.map(r => this.finalBilling(r)! - (r.quote?.discounted_usd ?? r.cost.estimated_usd ?? NaN)).filter(Number.isFinite);
      return { model_ref: m.id, provider_id: m.provider_id, model_id: m.model_id, model: m.display_name, task: m.tasks.join(', '), sequence: m.sequence ?? null, verification: m.verification?.status ?? 'unverified',
        runs: rs.length, succeeded: ok.length, failed: rs.length - ok.length, avg_estimated_usd: avg(rs.map(r => r.quote?.discounted_usd ?? r.cost.estimated_usd).filter((x): x is number => typeof x === 'number')),
        confirmed_runs: confirmed.length, pending_billing: ok.filter(r => !this.finalBilling(r) && r.billing?.status !== 'access_denied').length, avg_confirmed_usd: avg(confirmed.map(r => this.finalBilling(r)!)),
        total_confirmed_usd: confirmed.length ? Math.round(confirmed.reduce((a, r) => a + this.finalBilling(r)!, 0) * 1e6) / 1e6 : null, avg_cost_difference_usd: avg(diffs),
        tokens: { reported_runs: tok.length, input: sum('input'), output: sum('output'), total: sum('total') }, avg_latency_ms: avg(ok.map(r => r.duration_ms).filter((x): x is number => x !== null)),
        rated: ok.filter(r => r.rating).length, avg_overall_rating: avg(ok.map(r => r.rating?.scores.overall).filter((x): x is number => typeof x === 'number')), accepted: accepted.length,
        total_spend_usd: Math.round(spend * 1e6) / 1e6, cost_per_accepted_usd: accepted.length ? Math.round(spend / accepted.length * 1e6) / 1e6 : null };
    }).filter(row => row.runs > 0 || row.sequence !== null || row.verification !== 'unverified').sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999) || a.model.localeCompare(b.model));
    return { threshold, rows, note: 'Estimated = provider price quotation (or configured price). Confirmed = provider billing record. Tokens are shown only when the provider reports them. Ratings are manual and subjective.' };
  }
  async reportCsv(threshold = 4) {
    const cell = (v: unknown) => { let t = v === null || v === undefined ? 'N/A' : String(v); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const header = ['model', 'task', 'sequence', 'verification', 'runs', 'succeeded', 'failed', 'avg_estimated_usd', 'confirmed_runs', 'pending_billing', 'avg_confirmed_usd', 'total_confirmed_usd', 'avg_cost_difference_usd',
      'tokens_reported_runs', 'tokens_input', 'tokens_output', 'tokens_total', 'avg_latency_ms', 'rated', 'avg_overall_rating', 'accepted', 'total_spend_usd', 'cost_per_accepted_usd'];
    const rows = (await this.report(threshold)).rows.map(r => [r.model, r.task, r.sequence, r.verification, r.runs, r.succeeded, r.failed, r.avg_estimated_usd, r.confirmed_runs, r.pending_billing, r.avg_confirmed_usd, r.total_confirmed_usd,
      r.avg_cost_difference_usd, r.tokens.reported_runs, r.tokens.input, r.tokens.output, r.tokens.total, r.avg_latency_ms, r.rated, r.avg_overall_rating, r.accepted, r.total_spend_usd, r.cost_per_accepted_usd].map(cell).join(','));
    return [header.join(','), ...rows].join('\n') + '\n';
  }

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
    const header = ['created_at', 'provider', 'model', 'status', 'duration_ms', 'estimated_usd', 'confirmed_usd', 'billing_status', 'tokens_total', 'provider_reported_usd', 'calculated_usd', 'cost_basis', 'output_width', 'output_height', 'error_code', 'rating_overall', 'session_id'];
    // Deliberately excludes prompts, image references, provider request ids and credentials.
    const rows = runs.map(r => [r.created_at, r.provider_name, r.model_name, r.status, r.duration_ms, r.quote?.discounted_usd ?? r.cost.estimated_usd, this.finalBilling(r), r.billing?.status ?? 'not_started', r.tokens?.total ?? 'N/A', r.cost.provider_reported_usd, r.cost.calculated_usd, r.cost.basis, r.output?.width, r.output?.height, r.error_code, r.rating?.scores.overall, r.session_id].map(cell).join(','));
    return [header.join(','), ...rows].join('\n') + '\n';
  }
}
export type { PriceEstimate };
