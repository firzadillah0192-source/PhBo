import sharp from 'sharp';
import { LabError, type AdapterContext, type HttpRequest, type HttpResponse } from '../types.js';
import { redact } from '../crypto.js';

export const authHeaders = (ctx: AdapterContext): Record<string, string> =>
  ctx.authMethod === 'key_header' ? { Authorization: `Key ${ctx.secret}` } : { Authorization: `Bearer ${ctx.secret}` };
export const join = (base: string, path: string) => `${base.replace(/\/$/, '')}${path}`;
export function parseJson(response: HttpResponse): Record<string, any> {
  try { const value = JSON.parse(response.body.toString('utf8')); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}
// Maps HTTP failures to stable, redacted errors. Rate limits are surfaced, never retried automatically.
// Sanitized provider message: JSON message/detail/error fields, else the text body without markup; never the credential.
export function providerMessage(ctx: AdapterContext, response: HttpResponse) {
  const body = parseJson(response);
  const raw = body.message ?? body.detail ?? body.error?.message ?? body.error ?? (Object.keys(body).length ? '' : response.body.toString('utf8').replace(/<[^>]*>/g, ' '));
  return redact(typeof raw === 'string' ? raw : JSON.stringify(raw), [ctx.secret], 200);
}
export function failIfBad(ctx: AdapterContext, response: HttpResponse, what: string): void {
  if (response.status >= 200 && response.status < 300) return;
  const detail = providerMessage(ctx, response);
  if (response.status === 401 || response.status === 403) throw new LabError(502, 'LAB_PROVIDER_AUTH', `${what}: the provider rejected the credentials (HTTP ${response.status}).`);
  if (response.status === 429) throw new LabError(429, 'LAB_PROVIDER_RATE_LIMITED', `${what}: provider rate limit reached. Not retried automatically.`);
  throw new LabError(502, 'LAB_PROVIDER_ERROR', `${what}: HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
}
export async function send(ctx: AdapterContext, req: HttpRequest) {
  return ctx.http.request({ timeoutMs: Math.min(ctx.timeoutMs, 60000), ...req });
}
// Provider output must be a decodable image; the format comes from decoding, not from the provider's claim.
export async function asImage(bytes: Buffer) {
  try {
    const meta = await sharp(bytes).metadata();
    const type = meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : null;
    if (!type) throw new Error('format');
    return { bytes, contentType: type };
  } catch { throw new LabError(502, 'LAB_OUTPUT_INVALID', 'The provider returned data that is not a supported image.'); }
}
export async function download(ctx: AdapterContext, url: string) {
  const response = await ctx.http.request({ method: 'GET', url, timeoutMs: 60000, maxBytes: 40 * 1024 * 1024 });
  if (response.status !== 200) throw new LabError(502, 'LAB_OUTPUT_UNAVAILABLE', `Could not download the generated image (HTTP ${response.status}).`);
  return asImage(response.body);
}
export function deadline(ctx: AdapterContext) { const end = Date.now() + ctx.timeoutMs; return () => Date.now() > end; }
