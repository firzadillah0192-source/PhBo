import type { NxGenerationJob } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { CatalogAssetError, type CatalogAssetsService } from './catalog-assets.service.js';
import type { CustomerUploadService } from './customer-upload.service.js';
import type { CustomerGenerationModel } from '../models/customer-generation.model.js';
import type { CustomerIdentity } from './customer-account.service.js';
import { generationInput, validateAdvancedSelection } from './customer-generation-input.js';
import { legacyId } from './customer-credentials.service.js';
import { generationRequest } from './generation-request.js';
import type { KioskGenerationContext } from '../models/native-kiosk.model.js';
import { composeAdvancedPrompt,composeBasicPrompt } from './advanced-prompt.service.js';
import type { GenerationSnapshot } from './generation-snapshot.js';
import { randomBytes } from 'node:crypto';

export type GenerationQueue = { enqueue(id: string): Promise<void> };
export class CustomerGenerationService {
  constructor(private readonly model: CustomerGenerationModel, private readonly uploads: CustomerUploadService,
    private readonly assets: CatalogAssetsService, private readonly queue: GenerationQueue,
    private readonly basicModelExperienceId = 'mini-me') {}
  response(job: NxGenerationJob) {
    return { job_id: job.id, state: job.state, upload_id: job.upload_id, template_id: job.template_id || null,
      experience_id: job.experience_id, mode: job.mode, layout_id: job.layout_id, frame_style_id: job.frame_style_id,
      ornament_ids: JSON.parse(job.ornament_ids_json ?? '[]'), created_at: job.created_at };
  }
  async create(body: unknown, identity: CustomerIdentity, requestKey?: unknown, kiosk?: KioskGenerationContext) {
    const input = generationInput.parse(body);
    const request = generationRequest(requestKey, input, identity);
    if (request) {
      const existing = await this.model.findRequest(request);
      if (existing) return this.response(existing);
    }
    const source = await this.uploads.owned(input.upload_id, identity);
    let frame: string | null = null;
    let snapshot: GenerationSnapshot;
    if (input.mode === 'BASIC') {
      const template = await this.model.template(input.template_id!);
      if (!template?.enabled) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template unavailable');
      // Use registered assets; do not infer face geometry or modify the engine.
      if (!await this.assets.file(template.image_path)) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template unavailable');
      const preset = await this.model.experience(this.basicModelExperienceId);
      if (preset?.status!=='published' || !preset.enabled || !preset.model) throw new AppError(503,'AI_MODEL_NOT_CONFIGURED','The AI generation model is not configured.');
      let frozen;
      try { frozen = await this.assets.freezeBasicTemplate(template); }
      catch (error) { if (error instanceof CatalogAssetError) throw new AppError(422, 'BASIC_TEMPLATE_INVALID', 'Basic template is invalid.'); throw error; }
      snapshot = { version: 2,mode: 'BASIC',prompt: composeBasicPrompt(template.name,template.description),model: preset.model,template: frozen };
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
      snapshot = { version: 1,mode: 'CLASSIC',layout: await this.assets.freezeLayout(layout) };
      if (layout.id === 'classic-floral-event-001') {
        if (kiosk) throw new AppError(422, 'CLASSIC_LAYOUT_INVALID', 'Event personalization is available in the web studio.');
        if (!input.event_name) throw new AppError(422, 'EVENT_NAME_REQUIRED', 'Isi nama event sebelum mengambil foto.');
        const capturedAt = input.captured_at ? new Date(input.captured_at) : source.upload.created_at;
        if (capturedAt.getTime() > source.upload.created_at.getTime() + 60000 || capturedAt.getTime() < source.upload.created_at.getTime() - 3600000) throw new AppError(422, 'CAPTURE_TIME_INVALID', 'Waktu pengambilan foto tidak valid. Ambil foto kembali.');
        snapshot.personalization = { event_name: input.event_name.normalize('NFC'), captured_at: capturedAt.toISOString(), claim_token: randomBytes(32).toString('base64url') };
      }
    } else {
      const experience = await this.model.experience(input.experience_id!);
      if (experience?.status !== 'published') throw new AppError(404, 'EXPERIENCE_NOT_FOUND', 'Experience unavailable');
      frame = input.frame_style_id ?? 'natural';
      const style = await this.model.frame(frame);
      validateAdvancedSelection(experience, style, await this.model.ornaments(input.ornament_ids), input.ornament_ids);
      snapshot = { version: 1,mode: 'ADVANCED',prompt: composeAdvancedPrompt(experience.internal_prompt,style!.prompt_fragment),model: experience.model };
    }
    const data = { id: legacyId(), upload_id: source.upload.id, account_id: identity.account?.id ?? null,
      guest_id: identity.guest?.id ?? null, mode: input.mode, template_id: input.template_id ?? '',
      experience_id: input.experience_id ?? null, layout_id: input.layout_id ?? null,
      capture_upload_ids_json: input.mode === 'CLASSIC' ? JSON.stringify(input.capture_upload_ids) : null,
      frame_style_id: frame, ornament_ids_json: frame ? JSON.stringify(input.ornament_ids) : null,
      engine_config_json: JSON.stringify(snapshot),state: 'QUEUED' };
    if (kiosk && !request) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Generation request key required');
    const created = request ? await this.model.createOnce(data, request, kiosk) : { job: await this.model.create(data), reused: false };
    const job = created.job;
    if (created.reused) return this.response(job);
    try { await this.queue.enqueue(job.id); }
    catch { await this.model.queueFailed(job.id); throw new AppError(503, 'QUEUE_UNAVAILABLE', 'Generation queue is unavailable.'); }
    return this.response(job);
  }
  async status(id: string, identity: CustomerIdentity) {
    const job = await this.model.find(id);
    const owned = job?.account_id ? job.account_id === identity.account?.id : Boolean(job?.guest_id && job.guest_id === identity.guest?.id);
    if (!job || !owned) throw new AppError(404, 'JOB_NOT_FOUND', 'Generation job unavailable');
    const billing = await this.model.billing(job.id, job.state === 'COMPLETED');
    const paid = !billing || billing.status === 'PAID';
    const result = paid ? await this.model.result(job.id) : null;
    return { ...this.response(job), credit_charge: billing ? { status: billing.status, credits: billing.credits, calculation: billing.calculation_json ? JSON.parse(billing.calculation_json) : null } : null, provider: job.provider, model: job.model, error_code: job.error_code, error_message: job.error_message,
      result_id: result?.id ?? null, result_url: result ? `/api/results/${result.id}` : null,
      download_url: result ? `/api/results/${result.id}/download` : null, updated_at: job.updated_at,
      started_at: job.started_at, finished_at: job.finished_at };
  }
}
