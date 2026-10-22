// AI Provider Lab shared types. The Lab is isolated from the production generation pipeline:
// nothing under src/lab imports production providers, queues, credits or customer models.
export type ProviderType = 'wavespeed' | 'fal' | 'openai' | 'openai_compatible' | '9router' | 'recraft' | 'runway' | 'custom_rest';
export type AuthMethod = 'bearer' | 'key_header';
export type Task = 'text-to-image' | 'image-to-image' | 'multi-reference-edit';

export type Pricing = {
  method: 'unknown' | 'per_image' | 'per_megapixel' | 'tokens' | 'compute_time' | 'provider_quote';
  currency: 'USD';
  per_image_usd?: number;
  per_megapixel_usd?: number;
  input_usd_per_million_tokens?: number;
  output_usd_per_million_tokens?: number;
  per_second_usd?: number;
  reference_image_fee_usd?: number;
  assumed_input_tokens?: number;
  assumed_output_tokens?: number;
  // Output tokens assumed per quality tier; when present the request's quality selects the estimate (a missing tier is Pricing Unknown).
  assumed_output_tokens_by_quality?: Record<string, number>;
  assumed_seconds?: number;
  source: string;
  verified_at: string | null;
  assumptions: string;
};

export type LabProvider = {
  id: string; name: string; type: ProviderType; base_url: string; auth_method: AuthMethod;
  secret_enc: string | null; secret_last4: string | null; secret_updated_at: string | null;
  enabled: boolean; last_success_at: string | null; last_test_status: 'untested' | 'ok' | 'failed'; last_test_message: string;
  created_at: string; updated_at: string;
};
// Parameter schema verified against the provider's model documentation. Only parameters listed here are ever sent.
export type ParamSpec = { name: string; label: string; type: 'enum' | 'bool' | 'int' | 'text'; values?: string[]; default?: string | number | boolean; min?: number; max?: number;
  pattern?: string; side_range?: [number, number]; billing_relevant?: boolean; note?: string };
export type Verification = { status: 'unverified' | 'verified' | 'blocked'; note: string; run_id: string | null; difference_usd: number | null; at: string | null; by: string | null };
export type LabModel = {
  id: string; provider_id: string; model_id: string; display_name: string; tasks: Task[]; sizes: string[];
  max_reference_images: number;
  supports: { negative_prompt: boolean; seed: boolean; size: boolean; quality: string[]; output_format: string[] };
  pricing: Pricing; status: 'untested' | 'ok' | 'failing'; enabled: boolean; last_tested_at: string | null;
  params?: ParamSpec[]; prompt_max?: number | null; sequence?: number | null; verification?: Verification; schema_source?: string; schema_verified_at?: string | null; notes?: string; catalog_version?: number; image_field?: 'images' | 'image'; ref_style?: 'figure' | 'picture';
  created_at: string; updated_at: string;
};
export type LabSettings = {
  fx_usd_to_idr: number | null; fx_source: string; fx_date: string | null;
  per_request_usd: number; daily_usd: number; monthly_usd: number; max_unpriced_runs_per_day: number;
  retention_days: number; auto_retry: false; max_active_runs: number; max_runs_per_request: number; enforce_sequence: boolean;
};
export type CostBlock = { estimated_usd: number | null; provider_reported_usd: number | null; calculated_usd: number | null; basis: string };
export type RunStatus = 'RESERVED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'AMBIGUOUS';
export type LabRun = {
  id: string; provider_id: string; provider_name: string; provider_type: ProviderType; model_ref: string; model_id: string; model_name: string;
  status: RunStatus; prompt: string; negative_prompt: string; params: Record<string, unknown>;
  inputs: { slot: string; file: string; content_type: string; width: number; height: number }[];
  output: { file: string; content_type: string; width: number; height: number } | null;
  cost: CostBlock; reserved_usd: number; unpriced: boolean; override: { reason: string; actor: string } | null;
  duration_ms: number | null; provider_request_id: string | null; error_code: string | null; error_message: string | null;
  usage: Record<string, number> | null; session_id: string | null; rating: Rating | null;
  scenario: RunScenario | null; raw_output: { file: string; content_type: string } | null;
  quote?: RunQuote | null; billing?: RunBilling | null; tokens?: RunTokens | null;
  created_by: string; created_at: string; finished_at: string | null; expires_at: string;
};
// Provider price quotation captured when the run was authorised (never a substituted base price).
export type RunQuote = { source: 'provider' | 'configured'; quoted_at: string; original_usd: number | null; discounted_usd: number | null; payable_percent: number | null; effective_discount_percent: number | null;
  currency: string; params: Record<string, unknown>; base_price_usd: number | null; base_discounted_usd: number | null; images: number };
export type BillingRecord = { prediction_uuid?: string; uuid: string; billing_type: string; price: number; created_at: string };
export type RunBilling = { status: 'not_started' | 'pending' | 'confirmed' | 'adjusted' | 'review' | 'not_found' | 'access_denied' | 'error' | 'manual';
  records: BillingRecord[]; confirmed_usd: number | null; net_known_usd: number | null; checked_at: string | null; attempts: number; message: string };
export type RunTokens = { availability: 'reported' | 'not_reported'; source: string | null; input: number | null; output: number | null; total: number | null };
export const RATING_KEYS = ['identity', 'template', 'hair_pose', 'lighting', 'quality', 'print', 'overall'] as const;
export type Rating = { scores: Partial<Record<typeof RATING_KEYS[number], number>>; notes: string; rated_by: string; rated_at: string };

export type ImageInput = { bytes: Buffer; contentType: string; width: number; height: number; role: 'template' | 'reference' | 'extra' };
export type AdapterRequest = {
  model_id: string; prompt: string; negative_prompt?: string; images: ImageInput[];
  size?: string; quality?: string; seed?: number; output_format?: string;
  params?: Record<string, string | number | boolean>;
  image_field?: 'images' | 'image'; // request field carrying the input image(s); default 'images'
  // Called once the provider has accepted the submission, before polling, so the id is never lost.
  onSubmitted?: (requestId: string) => Promise<void>;
};
export type QuoteResult = { available: boolean; original_usd: number | null; discounted_usd: number | null; payable_percent: number | null; currency: string; reason?: string; code?: string | number;
  base?: { price: number; discounted_price: number } | null };
export type ResultState = { state: 'pending' | 'completed' | 'failed'; status: string; image?: { bytes: Buffer; contentType: string }; inference_ms?: number; error?: string };
export type BillingLookup = { access: 'ok' | 'denied' | 'error'; records: BillingRecord[]; message?: string; truncated?: boolean };
export type AdapterResult = {
  request_id: string | null; images: { bytes: Buffer; contentType: string }[];
  usage?: Record<string, number>; reported_cost_usd?: number; inference_ms?: number;
};
export type HttpRequest = { method: 'GET' | 'POST' | 'PUT'; url: string; headers?: Record<string, string>; body?: Buffer | string; timeoutMs?: number; maxBytes?: number; auth?: boolean };
export type HttpResponse = { status: number; headers: Record<string, string>; body: Buffer };
export interface LabHttp { request(req: HttpRequest): Promise<HttpResponse>; }
export type AdapterContext = { baseUrl: string; secret: string; authMethod: AuthMethod; http: LabHttp; sleep: (ms: number) => Promise<void>; timeoutMs: number; pollIntervalMs: number; cacheKey?: string };
export interface LabAdapter {
  readonly type: ProviderType;
  readonly defaultBaseUrl: string;
  testConnection(ctx: AdapterContext): Promise<{ ok: boolean; message: string; inconclusive?: boolean }>;
  generate(ctx: AdapterContext, req: AdapterRequest): Promise<AdapterResult>;
  // Optional, non-billable: ids the account can use, from the provider's own model list.
  discover?(ctx: AdapterContext): Promise<string[]>;
  // Optional capabilities (all non-billable): request-specific price quotation, result lookup and billing reconciliation.
  quote?(ctx: AdapterContext, req: AdapterRequest): Promise<QuoteResult>;
  result?(ctx: AdapterContext, requestId: string): Promise<ResultState>;
  billing?(ctx: AdapterContext, requestId: string): Promise<BillingLookup>;
  billingWindow?(ctx: AdapterContext, modelId: string, fromIso: string, toIso: string): Promise<BillingLookup>;
}
export class LabError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

// ---- NXBooth scenarios -------------------------------------------------------------------------------------------
// A scenario reproduces how production builds a Basic or Advanced request (same server-owned prompt, same image
// preparation) so a candidate provider is judged on the real customer flow. The source is injected by the container
// and is read-only: the Lab never writes catalog, jobs, credits or production provider records.
export type ScenarioSelection = { kind: 'basic'; template_id: string } | { kind: 'advanced'; experience_id: string; frame_style_id: string };
export type RunScenario = { kind: 'basic' | 'advanced'; label: string; production_model: string | null; meta: Record<string, string | number | boolean> };
export type ScenarioPlan = RunScenario & {
  prompt: string; compact_prompt?: string; images: { bytes: Buffer; role: 'template' | 'reference' }[]; production_size: { width: number; height: number } | null;
  finish?: (bytes: Buffer) => Promise<Buffer>;
};
export type ScenarioCatalog = {
  basic: { id: string; name: string; description: string; theme: string; variant: 'man' | 'woman' | 'hijab' | 'other'; width: number | null; height: number | null }[];
  advanced: { experiences: { id: string; name: string; description: string; category: string; compatible_frame_style_ids: string[] | null }[]; frame_styles: { id: string; name: string; description: string }[] };
};
export interface NxScenarioSource {
  catalog(): Promise<ScenarioCatalog>;
  plan(selection: ScenarioSelection, face: Buffer): Promise<ScenarioPlan>;
}
