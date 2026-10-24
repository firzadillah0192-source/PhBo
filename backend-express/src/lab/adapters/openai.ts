import { LabError, type AdapterContext, type AdapterRequest, type AdapterResult, type LabAdapter, type ProviderType } from '../types.js';
import { asImage, authHeaders, download, failIfBad, join, parseJson, send } from './common.js';

const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
function usageOf(body: Record<string, any>) {
  const usage: Record<string, number> = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) { const value = num(body.usage?.[key]); if (value !== undefined) usage[key] = value; }
  return Object.keys(usage).length ? usage : undefined;
}
async function readImage(ctx: AdapterContext, body: Record<string, any>) {
  const first = Array.isArray(body.data) ? body.data[0] : null;
  if (typeof first?.b64_json === 'string' && first.b64_json) return asImage(Buffer.from(first.b64_json, 'base64'));
  if (typeof first?.url === 'string') return download(ctx, first.url);
  throw new LabError(502, 'LAB_OUTPUT_UNAVAILABLE', 'The provider returned no image.');
}
export function multipart(fields: Record<string, string>, files: { name: string; filename: string; type: string; bytes: Buffer }[]) {
  const boundary = `----lab${Math.random().toString(16).slice(2)}${Date.now()}`, parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (const file of files) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.bytes, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}
// OpenAI Images API (generations = JSON, edits = multipart with image[]). The same wire format is spoken by the
// 9Router gateway for JSON requests (images as data URIs), so one adapter serves both with different transports.
function make(type: ProviderType, defaultBaseUrl: string, prefix: string, edits: 'multipart' | 'json'): LabAdapter {
  return {
    type, defaultBaseUrl,
    async testConnection(ctx) {
      const response = await send(ctx, { method: 'GET', url: join(ctx.baseUrl, `${prefix}/models`), auth: true, headers: authHeaders(ctx) });
      if (response.status === 401 || response.status === 403) return { ok: false, message: 'The provider rejected the credentials.' };
      if (response.status >= 200 && response.status < 300) return { ok: true, message: 'Credentials accepted (model list). No generation was run.' };
      return { ok: false, message: `Provider answered HTTP ${response.status}.` };
    },
    async discover(ctx) {
      const response = await send(ctx, { method: 'GET', url: join(ctx.baseUrl, `${prefix}/models`), auth: true, headers: authHeaders(ctx) });
      failIfBad(ctx, response, `${type} model list`);
      const data = parseJson(response).data;
      return Array.isArray(data) ? data.map((item: any) => item?.id).filter((id: unknown): id is string => typeof id === 'string').slice(0, 2000) : [];
    },
    async generate(ctx, req: AdapterRequest): Promise<AdapterResult> {
      const started = Date.now();
      const common: Record<string, unknown> = { model: req.model_id, prompt: req.negative_prompt ? `${req.prompt}\nAvoid: ${req.negative_prompt}` : req.prompt, n: 1 };
      if (req.size) common.size = req.size;
      if (req.quality) common.quality = req.quality;
      if (req.output_format) common.output_format = req.output_format;
      if (req.seed !== undefined) common.seed = req.seed;
      let response;
      if (!req.images.length) {
        response = await send(ctx, { method: 'POST', url: join(ctx.baseUrl, `${prefix}/images/generations`), auth: true, timeoutMs: ctx.timeoutMs, headers: { ...authHeaders(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify(common) });
      } else if (edits === 'json') {
        const images = req.images.map(item => `data:${item.contentType};base64,${item.bytes.toString('base64')}`);
        // OpenAI GPT Image returns base64 by default and rejects the legacy response_format field.
        const format = type === '9router' && /^openai\/(?:gpt-image-|chatgpt-image-)/i.test(req.model_id) ? {} : { response_format: 'b64_json' };
        response = await send(ctx, { method: 'POST', url: join(ctx.baseUrl, `${prefix}/images/generations`), auth: true, timeoutMs: ctx.timeoutMs, headers: { ...authHeaders(ctx), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...common, ...format, images }) });
      } else {
        const fields = Object.fromEntries(Object.entries(common).map(([k, v]) => [k, String(v)]));
        const form = multipart(fields, req.images.map((item, index) => ({ name: 'image[]', filename: `input-${index}.${item.contentType === 'image/png' ? 'png' : item.contentType === 'image/webp' ? 'webp' : 'jpg'}`, type: item.contentType, bytes: item.bytes })));
        response = await send(ctx, { method: 'POST', url: join(ctx.baseUrl, `${prefix}/images/edits`), auth: true, timeoutMs: ctx.timeoutMs, headers: { ...authHeaders(ctx), 'Content-Type': form.contentType }, body: form.body });
      }
      failIfBad(ctx, response, `${type} generation`);
      const body = parseJson(response), usage = usageOf(body);
      const reported = num(Number(response.headers['x-9router-reported-cost']));
      return { request_id: response.headers['x-request-id'] ?? response.headers['x-9router-request-id'] ?? null, images: [await readImage(ctx, body)],
        ...(usage ? { usage } : {}), ...(type === '9router' && reported !== undefined && response.headers['x-9router-reported-cost'] ? { reported_cost_usd: reported } : {}), inference_ms: Date.now() - started };
    },
  };
}
export const openaiAdapter = make('openai', 'https://api.openai.com', '/v1', 'multipart');
// Lab-only 9Router adapter; the base URL already contains the gateway's /v1 prefix in production configuration.
export const nineRouterAdapter: LabAdapter = {
  ...make('9router', '', '', 'json'),
  async discover(ctx) {
    // The general model list is a different catalog and may omit image-only routes.
    const response = await send(ctx, { method: 'GET', url: join(ctx.baseUrl, '/models/image'), auth: true, headers: authHeaders(ctx) });
    failIfBad(ctx, response, '9router image model list');
    const data = parseJson(response).data;
    if (!Array.isArray(data) || data.some(item => typeof item?.id !== 'string' || !item.id.trim())) {
      throw new LabError(502, 'LAB_PROVIDER_ERROR', '9Router returned an invalid image model list.');
    }
    return [...new Set<string>(data.map(item => item.id))].slice(0, 2000);
  },
};
// Any OpenAI-style Images API on a public HTTPS host (Together, Fireworks, Azure-style gateways, ...). Base URL is required
// and should include the version prefix if the vendor uses one (for example https://api.example.com/v1).
export const openaiCompatibleAdapter = make('openai_compatible', '', '', 'multipart');
