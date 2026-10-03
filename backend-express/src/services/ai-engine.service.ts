import type { AiEngineConfig } from '../config/env.js';
import { ensure } from '../lib/errors.js';

export type AiMode = 'CLASSIC';
export type ClassicInput = { photos: Buffer[]; frame: Buffer | null };

/** Adapter for the separate AI service. See README for its HTTP contract. */
export class AiEngineService {
  constructor(private readonly config: AiEngineConfig, private readonly request: typeof fetch = fetch) {}

  assertConfigured(): void {
    ensure(this.config.AI_ENGINE_URL, 503, 'AI_UNAVAILABLE', 'AI engine is not configured');
  }

  async generate(original: Buffer, mode: AiMode, generationId: string, _templateId?: string, classic?: ClassicInput): Promise<Buffer> {
    this.assertConfigured();
    const body = new FormData();
    if (mode === 'CLASSIC') {
      ensure(classic && classic.photos.length >= 1 && classic.photos.length <= 4, 400, 'PHOTO_COUNT', 'CLASSIC accepts 1–4 photos');
      for (const [index, photo] of classic.photos.entries()) body.append('images', new Blob([new Uint8Array(photo)], { type: 'image/png' }), `photo-${index}.png`);
      if (classic.frame) body.set('frame', new Blob([new Uint8Array(classic.frame)], { type: 'image/png' }), 'frame.png');
    }
    body.set('mode', mode);
    body.set('generationId', generationId);
    const headers: Record<string, string> = { 'Idempotency-Key': generationId };
    if (this.config.AI_ENGINE_API_KEY) headers.Authorization = `Bearer ${this.config.AI_ENGINE_API_KEY}`;
    const response = await this.request(this.config.AI_ENGINE_URL!, {
      method: 'POST', headers, body, redirect: 'error',
      signal: AbortSignal.timeout(this.config.AI_ENGINE_TIMEOUT_MS),
    });
    try {
      ensure(response.ok, 502, 'AI_ENGINE_ERROR', `AI engine returned status ${response.status}`);
      const mime = response.headers.get('content-type')?.split(';')[0].trim();
      ensure(mime && ['image/png', 'image/jpeg', 'image/webp'].includes(mime), 502, 'AI_INVALID_RESPONSE', 'AI engine must return an image');
      ensure(response.body, 502, 'AI_INVALID_RESPONSE', 'AI engine returned an empty response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          ensure(size <= 25 * 1024 * 1024, 502, 'AI_INVALID_RESPONSE', 'AI response exceeds 25 MB');
          chunks.push(part.value);
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
      ensure(size > 0, 502, 'AI_INVALID_RESPONSE', 'AI engine returned an empty image');
      return Buffer.concat(chunks);
    } finally {
      if (response.body && !response.body.locked) await response.body.cancel();
    }
  }
}
