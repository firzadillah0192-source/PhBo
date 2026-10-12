import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { LabError, type HttpRequest, type HttpResponse, type LabHttp, type ProviderType } from './types.js';

export function isPublicAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]!);
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224);
  }
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    return !(value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('ff') || value.startsWith('2001:db8'));
  }
  return false;
}

// Fixed API hosts per provider type. Only custom_rest accepts an arbitrary public HTTPS host.
export const PROVIDER_HOSTS: Record<ProviderType, string[] | null> = {
  wavespeed: ['api.wavespeed.ai'], openai: ['api.openai.com'], openai_compatible: null, fal: ['queue.fal.run', 'fal.run'], '9router': [], custom_rest: null,
};
export type NetworkPolicy = { internalOrigin?: string };

export function validateBaseUrl(type: ProviderType, raw: string, policy: NetworkPolicy = {}): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new LabError(422, 'LAB_URL_INVALID', 'API base URL is not a valid URL.'); }
  if (url.username || url.password || url.search || url.hash) throw new LabError(422, 'LAB_URL_INVALID', 'API base URL must not contain credentials, query or fragment.');
  const origin = url.origin, path = url.pathname.replace(/\/$/, '');
  if (type === '9router') {
    // Internal gateway is allowed only when it is exactly the host the deployment already configures for 9Router.
    if (!policy.internalOrigin || origin !== new URL(policy.internalOrigin).origin) throw new LabError(422, 'LAB_URL_FORBIDDEN', '9Router base URL must match the gateway configured for this deployment.');
    return origin + path;
  }
  if (url.protocol !== 'https:') throw new LabError(422, 'LAB_URL_FORBIDDEN', 'Provider URLs must use HTTPS.');
  if (url.port && url.port !== '443') throw new LabError(422, 'LAB_URL_FORBIDDEN', 'Only the default HTTPS port is allowed.');
  if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new LabError(422, 'LAB_URL_FORBIDDEN', 'IP-literal hosts are not allowed.');
  const allowed = PROVIDER_HOSTS[type];
  if (allowed && !allowed.includes(url.hostname)) throw new LabError(422, 'LAB_URL_FORBIDDEN', `Host is not allowed for ${type}. Allowed: ${allowed.join(', ')}.`);
  if (/(^|\.)(localhost|internal|local|localdomain)$/.test(url.hostname) || !url.hostname.includes('.')) throw new LabError(422, 'LAB_URL_FORBIDDEN', 'Internal host names are not allowed.');
  return origin + path;
}

// HTTP client that re-validates every destination at connect time (defeats DNS rebinding), never follows redirects,
// and refuses to attach credentials to any host except the provider's own API host.
export class SafeHttp implements LabHttp {
  constructor(private readonly apiHost: string, private readonly policy: NetworkPolicy = {}) {}
  request(req: HttpRequest): Promise<HttpResponse> {
    return new Promise((resolve, reject) => {
      let url: URL;
      try { url = new URL(req.url); } catch { reject(new LabError(502, 'LAB_URL_INVALID', 'Provider returned an invalid URL.')); return; }
      const internal = this.policy.internalOrigin && url.origin === new URL(this.policy.internalOrigin).origin;
      if (url.protocol !== 'https:' && !internal) { reject(new LabError(502, 'LAB_URL_FORBIDDEN', 'Refusing non-HTTPS provider URL.')); return; }
      if (url.username || url.password) { reject(new LabError(502, 'LAB_URL_FORBIDDEN', 'Refusing URL with embedded credentials.')); return; }
      const headers = { ...(req.headers ?? {}) };
      if (url.host !== this.apiHost) for (const name of Object.keys(headers)) if (/^(authorization|x-api-key)$/i.test(name)) delete headers[name];
      if (req.auth && url.host !== this.apiHost) { reject(new LabError(502, 'LAB_URL_FORBIDDEN', 'Refusing to send credentials to a different host.')); return; }
      const body = typeof req.body === 'string' ? Buffer.from(req.body) : req.body;
      if (body) headers['Content-Length'] = String(body.length);
      const lookup: NonNullable<https.RequestOptions['lookup']> = (hostname, options, callback) => {
        dnsLookup(hostname, { all: true }, (error, addresses) => {
          if (error) { (callback as (e: Error) => void)(error); return; }
          if (!internal && addresses.some(item => !isPublicAddress(item.address))) { (callback as (e: Error) => void)(new LabError(502, 'LAB_URL_FORBIDDEN', 'Destination resolves to a non-public address.')); return; }
          if ((options as { all?: boolean }).all) (callback as (e: null, a: typeof addresses) => void)(null, addresses);
          else (callback as (e: null, a: string, f: number) => void)(null, addresses[0]!.address, addresses[0]!.family);
        });
      };
      const client = url.protocol === 'https:' ? https : http;
      const timeout = req.timeoutMs ?? 30000, max = req.maxBytes ?? 40 * 1024 * 1024;
      const out = client.request(url, { method: req.method, headers, lookup, timeout }, response => {
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > max) { out.destroy(new LabError(502, 'LAB_RESPONSE_TOO_LARGE', 'Provider response exceeds the size limit.')); return; } chunks.push(chunk); });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v ?? '')])), body: Buffer.concat(chunks) }));
        response.on('error', reject);
      });
      out.on('timeout', () => out.destroy(new LabError(504, 'LAB_TIMEOUT', 'The provider request timed out.')));
      out.on('error', error => reject(error instanceof LabError ? error : new LabError(502, 'LAB_PROVIDER_UNREACHABLE', 'The provider could not be reached.')));
      if (body) out.write(body);
      out.end();
    });
  }
}
