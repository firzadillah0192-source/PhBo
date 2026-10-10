import type { NxGenerationJob } from '@prisma/client';
import type { CustomerGenerationModel } from '../models/customer-generation.model.js';
import type { ProviderRunModel } from '../models/provider-run.model.js';
import type { CustomerUploadService } from './customer-upload.service.js';
import type { ClassicGenerationRunner } from './classic-generation-runner.service.js';
import type { NativeImageEngineService } from './native-image-engine.service.js';
import type { NativeAIProvider } from './native-provider.service.js';
import { composeAdvancedPrompt, composeBasicPrompt } from './advanced-prompt.service.js';
import { validateAdvancedSelection } from './customer-generation-input.js';
import { AppError } from '../lib/errors.js';
import { ProviderFailure } from './native-provider.service.js';
import { parseGenerationSnapshot } from './generation-snapshot.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { CatalogAssetsService } from './catalog-assets.service.js';

export class NativeGenerationRunner {
  constructor(private readonly model: CustomerGenerationModel, private readonly runs: ProviderRunModel, private readonly uploads: CustomerUploadService,
    private readonly classic: ClassicGenerationRunner, private readonly images: NativeImageEngineService, private readonly provider: NativeAIProvider,
    private readonly basicModelExperienceId = 'mini-me', private readonly assets?: CatalogAssetsService) {}
  async generate(job: NxGenerationJob) {
    if (job.mode === 'CLASSIC') return this.classic.generate(job);
    const owner = { account: job.account_id ? { id: job.account_id } : null, guest: job.guest_id ? { id: job.guest_id } : null };
    const source = await this.uploads.read((await this.uploads.owned(job.upload_id, owner)).path);
    const snapshot = parseGenerationSnapshot(job.engine_config_json,job.mode);
    if (job.mode === 'BASIC') {
      if (!this.assets) throw new AppError(503, 'BASIC_ENGINE_NOT_CONNECTED', 'Basic template editing is not connected.');
      if (snapshot?.mode === 'BASIC' && snapshot.version === 2) {
        return this.generateBasic(job, source, snapshot.prompt, snapshot.model, snapshot.template);
      }
      const row = await this.model.template(job.template_id);
      if (!row?.enabled) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Basic template unavailable.');
      const modelPreset = snapshot?.mode === 'BASIC' ? snapshot : await this.model.experience(this.basicModelExperienceId);
      if (!modelPreset?.model || (!snapshot && ('status' in modelPreset && (modelPreset.status !== 'published' || !modelPreset.enabled)))) throw new AppError(503, 'AI_MODEL_NOT_CONFIGURED', 'The AI generation model is not configured.');
      // Legacy queued jobs retain their model, but cannot use the old scene-regeneration prompt.
      return this.generateBasic(job, source, composeBasicPrompt(row.name, row.description), modelPreset.model, await this.assets.freezeBasicTemplate(row));
    }
    if (snapshot && snapshot.mode === 'ADVANCED') return this.generateWithProvider(job,source,snapshot.prompt,snapshot.model);
    if (job.mode !== 'ADVANCED') throw new AppError(422, 'VALIDATION_FAILED', 'Invalid generation mode.');
    const experience = job.experience_id ? await this.model.experience(job.experience_id) : null;
    if (!experience) throw new AppError(404, 'EXPERIENCE_NOT_FOUND', 'Experience unavailable.');
    const frame = job.frame_style_id ? await this.model.frame(job.frame_style_id) : null;
    const ids = JSON.parse(job.ornament_ids_json ?? '[]') as string[];
    validateAdvancedSelection(experience, frame, await this.model.ornaments(ids), ids);
    const prompt = composeAdvancedPrompt(experience.internal_prompt, frame!.prompt_fragment);
    return this.generateWithProvider(job, source, prompt, experience.model);
  }
  private async generateBasic(job: NxGenerationJob, source: Buffer, prompt: string, model: string,
    template: { asset: string; sha256: string; width: number; height: number }) {
    const path = await this.assets!.file(template.asset);
    if (!path) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Basic template unavailable.');
    const original = await readFile(path);
    if (createHash('sha256').update(original).digest('hex') !== template.sha256) throw new AppError(422, 'BASIC_TEMPLATE_INVALID', 'Saved Basic template has changed.');
    const dimensions = await sharp(original, { limitInputPixels: 25_000_000 }).metadata();
    if (dimensions.width !== template.width || dimensions.height !== template.height) throw new AppError(422, 'BASIC_TEMPLATE_INVALID', 'Saved Basic template dimensions are invalid.');
    // Validate both faces before making a paid provider request.
    const identity = await this.images.basicIdentity(source);
    const base = await this.images.basicTemplate(original);
    const run = await this.runs.start(job, this.provider.name, model);
    let image;
    try {
      if (!this.provider.available()) throw new ProviderFailure('AI_PROVIDER_NOT_CONNECTED', 'The AI provider is not connected.', { upstream_status: 'NOT_CONNECTED', retry_count: 0 });
      image = await this.provider.generate(identity, prompt, model, { bytes: base, width: template.width, height: template.height });
    } catch (error) { await this.runs.finish(run, job, null, error); throw error; }
    await this.runs.finish(run, job, image);
    // Return the AI edit itself: no post-generation face detection, landmark
    // rejection or local face blending. Template fidelity is prompt-controlled.
    // Preserve every provider pixel when its canvas already matches. Otherwise
    // fit the complete image without stretching or cropping the frame/footer.
    const output = sharp(image.bytes, { limitInputPixels: 25_000_000 });
    const generated = await output.metadata();
    const bytes = generated.width === template.width && generated.height === template.height
      ? image.bytes
      : await output.resize(template.width, template.height, { fit: 'contain', background: 'white' }).png().toBuffer();
    return { bytes, provider: image.provider, model: image.model,
      canvas: { width: template.width, height: template.height } };
  }
  private async generateWithProvider(job: NxGenerationJob, source: Buffer, prompt: string, model: string) {
    const run = await this.runs.start(job, this.provider.name, model);
    let image;
    try {
      if (!this.provider.available()) throw new ProviderFailure('AI_PROVIDER_NOT_CONNECTED', 'The AI provider is not connected.', { upstream_status: 'NOT_CONNECTED', retry_count: 0 });
      image = await this.provider.generate(await this.images.providerInput(source), prompt, model);
    } catch (error) { await this.runs.finish(run, job, null, error); throw error; }
    await this.runs.finish(run, job, image);
    return { bytes: await this.images.advancedResult(image.bytes), provider: image.provider, model: image.model };
  }
}
