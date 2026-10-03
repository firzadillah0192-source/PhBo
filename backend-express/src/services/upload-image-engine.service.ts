import sharp from 'sharp';
import { AppError } from '../lib/errors.js';

export type CanonicalUpload = { bytes: Buffer; width: number; height: number };
export type UploadImageEngine = { normalize(bytes: Buffer, mime: string): Promise<CanonicalUpload> };

// Python is used only for decoding/HEIC/color/EXIF image work. Express owns the
// upload contract, identity, metadata, storage, retention and recovery.
export class UploadImageEngineService implements UploadImageEngine {
  constructor(private readonly url: string, private readonly key: string, private readonly timeoutMs = 30000, private readonly fetcher: typeof fetch = fetch) {}
  async normalize(bytes: Buffer, mime: string) {
    if (!this.url || !this.key) throw new AppError(503, 'IMAGE_ENGINE_NOT_CONNECTED', 'Photo processing is temporarily unavailable.');
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(bytes)], { type: mime || 'application/octet-stream' }), 'source');
    let response;
    try { response = await this.fetcher(this.url, { method: 'POST', headers: { Authorization: `Bearer ${this.key}` }, body: form, signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' }); }
    catch { throw new AppError(503, 'IMAGE_ENGINE_UNAVAILABLE', 'Photo processing is temporarily unavailable.'); }
    if (!response.ok) {
      if (response.status === 422) {
        const body = await response.json().catch(() => null) as { detail?: { error_code?: string; message?: string } } | null;
        throw new AppError(422, body?.detail?.error_code ?? 'VALIDATION_FAILED', body?.detail?.message ?? 'The photo could not be validated.');
      }
      throw new AppError(503, 'IMAGE_ENGINE_UNAVAILABLE', 'Photo processing is temporarily unavailable.');
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      if (!response.body) throw new Error();
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 25 * 1024 * 1024) throw new Error();
        chunks.push(Buffer.from(chunk));
      }
      const output = Buffer.concat(chunks, size);
      const metadata = await sharp(output, { limitInputPixels: 64_000_000 }).metadata();
      if (!output.length || output.length > 25 * 1024 * 1024 || metadata.format !== 'jpeg' || !metadata.width || !metadata.height) throw new Error();
      return { bytes: output, width: metadata.width, height: metadata.height };
    } catch { throw new AppError(503, 'IMAGE_ENGINE_RESPONSE_INVALID', 'Photo processing is temporarily unavailable.'); }
  }
}
