import type { NxGenerationJob } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { CatalogAssetError, type CatalogAssetsService } from './catalog-assets.service.js';
import type { CustomerUploadService } from './customer-upload.service.js';
import type { CustomerGenerationModel } from '../models/customer-generation.model.js';
import type { CustomerIdentity } from './customer-account.service.js';
import { generationInput, validateAdvancedSelection } from './customer-generation-input.js';
import { legacyId } from './customer-credentials.service.js';

export type GenerationQueue = { enqueue(id: string): Promise<void> };
export class CustomerGenerationService {
  constructor(private readonly model: CustomerGenerationModel, private readonly uploads: CustomerUploadService,
    private readonly assets: CatalogAssetsService, private readonly queue: GenerationQueue) {}
  response(job: NxGenerationJob) {
    return { job_id: job.id, state: job.state, upload_id: job.upload_id, template_id: job.template_id || null,
      experience_id: job.experience_id, mode: job.mode, layout_id: job.layout_id, frame_style_id: job.frame_style_id,
      ornament_ids: JSON.parse(job.ornament_ids_json ?? '[]'), created_at: job.created_at };
  }
  async create(body: unknown, identity: CustomerIdentity) {
    const input = generationInput.parse(body);
    const source = await this.uploads.owned(input.upload_id, identity);
    let frame: string | null = null;
    if (input.mode === 'BASIC') {
      const template = await this.model.template(input.template_id!);
      if (!template?.enabled) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template unavailable');
      // Use registered assets; do not infer face geometry or modify the engine.
      if (!await this.assets.file(template.image_path)) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template unavailable');
    } else if (input.mode === 'CLASSIC') {
      const layout = await this.model.layout(input.layout_id!);
      if (!layout?.active) throw new AppError(404, 'CLASSIC_LAYOUT_NOT_FOUND', 'Classic layout unavailable');
      try { await this.assets.validateLayout(layout); }
      catch (error) { if (error instanceof CatalogAssetError) throw new AppError(422, 'CLASSIC_LAYOUT_INVALID', 'Classic layout is invalid'); throw error; }
      if (input.capture_upload_ids.length !== layout.shot_count || new Set(input.capture_upload_ids).size !== layout.shot_count) throw new AppError(422, 'CLASSIC_SHOT_COUNT_INVALID', 'Incorrect number of distinct captures');
      for (const id of input.capture_upload_ids) {
        try { await this.uploads.owned(id, identity); }
        catch (error) { if (error instanceof AppError) throw new AppError(422, 'CLASSIC_CAPTURE_UNAVAILABLE', 'A capture is unavailable'); throw error; }
      }
    } else {
      const experience = await this.model.experience(input.experience_id!);
      if (experience?.status !== 'published') throw new AppError(404, 'EXPERIENCE_NOT_FOUND', 'Experience unavailable');
      frame = input.frame_style_id ?? 'natural';
      validateAdvancedSelection(experience, await this.model.frame(frame), await this.model.ornaments(input.ornament_ids), input.ornament_ids);
    }
    const job = await this.model.create({ id: legacyId(), upload_id: source.upload.id, account_id: identity.account?.id ?? null,
      guest_id: identity.guest?.id ?? null, mode: input.mode, template_id: input.template_id ?? '',
      experience_id: input.experience_id ?? null, layout_id: input.layout_id ?? null,
      capture_upload_ids_json: input.mode === 'CLASSIC' ? JSON.stringify(input.capture_upload_ids) : null,
      frame_style_id: frame, ornament_ids_json: frame ? JSON.stringify(input.ornament_ids) : null, state: 'QUEUED' });
    try { await this.queue.enqueue(job.id); }
    catch { await this.model.queueFailed(job.id); throw new AppError(503, 'QUEUE_UNAVAILABLE', 'Generation queue is unavailable.'); }
    return this.response(job);
  }
  async status(id: string, identity: CustomerIdentity) {
    const job = await this.model.find(id);
    const owned = job?.account_id ? job.account_id === identity.account?.id : Boolean(job?.guest_id && job.guest_id === identity.guest?.id);
    if (!job || !owned) throw new AppError(404, 'JOB_NOT_FOUND', 'Generation job unavailable');
    const result = await this.model.result(job.id);
    return { ...this.response(job), provider: job.provider, model: job.model, error_code: job.error_code, error_message: job.error_message,
      result_id: result?.id ?? null, result_url: result ? `/api/results/${result.id}` : null,
      download_url: result ? `/api/results/${result.id}/download` : null, updated_at: job.updated_at,
      started_at: job.started_at, finished_at: job.finished_at };
  }
}
