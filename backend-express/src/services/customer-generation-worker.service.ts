import { createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { NxGenerationJob } from '@prisma/client';
import type { CustomerGenerationModel } from '../models/customer-generation.model.js';
import { AppError } from '../lib/errors.js';
import { legacyId } from './customer-credentials.service.js';

export type GeneratedImage = { bytes: Buffer; provider: string; model: string };
export type NativeGenerationRunner = { generate(job: NxGenerationJob): Promise<GeneratedImage> };

// No process is started by this service. The candidate consumer must not be
// enabled until engine, provider telemetry and crash recovery parity is complete.
export class CustomerGenerationWorkerService {
  constructor(private readonly model: CustomerGenerationModel, private readonly engine: NativeGenerationRunner, private readonly resultsDir: string) {}
  async process(id: string) {
    const token = legacyId();
    const job = await this.model.claim(id, token);
    if (!job) return false;
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      this.model.leases.renew('customer', id, token).catch(() => {}).finally(() => { renewing = false; });
    }, 15000).unref();
    let path: string | undefined;
    let stored = false;
    let completing = false;
    try {
      const generated = await this.engine.generate(job);
      const { bytes } = generated;
      if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new AppError(502, 'AI_EMPTY_RESULT', 'Generation returned no usable image.');
      const image = sharp(bytes, { limitInputPixels: 25_000_000 });
      const metadata = await image.metadata();
      // Decode all pixels, not just a PNG header; reject corrupt/truncated data.
      await image.stats();
      if (metadata.format !== 'png' || !metadata.width || !metadata.height) throw new AppError(502, 'GENERATION_IMAGE_INVALID', 'Generation returned an invalid image.');
      if (job.mode === 'CLASSIC' && (metadata.width !== 1200 || metadata.height !== 3600)) throw new AppError(502, 'CLASSIC_LAYOUT_INVALID', 'Classic output does not match the strip master.');
      if ((job.mode === 'BASIC' || job.mode === 'ADVANCED') && (metadata.width !== 2160 || metadata.height !== 3240)) throw new AppError(502, 'GENERATION_IMAGE_INVALID', 'AI output does not match the print master.');
      const resultId = legacyId();
      const directory = resolve(this.resultsDir, resultId.slice(0, 2));
      path = join(directory, `${resultId}.png`);
      await mkdir(directory, { recursive: true });
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      stored = true;
      completing = true;
      const completed = await this.model.complete(id, { id: resultId, job_id: id,
        template_id: job.template_id || job.layout_id || '', storage_path: path, content_type: 'image/png',
        size_bytes: bytes.length, width: metadata.width, height: metadata.height,
        sha256: createHash('sha256').update(bytes).digest('hex'), provider: generated.provider, model: generated.model }, token);
      if (!completed) await unlink(path);
      return completed;
    } catch (error) {
      // A database timeout after COMMIT is ambiguous. Keep the image and avoid a
      // contradictory refund/failure; recovery must inspect the durable Result.
      if (completing) throw new AppError(503, 'GENERATION_COMPLETION_UNCERTAIN', 'Generation completion needs reconciliation.');
      if (stored && path) await unlink(path).catch(() => {});
      await this.model.fail(id, error instanceof AppError ? error.code : 'INTERNAL_ERROR',
        error instanceof AppError ? error.message : 'Generation failed unexpectedly. Please try again.', token);
      return false;
    } finally { clearInterval(heartbeat); }
  }
}
