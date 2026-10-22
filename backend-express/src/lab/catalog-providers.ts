import type { LabModel, Pricing } from './types.js';

// Curated candidate models for providers whose API has no schema/price endpoint. Prices appear only where the vendor
// publishes them (checked 2026-10-13, source in each entry); everything else is registered with Pricing Unknown so no
// run can be authorised until an admin enters the price. Registration never contacts the provider to generate.
export type Candidate = { model_id: string; name: string; kind: 't2i' | 'edit'; max_images: number; pricing?: Partial<Pricing>; quality?: string[]; output_format?: string[]; size?: boolean; seed?: boolean; notes?: string };
const unknown = (source: string): Pricing => ({ method: 'unknown', currency: 'USD', source, verified_at: null, assumptions: 'No vendor price entered yet. Set the per-image or token price on the model before testing.' });

const SRC = 'OpenAI API pricing page (developers.openai.com/api/docs/pricing), checked 2026-10-13';
// Token rates are published. Per-image token counts are NOT published for GPT Image 2.5; the tier assumptions below are
// derived from the published GPT Image 2 per-image table at 1024x1024 (low $0.006, medium $0.053, high $0.211 at $30/M
// output tokens), which is an upper bound for the smaller 1536x1024 sizes. Input tokens for a template + face edit are a
// guess. These are labelled estimates; the real cost is calculated from the usage OpenAI returns after each run.
const tokens = (input: number, output: number, tiers?: Record<string, number>): Partial<Pricing> => ({
  method: 'tokens', input_usd_per_million_tokens: input, output_usd_per_million_tokens: output, assumed_input_tokens: 3000,
  ...(tiers ? { assumed_output_tokens_by_quality: tiers } : {}), source: SRC,
  assumptions: tiers ? 'Image-input and output token rates are published. Output tokens per quality tier are derived from the GPT Image 2 per-image table (1024x1024); input tokens (3000) are an assumption for template + face. xhigh/max are not priced until measured. The measured cost after each run is calculated from the usage OpenAI returns.'
    : 'Token rates are published; token counts per image are not. Pick a quality and read the measured cost after the first run, or enter your own assumed output tokens on the model.',
});
const TIER_2 = { low: 200, medium: 1767, high: 7033 };
const Q_NEW = ['low', 'medium', 'high', 'xhigh', 'max'], Q_OLD = ['low', 'medium', 'high'], FMT = ['png', 'jpeg', 'webp'];
export const STATIC_CANDIDATES: Record<string, Candidate[]> = {
  openai: [
    { model_id: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst', kind: 'edit', max_images: 16, quality: Q_NEW, output_format: FMT, size: true, pricing: tokens(8, 30, TIER_2), notes: 'Most capable model. Same token rates as Flare.' },
    { model_id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5 Flare', kind: 'edit', max_images: 16, quality: Q_NEW, output_format: FMT, size: true, pricing: tokens(8, 30, TIER_2), notes: 'Fast everyday model. Same token rates as Sunburst.' },
    { model_id: 'gpt-image-2', name: 'GPT Image 2', kind: 'edit', max_images: 16, quality: Q_OLD, output_format: FMT, size: true, pricing: tokens(8, 30, TIER_2) },
    { model_id: 'gpt-image-1.5', name: 'GPT Image 1.5', kind: 'edit', max_images: 16, quality: Q_OLD, output_format: FMT, size: true, pricing: tokens(8, 32) },
    { model_id: 'gpt-image-1', name: 'GPT Image 1', kind: 'edit', max_images: 16, quality: Q_OLD, output_format: FMT, size: true, pricing: tokens(10, 40) },
    { model_id: 'gpt-image-1-mini', name: 'GPT Image 1 Mini', kind: 'edit', max_images: 16, quality: Q_OLD, output_format: FMT, size: true, pricing: tokens(2.5, 8) },
    { model_id: 'chatgpt-image-latest', name: 'ChatGPT Image (latest)', kind: 'edit', max_images: 16, quality: Q_OLD, output_format: FMT, size: true, pricing: tokens(8, 32) },
  ],
  runway: [
    { model_id: 'gen4_image_turbo', name: 'Runway Gen-4 Image Turbo', kind: 'edit', max_images: 3, size: true, seed: true,
      pricing: { method: 'per_image', per_image_usd: 0.02, source: 'Runway pricing: 2 credits per image at $0.01 per credit', assumptions: 'Credits are billed from the Runway developer portal; the Lab cannot confirm the charge.' },
      notes: 'Reference images are sent untagged (style/identity guidance). Runway accepts a fixed list of ratios.' },
    { model_id: 'gen4_image', name: 'Runway Gen-4 Image', kind: 'edit', max_images: 3, size: true, seed: true,
      pricing: { method: 'per_image', per_image_usd: 0.08, source: 'Runway pricing: 5 credits (720p) or 8 credits (1080p) per image at $0.01 per credit', assumptions: 'Uses the 1080p price (8 credits) as the safe upper bound.' },
      notes: 'Reference images are sent untagged (style/identity guidance). Runway accepts a fixed list of ratios.' },
  ],
  recraft: [
    { model_id: 'recraftv3', name: 'Recraft V3', kind: 'edit', max_images: 1, size: true, seed: true,
      pricing: { method: 'per_image', per_image_usd: 0.04, source: 'Recraft API pricing page (raster, recraftv3)', assumptions: 'Vendor-published raster price.' },
      notes: 'Image-to-image takes ONE input image, so NXBooth Basic (template + face) cannot run on Recraft.' },
    { model_id: 'recraftv4_1', name: 'Recraft V4.1', kind: 'edit', max_images: 1, size: true, seed: true, notes: 'Image-to-image takes ONE input image, so NXBooth Basic cannot run on Recraft. Price not published on the API page.' },
    { model_id: 'recraftv4_1_flash', name: 'Recraft V4.1 Flash', kind: 't2i', max_images: 0, size: true, seed: true, notes: 'Text-to-image only.' },
  ],
  fal: [
    { model_id: 'fal-ai/nano-banana/edit', name: 'Nano Banana (edit)', kind: 'edit', max_images: 10, notes: 'Model id from fal docs; confirm in the fal dashboard before the first paid test.' },
    { model_id: 'fal-ai/flux-pro/kontext/multi', name: 'FLUX Kontext Pro (multi image)', kind: 'edit', max_images: 4, seed: true, notes: 'Model id from fal docs; confirm in the fal dashboard before the first paid test.' },
  ],
};
// Heuristic for live model lists (OpenAI and OpenAI-style gateways): keep only image-generating ids.
export const looksLikeImageModel = (id: string, type: string) =>
  type === 'openai' ? /^(gpt-image|chatgpt-image|dall-e)/i.test(id) : /(image|dall-e|flux|imagen|sdxl|stable-diffusion|recraft)/i.test(id);

export function candidateModel(providerId: string, providerType: string, c: Candidate, newId: () => string, now: string, live: boolean): LabModel {
  const pricing: Pricing = c.pricing ? { ...unknown(''), ...c.pricing, currency: 'USD', verified_at: now } as Pricing : unknown(`${providerType} has no price API`);
  return {
    id: newId(), provider_id: providerId, model_id: c.model_id, display_name: c.name,
    tasks: c.kind === 't2i' ? ['text-to-image'] : c.max_images > 1 ? ['image-to-image', 'multi-reference-edit'] : ['image-to-image'],
    sizes: [], max_reference_images: c.max_images,
    supports: { negative_prompt: false, seed: !!c.seed, size: c.size ?? false, quality: c.quality ?? [], output_format: c.output_format ?? [] },
    pricing, status: 'untested', enabled: true, last_tested_at: null, created_at: now, updated_at: now,
    verification: { status: 'unverified', note: '', run_id: null, difference_usd: null, at: null, by: null },
    schema_source: live ? `${providerType} model list (live)` : `${providerType} public documentation`, schema_verified_at: null,
    notes: c.notes ?? '',
  };
}
