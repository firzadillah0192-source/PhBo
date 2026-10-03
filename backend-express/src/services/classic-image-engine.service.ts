import type { NxClassicLayout } from '@prisma/client';
import sharp from 'sharp';
import { AppError } from '../lib/errors.js';
import { reviewedSlots } from './catalog-assets.service.js';

export class ClassicImageEngineService {
  constructor(private readonly url: string, private readonly key: string, private readonly fetcher: typeof fetch = fetch) {}
  async generate(layout: NxClassicLayout, photos: Buffer[], frame: Buffer) {
    if (!this.url || !this.key) throw new AppError(503, 'CLASSIC_ENGINE_NOT_CONNECTED', 'Classic composition is temporarily unavailable.');
    const config = reviewedSlots(layout);
    if (photos.length !== layout.shot_count) throw new AppError(422, 'CLASSIC_SHOT_COUNT_INVALID', 'Incorrect number of captures');
    const form = new FormData();
    form.append('metadata', JSON.stringify({ canvas_width: layout.canvas_width, canvas_height: layout.canvas_height, shot_count: layout.shot_count, slots: config.slots }));
    for (const [index, photo] of photos.entries()) form.append('images', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), `capture-${index}.jpg`);
    form.append('frame', new Blob([new Uint8Array(frame)], { type: 'image/png' }), 'frame.png');
    let response: Response;
    try { response = await this.fetcher(this.url, { method: 'POST', headers: { Authorization: `Bearer ${this.key}` }, body: form, signal: AbortSignal.timeout(30000), redirect: 'error' }); }
    catch { throw new AppError(503, 'CLASSIC_ENGINE_UNAVAILABLE', 'Classic composition is temporarily unavailable.'); }
    if (!response.ok) { await response.body?.cancel(); throw new AppError(502, 'CLASSIC_COMPOSITION_FAILED', 'The captured photos could not be composed.'); }
    try {
      if (!response.body) throw new Error();
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 25 * 1024 * 1024) throw new Error();
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks, size);
      const image = sharp(bytes, { limitInputPixels: 25_000_000 });
      const info = await image.metadata(); await image.stats();
      if (info.format !== 'png' || info.width !== layout.canvas_width || info.height !== layout.canvas_height) throw new Error();
      return { bytes, provider: 'local', model: 'classic-compositor' };
    } catch { throw new AppError(502, 'CLASSIC_COMPOSITION_FAILED', 'The captured photos could not be composed.'); }
  }
}
