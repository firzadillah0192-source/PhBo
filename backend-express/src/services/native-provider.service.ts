import sharp from 'sharp';
import { normalizedImageUsage } from './credit-pricing.service.js';
import { AppError } from '../lib/errors.js';

export type OperationalMeta = Record<string, string | number | Record<string, number>>;
export type ProviderImage = { bytes: Buffer; provider: string; model: string; meta: OperationalMeta };
export type TemplateReference = { bytes: Buffer; width: number; height: number };
export interface NativeAIProvider {
  readonly name: string;
  available(): boolean;
  generate(image: Buffer | null, prompt: string, model: string, template?: TemplateReference): Promise<ProviderImage>;
}
export class ProviderFailure extends AppError {
  constructor(code: string, message: string, readonly meta: OperationalMeta = {}) { super(502, code, message); }
}

export function responseOperationalMeta(headers: Headers): OperationalMeta {
  const result: OperationalMeta = {};
  const strings: Record<string, string> = { router_request_id: 'request-id', provider_account_ref: 'account-ref', routing_strategy: 'routing-strategy',
    provider_name: 'provider', provider_reported_model: 'model', upstream_request_id: 'upstream-request-id', usage_available: 'usage-available' };
  for (const [field, suffix] of Object.entries(strings)) { const value = headers.get(`x-9router-${suffix}`)?.trim(); if (value) result[field] = value.slice(0, 255); }
  const numbers = { attempt_count: 'attempt-count', retry_count: 'retry-count', failover_count: 'failover-count', router_duration_ms: 'duration-ms',
    input_tokens: 'input-tokens', output_tokens: 'output-tokens', total_tokens: 'total-tokens', input_text_tokens: 'input-text-tokens',
    cached_tokens: 'cached-tokens', cached_text_tokens: 'cached-text-tokens', cached_image_tokens: 'cached-image-tokens', input_image_tokens: 'input-image-tokens', output_image_tokens: 'output-image-tokens', billable_units: 'billable-units' };
  for (const [field, suffix] of Object.entries(numbers)) {
    const value = headers.get(`x-9router-${suffix}`)?.trim();
    if (value && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) result[field] = Number(value);
  }
  const cost = headers.get('x-9router-reported-cost')?.trim();
  if (cost && Number.isFinite(Number(cost)) && Number(cost) >= 0) result.provider_reported_cost = Number(cost);
  const usage: Record<string, number> = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens', 'input_text_tokens', 'input_image_tokens', 'output_image_tokens', 'cached_text_tokens', 'cached_image_tokens', 'cached_tokens', 'billable_units']) if (typeof result[key] === 'number') usage[key] = result[key];
  if (Object.keys(usage).length) result.usage = usage;
  return result;
}

async function readBounded(response: Response, maximum: number) {
  if (!response.body) throw new ProviderFailure('AI_EMPTY_RESULT', 'The provider returned no image.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > maximum) throw new ProviderFailure('AI_PROVIDER_ERROR', 'The provider response exceeds the image limit.'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks, size);
}

// Application adapter only. Routing, credentials, rotation and 9Router itself
// are untouched. Input normalization remains the existing Python image function.
export class NativeNineRouterProvider implements NativeAIProvider {
  readonly name = '9router';
  constructor(private readonly config: { baseUrl: string; key: string; timeoutMs: number; resultOrigins: string[] }, private readonly fetcher: typeof fetch = fetch) {}
  available() { return Boolean(this.config.baseUrl.trim() && this.config.key.trim()); }
  async generate(image: Buffer | null, prompt: string, model: string, template?: TemplateReference): Promise<ProviderImage> {
    if (!this.available()) throw new ProviderFailure('AI_PROVIDER_NOT_CONNECTED', 'The AI provider is not connected.', { upstream_status: 'NOT_CONNECTED', retry_count: 0 });
    const signal = AbortSignal.timeout(this.config.timeoutMs);
    if (template && !image) throw new ProviderFailure('BASIC_INPUT_INVALID', 'An identity photo is required.');
    const payload = { model, prompt, size: template ? `${template.width}x${template.height}` : '1024x1024', n: 1, response_format: 'b64_json',
      ...(template ? { images: [`data:image/png;base64,${template.bytes.toString('base64')}`, `data:image/jpeg;base64,${image!.toString('base64')}`] }
        : image ? { image: `data:image/jpeg;base64,${image.toString('base64')}` } : {}) };
    let response: Response;
    try { response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, '')}/images/generations`, { method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${this.config.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
    catch { throw new ProviderFailure('AI_PROVIDER_ERROR', 'The AI provider could not be reached.', { upstream_status: signal.aborted ? 'TIMEOUT' : 'CONNECTION_ERROR', retry_count: 0 }); }
    const meta: OperationalMeta = { ...responseOperationalMeta(response.headers), requested_model: model };
    if (response.status !== 200) { await response.body?.cancel(); throw new ProviderFailure('AI_PROVIDER_ERROR', `The AI provider returned HTTP ${response.status}.`, { ...meta, upstream_status: 'FAILED', http_status: response.status }); }
    try {
      const text = (await readBounded(response, 36 * 1024 * 1024)).toString('utf8');
      let body: unknown;
      if (response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
        const events = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('data:') && line.slice(5).trim() !== '[DONE]').map(line => JSON.parse(line.slice(5).trim()) as unknown);
        body = events.find(event => event && typeof event === 'object' && 'data' in event && Array.isArray(event.data));
        const finalUsage = [...events].reverse().find(event => event && typeof event === 'object' && 'usage' in event) as { usage?: unknown } | undefined;
        if (body && typeof body === 'object' && finalUsage?.usage) body = { ...body, usage: finalUsage.usage };
      } else body = JSON.parse(text);
      const bodyUsage = normalizedImageUsage((body as { usage?: unknown } | null)?.usage);
      if (bodyUsage) {
        const usage = { ...bodyUsage, ...(typeof meta.usage === 'object' ? meta.usage : {}) };
        if (usage.total_tokens !== undefined && usage.input_tokens !== undefined && usage.output_tokens !== undefined && usage.total_tokens !== usage.input_tokens + usage.output_tokens) delete usage.total_tokens;
        meta.usage = usage;
      }
      const first = (body as { data?: { b64_json?: string; url?: string }[] } | null)?.data?.[0];
      let bytes: Buffer;
      if (typeof first?.b64_json === 'string' && first.b64_json.trim()) {
        const encoded = first.b64_json.replace(/\s/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new ProviderFailure('AI_PROVIDER_ERROR', 'The AI image encoding is invalid.');
        bytes = Buffer.from(encoded, 'base64');
      } else if (typeof first?.url === 'string' && first.url.trim()) {
        const url = new URL(first.url);
        const origins = [new URL(this.config.baseUrl).origin, ...this.config.resultOrigins];
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !origins.includes(url.origin)) throw new ProviderFailure('AI_PROVIDER_ERROR', 'The AI result URL is not trusted.');
        const download = await this.fetcher(url, { signal, redirect: 'error' });
        if (!download.ok) { await download.body?.cancel(); throw new ProviderFailure('AI_PROVIDER_ERROR', 'The AI result could not be downloaded.'); }
        bytes = await readBounded(download, 25 * 1024 * 1024);
      } else throw new ProviderFailure('AI_EMPTY_RESULT', 'The AI provider returned no image.');
      if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new ProviderFailure('AI_EMPTY_RESULT', 'The AI provider returned no usable image.');
      const decoded = sharp(bytes, { limitInputPixels: 64_000_000 }); await decoded.stats();
      const format = (await decoded.metadata()).format;
      if (format !== 'png') bytes = await decoded.ensureAlpha().png().toBuffer();
      return { bytes, provider: this.name, model: typeof meta.provider_reported_model === 'string' ? meta.provider_reported_model : model, meta };
    } catch (error) {
      if (error instanceof ProviderFailure) throw new ProviderFailure(error.code, error.message, { ...meta, ...error.meta });
      throw new ProviderFailure('AI_PROVIDER_ERROR', 'The AI provider returned an invalid image response.', meta);
    }
  }
}

export class NativeNullProvider implements NativeAIProvider {
  readonly name = 'none'; available() { return false; }
  async generate(): Promise<ProviderImage> { throw new ProviderFailure('AI_PROVIDER_NOT_CONNECTED', 'No AI provider is configured.', { upstream_status: 'NOT_CONNECTED', retry_count: 0 }); }
}
