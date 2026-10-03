import sharp from 'sharp';
import { AppError } from '../lib/errors.js';

export class NativeImageEngineService {
  constructor(private readonly baseUrl: string, private readonly key: string, private readonly fetcher: typeof fetch = fetch) {}
  configured() { return Boolean(this.baseUrl && this.key); }
  private async request(path: string, form: FormData, format: 'png' | 'jpeg') {
    if (!this.configured()) throw new AppError(503, 'IMAGE_ENGINE_NOT_CONNECTED', 'Image processing is not connected.');
    let response: Response;
    try { response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${this.key}` },
      body: form, redirect: 'error', signal: AbortSignal.timeout(90000) }); }
    catch { throw new AppError(503, 'IMAGE_ENGINE_UNAVAILABLE', 'Image processing is temporarily unavailable.'); }
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { detail?: { error_code?: string } } | null;
      const code = detail?.detail?.error_code;
      throw new AppError(response.status === 422 ? 422 : 502, typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : 'IMAGE_ENGINE_ERROR', 'The image could not be processed. Please try another photo.');
    }
    try {
      const chunks: Buffer[] = []; let size = 0;
      if (!response.body) throw new Error();
      for await (const chunk of response.body) { size += chunk.length; if (size > 25 * 1024 * 1024) throw new Error(); chunks.push(Buffer.from(chunk)); }
      const bytes = Buffer.concat(chunks, size);
      const image = sharp(bytes, { limitInputPixels: 64_000_000 });
      const info = await image.metadata(); await image.stats();
      if (info.format !== format || !info.width || !info.height) throw new Error();
      return { bytes, info, engine: response.headers.get('x-nxbooth-engine') };
    } catch { throw new AppError(502, 'IMAGE_ENGINE_RESPONSE_INVALID', 'Image processing returned an invalid image.'); }
  }
  private form(bytes: Buffer) { const form = new FormData(); form.append('image', new Blob([new Uint8Array(bytes)]), 'source'); return form; }
  async providerInput(bytes: Buffer) { return (await this.request('prepare-provider', this.form(bytes), 'jpeg')).bytes; }
  async advancedResult(bytes: Buffer) { return (await this.request('prepare-advanced', this.form(bytes), 'png')).bytes; }
}
