import { readFile } from 'node:fs/promises';
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

export class NativeGenerationRunner {
  constructor(private readonly model: CustomerGenerationModel, private readonly runs: ProviderRunModel, private readonly uploads: CustomerUploadService,
    private readonly classic: ClassicGenerationRunner, private readonly images: NativeImageEngineService, private readonly provider: NativeAIProvider,
    private readonly basicModelExperienceId = 'mini-me') {}
  async generate(job: NxGenerationJob) {
    if (job.mode === 'CLASSIC') return this.classic.generate(job);
    const owner = { account: job.account_id ? { id: job.account_id } : null, guest: job.guest_id ? { id: job.guest_id } : null };
    const source = await readFile((await this.uploads.owned(job.upload_id, owner)).path);
    if (job.mode === 'BASIC') {
      const row = await this.model.template(job.template_id);
      if (!row?.enabled) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Basic template unavailable.');
      const modelPreset = await this.model.experience(this.basicModelExperienceId);
      if (modelPreset?.status !== 'published' || !modelPreset.enabled || !modelPreset.model) throw new AppError(503, 'AI_MODEL_NOT_CONFIGURED', 'The AI generation model is not configured.');
      return this.generateWithProvider(job, source, composeBasicPrompt(row.name, row.description), modelPreset.model);
    }
    if (job.mode !== 'ADVANCED') throw new AppError(422, 'VALIDATION_FAILED', 'Invalid generation mode.');
    const experience = job.experience_id ? await this.model.experience(job.experience_id) : null;
    if (!experience) throw new AppError(404, 'EXPERIENCE_NOT_FOUND', 'Experience unavailable.');
    const frame = job.frame_style_id ? await this.model.frame(job.frame_style_id) : null;
    const ids = JSON.parse(job.ornament_ids_json ?? '[]') as string[];
    validateAdvancedSelection(experience, frame, await this.model.ornaments(ids), ids);
    const prompt = composeAdvancedPrompt(experience.internal_prompt, frame!.prompt_fragment);
    return this.generateWithProvider(job, source, prompt, experience.model);
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
