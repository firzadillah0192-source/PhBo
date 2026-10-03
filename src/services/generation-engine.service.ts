import { z } from 'zod';
import type { AiEngineService, ClassicInput } from './ai-engine.service.js';
import type { NineRouterService, ExperiencePreset } from './ninerouter.service.js';
import type { CreateGenerationInput } from '../objects/requests.js';
import { ensure } from '../lib/errors.js';
import { experiencePresets } from './experience-presets.js';

const snapshotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('python-classic') }),
  z.object({ kind: z.literal('python-basic'), templateId: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/) }),
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
    if (mode === 'ADVANCED') this.advanced.assertConfigured();
    else this.python.assertConfigured();
  }

  snapshot(input: Pick<CreateGenerationInput, 'mode' | 'templateId' | 'experienceId'>): EngineSnapshot {
    if (input.mode === 'CLASSIC') return { kind: 'python-classic' };
    if (input.mode !== 'ADVANCED') return { kind: 'python-basic', templateId: input.templateId ?? this.defaults.BASIC_TEMPLATE_ID };
    const preset = this.presets.find(p => p.id === (input.experienceId ?? this.defaults.ADVANCED_EXPERIENCE_ID));
    ensure(preset, 404, 'EXPERIENCE_NOT_FOUND', 'Experience not found');
    return { kind: '9router', experience: { ...preset } };
  }

  listExperiences() { return this.presets.map(({ id, name, description }) => ({ id, name, description })); }

  async generate(original: Buffer, mode: 'CLASSIC' | 'BASIC' | 'ADVANCED', jobId: string, config?: unknown, classic?: ClassicInput) {
    const snapshot = config == null ? this.snapshot({ mode }) : snapshotSchema.parse(config);
    ensure((mode === 'ADVANCED') === (snapshot.kind === '9router'), 500, 'ENGINE_CONFIG_INVALID', 'Job engine configuration does not match mode');
    if (mode === 'CLASSIC') return this.python.generate(original, 'CLASSIC', jobId, undefined, classic ?? { photos: [original], frame: null });
    ensure(snapshot.kind !== 'python-classic', 500, 'ENGINE_CONFIG_INVALID', 'Job engine configuration does not match mode');
    if (snapshot.kind === '9router') return this.advanced.generate(original, snapshot.experience);
    return this.python.generate(original, 'BASIC', jobId, snapshot.templateId);
  }
}
