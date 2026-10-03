import sharp from 'sharp';
import { ensure } from '../lib/errors.js';

export interface ExperiencePreset {
  id: string;
  name: string;
  description: string;
  model: string;
  prompt: string;
}

export interface NineRouterConfig {
  NINEROUTER_BASE_URL?: string;
  NINEROUTER_API_KEY?: string;
  AI_ENGINE_TIMEOUT_MS: number;
  NINEROUTER_RESULT_ORIGINS?: string[];
}

/** Port of PhBo's app/ai/ninerouter.py; model and prompt remain server-owned. */
export class NineRouterService {
  constructor(private readonly config: NineRouterConfig, private readonly request: typeof fetch = fetch) {}

  assertConfigured() {
    ensure(this.config.NINEROUTER_BASE_URL && this.config.NINEROUTER_API_KEY?.trim(),
      503, 'AI_PROVIDER_NOT_CONNECTED', 'NineRouter is not configured');
  }

  async generate(original: Buffer, preset: ExperiencePreset): Promise<Buffer> {
    this.assertConfigured();
    const jpeg = await sharp(original, { limitInputPixels: 25_000_000 }).rotate()
      .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
    const signal = AbortSignal.timeout(this.config.AI_ENGINE_TIMEOUT_MS);
    const response = await this.request(`${this.config.NINEROUTER_BASE_URL!.replace(/\/$/, '')}/images/generations`, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${this.config.NINEROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: preset.model, prompt: preset.prompt, size: '1024x1024', n: 1,
        response_format: 'b64_json', image: `data:image/jpeg;base64,${jpeg.toString('base64')}` }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      ensure(false, 502, 'AI_PROVIDER_ERROR', `NineRouter returned HTTP ${response.status}`);
    }
    const text = (await readBounded(response, 36 * 1024 * 1024)).toString('utf8');
    let body: unknown;
    try {
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const events = text.split(/\r?\n/).map(line => line.trim())
          .filter(line => line.startsWith('data:') && line.slice(5).trim() !== '[DONE]')
          .map(line => JSON.parse(line.slice(5).trim()) as unknown);
        body = events.find(event => isRecord(event) && Array.isArray(event.data));
      } else body = JSON.parse(text);
    } catch { ensure(false, 502, 'AI_INVALID_RESPONSE', 'NineRouter returned invalid JSON or SSE'); }
    ensure(isRecord(body) && Array.isArray(body.data) && isRecord(body.data[0]),
      502, 'AI_EMPTY_RESULT', 'NineRouter returned no image');
    const first = body.data[0];
    let bytes: Buffer;
    if (typeof first.b64_json === 'string' && first.b64_json.trim()) {
      const encoded = first.b64_json.replace(/\s/g, '');
      ensure(/^[A-Za-z0-9+/]+={0,2}$/.test(encoded), 502, 'AI_INVALID_RESPONSE', 'Invalid image encoding');
      bytes = Buffer.from(encoded, 'base64');
    } else {
      // Only explicitly trusted origins may serve provider-generated URLs.
      ensure(typeof first.url === 'string', 502, 'AI_EMPTY_RESULT', 'NineRouter returned no image');
      const url = new URL(first.url);
      const origins = [new URL(this.config.NINEROUTER_BASE_URL!).origin, ...(this.config.NINEROUTER_RESULT_ORIGINS ?? [])];
      ensure(['http:', 'https:'].includes(url.protocol) && origins.includes(url.origin) && !url.username && !url.password,
        502, 'AI_INVALID_RESPONSE', 'Result URL must use a configured trusted origin');
      const image = await this.request(url, { signal, redirect: 'error' });
      if (!image.ok) {
        await image.body?.cancel();
        ensure(false, 502, 'AI_PROVIDER_ERROR', 'Result download failed');
      }
      bytes = await readBounded(image, 25 * 1024 * 1024);
    }
    ensure(bytes.length > 0 && bytes.length <= 25 * 1024 * 1024, 502, 'AI_EMPTY_RESULT', 'Invalid image size');
    try { return await sharp(bytes, { limitInputPixels: 25_000_000 }).png().toBuffer(); }
    catch { ensure(false, 502, 'AI_INVALID_RESPONSE', 'NineRouter returned an unreadable image'); }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readBounded(response: Response, maximum: number) {
  ensure(response.body, 502, 'AI_EMPTY_RESULT', 'Empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      ensure(size <= maximum, 502, 'AI_INVALID_RESPONSE', 'Response exceeds size limit');
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
