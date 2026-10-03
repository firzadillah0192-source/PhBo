import { z } from 'zod';
import type { AiEngineService, ClassicInput } from './ai-engine.service.js';
import type { NineRouterService, ExperiencePreset } from './ninerouter.service.js';
import type { CreateGenerationInput } from '../objects/requests.js';
import { ensure } from '../lib/errors.js';
import { experiencePresets } from './experience-presets.js';
import { composeBasicPrompt } from './advanced-prompt.service.js';

const snapshotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('python-classic') }),
  z.object({ kind: z.literal('9router-basic'), templateId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/), experience: z.object({ id: z.string(), name: z.string(),
    description: z.string(), model: z.string().min(1), prompt: z.string().min(1) }) }),
  z.object({ kind: z.literal('9router'), experience: z.object({ id: z.string(), name: z.string(),
    description: z.string(), model: z.string().min(1), prompt: z.string().min(1) }) }),
]);
export type EngineSnapshot = z.infer<typeof snapshotSchema>;

export class GenerationEngineService {
  constructor(private readonly python: Pick<AiEngineService, 'assertConfigured' | 'generate'>,
    private readonly advanced: Pick<NineRouterService, 'assertConfigured' | 'generate'>,
    private readonly defaults: { BASIC_TEMPLATE_ID: string; ADVANCED_EXPERIENCE_ID: string },
    private readonly presets: readonly ExperiencePreset[] = experiencePresets) {}

  assertConfigured(mode: string = 'BASIC') {
    if (mode === 'CLASSIC') this.python.assertConfigured();
    else this.advanced.assertConfigured();
  }

  snapshot(input: Pick<CreateGenerationInput, 'mode' | 'templateId' | 'experienceId'>): EngineSnapshot {
    if (input.mode === 'CLASSIC') return { kind: 'python-classic' };
    if (input.mode === 'BASIC') {
      const templateId = input.templateId ?? this.defaults.BASIC_TEMPLATE_ID;
      const modelPreset = this.presets.find(p => p.id === this.defaults.ADVANCED_EXPERIENCE_ID);
      ensure(modelPreset, 503, 'AI_MODEL_NOT_CONFIGURED', 'The AI generation model is not configured');
      const templateName = templateId.replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
      return { kind: '9router-basic', templateId, experience: {
        id: `basic:${templateId}`, name: templateName, description: 'Create a polished photobooth portrait inspired by this visual theme.',
        model: modelPreset.model, prompt: composeBasicPrompt(templateName, 'Create a polished photobooth portrait inspired by this visual theme.'),
      } };
    }
    const preset = this.presets.find(p => p.id === (input.experienceId ?? this.defaults.ADVANCED_EXPERIENCE_ID));
    ensure(preset, 404, 'EXPERIENCE_NOT_FOUND', 'Experience not found');
    return { kind: '9router', experience: { ...preset } };
  }

  listExperiences() { return this.presets.map(({ id, name, description }) => ({ id, name, description })); }

  async generate(original: Buffer, mode: 'CLASSIC' | 'BASIC' | 'ADVANCED', jobId: string, config?: unknown, classic?: ClassicInput) {
    const snapshot = config == null ? this.snapshot({ mode }) : snapshotSchema.parse(config);
    const matches = mode === 'CLASSIC' ? snapshot.kind === 'python-classic'
      : mode === 'BASIC' ? snapshot.kind === '9router-basic' : snapshot.kind === '9router';
    ensure(matches, 500, 'ENGINE_CONFIG_INVALID', 'Job engine configuration does not match mode');
    if (mode === 'CLASSIC' && snapshot.kind === 'python-classic') return this.python.generate(original, 'CLASSIC', jobId, undefined, classic ?? { photos: [original], frame: null });
    if (snapshot.kind === '9router' || snapshot.kind === '9router-basic') return this.advanced.generate(original, snapshot.experience);
    ensure(false, 500, 'ENGINE_CONFIG_INVALID', 'Job engine configuration does not match mode');
  }
}
