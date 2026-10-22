import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { CustomerCatalogModel } from '../models/customer-catalog.model.js';
import type { CatalogAssetsService } from '../services/catalog-assets.service.js';
import { composeAdvancedPrompt, composeBasicPrompt } from '../services/advanced-prompt.service.js';
import { validateAdvancedSelection } from '../services/customer-generation-input.js';
import type { NativeImageEngineService } from '../services/native-image-engine.service.js';
import { LabError, type NxScenarioSource, type ScenarioCatalog, type ScenarioPlan, type ScenarioSelection } from '../lab/types.js';

// READ-ONLY bridge between the Lab and the production catalog. It reuses the same prompt composers and the same
// private image-helper preparation endpoints as the customer flow so that provider tests reflect real Basic and
// Advanced requests. It never creates jobs, reserves credits, freezes template snapshots or calls a provider.
const variantOf = (id: string): 'man' | 'woman' | 'hijab' | 'other' => /-hijab(-|$)/.test(id) ? 'hijab' : /-man(-|$)/.test(id) ? 'man' : /-(woman|female)(-|$)/.test(id) ? 'woman' : 'woman';
const themeOf = (id: string) => id.replace(/-(hijab|man|woman|female|framed)(?=-|$)/g, '').replace(/-\d+$/, '');

// Same directives as the production Basic prompt, shortened to fit models that cap prompts at 800 characters.
// Used only for those models, and flagged on the run. Production itself always sends the full prompt.
export function compactBasicPrompt(templateName: string) {
  return `Edit Image 1 (template "${templateName.trim().slice(0, 60)}") using the person in Image 2. Keep Image 1's scene, costume, body, pose, head position, hair, skin tone, lighting, frame, title and all lettering unchanged. Bring in the recognizable eye shape, eyebrows, nose and lips of the person in Image 2 as a subtle, template-dominant resemblance, not a literal replacement; do not copy their cheek, jaw or chin outline. Match Image 1's lighting and rendering so the face looks naturally photographed, never pasted. Return one complete image at Image 1's canvas, preserving every existing letter and graphic including NXBooth.`;
}

export class NxScenarios implements NxScenarioSource {
  constructor(private readonly catalogModel: CustomerCatalogModel, private readonly assets: CatalogAssetsService,
    private readonly images: NativeImageEngineService, private readonly basicModelExperienceId: string) {}

  async catalog(): Promise<ScenarioCatalog> {
    const basic: ScenarioCatalog['basic'] = [];
    for (const row of await this.catalogModel.templates()) {
      const meta = await this.assets.templateMetadata(row).catch(() => null);
      basic.push({ id: row.id, name: row.name, description: row.description, theme: themeOf(row.id), variant: variantOf(row.id), width: meta?.width ?? null, height: meta?.height ?? null });
    }
    const experiences = (await this.catalogModel.experiences()).map(e => ({ id: e.id, name: e.name, description: e.description, category: e.category,
      compatible_frame_style_ids: e.compatible_frame_style_ids_json ? (JSON.parse(e.compatible_frame_style_ids_json) as string[]) : null }));
    const frame_styles = (await this.catalogModel.styles()).map(f => ({ id: f.id, name: f.name, description: f.description }));
    return { basic, advanced: { experiences, frame_styles } };
  }

  async plan(selection: ScenarioSelection, face: Buffer): Promise<ScenarioPlan> {
    return selection.kind === 'basic' ? this.basic(selection.template_id, face) : this.advanced(selection.experience_id, selection.frame_style_id, face);
  }

  private async basic(templateId: string, face: Buffer): Promise<ScenarioPlan> {
    const row = await this.catalogModel.template(templateId);
    if (!row?.enabled) throw new LabError(404, 'LAB_SCENARIO_NOT_FOUND', 'Basic template unavailable.');
    const path = await this.assets.file(row.image_path);
    if (!path) throw new LabError(404, 'LAB_SCENARIO_NOT_FOUND', 'Basic template image is missing.');
    const original = await readFile(path), info = await sharp(original, { limitInputPixels: 25_000_000 }).metadata();
    if (info.format !== 'png' || !info.width || !info.height) throw new LabError(422, 'LAB_SCENARIO_INVALID', 'Basic template image is invalid.');
    // Same preparation as production: face crop for identity, normalized canvas for the template.
    const identity = await this.images.basicIdentity(face), base = await this.images.basicTemplate(original);
    const model = (await this.catalogModel.experience(this.basicModelExperienceId))?.model ?? null;
    const canvas = { width: info.width, height: info.height };
    return { kind: 'basic', label: `Basic · ${row.name}`, production_model: model, meta: { template_id: row.id, variant: variantOf(row.id), canvas: `${canvas.width}x${canvas.height}` },
      prompt: composeBasicPrompt(row.name, row.description), compact_prompt: compactBasicPrompt(row.name), images: [{ bytes: base, role: 'template' }, { bytes: identity, role: 'reference' }], production_size: canvas,
      // Production returns the provider image as-is when the canvas matches, otherwise fits it without cropping.
      finish: async bytes => { const m = await sharp(bytes, { limitInputPixels: 64_000_000 }).metadata();
        return m.width === canvas.width && m.height === canvas.height ? bytes : sharp(bytes).resize(canvas.width, canvas.height, { fit: 'contain', background: 'white' }).png().toBuffer(); } };
  }

  private async advanced(experienceId: string, frameId: string, face: Buffer): Promise<ScenarioPlan> {
    const experience = await this.catalogModel.experience(experienceId), frame = (await this.catalogModel.styles()).find(f => f.id === frameId) ?? null;
    if (!experience || experience.status !== 'published') throw new LabError(404, 'LAB_SCENARIO_NOT_FOUND', 'Experience unavailable.');
    try { validateAdvancedSelection(experience, frame, [], []); } catch (e) { throw new LabError(422, 'LAB_SCENARIO_INVALID', (e as Error).message); }
    const input = await this.images.providerInput(face);
    return { kind: 'advanced', label: `Advanced · ${experience.name} + ${frame!.name}`, production_model: experience.model, meta: { experience_id: experience.id, frame_style_id: frame!.id },
      prompt: composeAdvancedPrompt(experience.internal_prompt, frame!.prompt_fragment), images: [{ bytes: input, role: 'reference' }], production_size: { width: 1024, height: 1024 },
      // Production post-processes the provider image into the 2:3 print master with application-owned branding.
      finish: bytes => this.images.advancedResult(bytes) };
  }
}
