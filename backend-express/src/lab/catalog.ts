import type { LabModel, ParamSpec } from './types.js';

// Candidate WaveSpeedAI models with schemas copied from each model's official page
// (https://wavespeed.ai/models/<model id>/llms.txt, checked 2026-10-12). Nothing here is a price: pricing always comes
// from the provider's Pricing API per request. enable_sync_mode / enable_base64_output are deliberately not exposed.
// Bump when catalog-owned fields change; Register candidate models then refreshes models created from an older catalog.
export const CATALOG_VERSION = 5;
export const WAVESPEED_SCHEMA_CHECKED = '2026-10-12T00:00:00.000Z';
const AR15 = ['1:1', '1:2', '2:1', '1:3', '3:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '9:21', '21:9'];
const AR_NB2 = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '1:4', '4:1', '1:8', '8:1'];
const AR_NBP = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const ar = (values: string[], note?: string): ParamSpec => ({ name: 'aspect_ratio', label: 'Aspect ratio', type: 'enum', values, billing_relevant: true, ...(note ? { note } : {}) });
const res = (values: string[], def = '1k', note?: string): ParamSpec => ({ name: 'resolution', label: 'Resolution', type: 'enum', values, default: def, billing_relevant: true, ...(note ? { note } : {}) });
const fmt = (values: string[], def: string): ParamSpec => ({ name: 'output_format', label: 'Output format', type: 'enum', values, default: def });
const quality = (values: string[]): ParamSpec => ({ name: 'quality', label: 'Quality', type: 'enum', values, default: 'medium', billing_relevant: true, note: 'Higher tiers cost more.' });
const seed = (extra: Partial<ParamSpec> = {}): ParamSpec => ({ name: 'seed', label: 'Seed (-1 = random)', type: 'int', min: -1, ...extra });
const bool = (name: string, label: string, billing = false): ParamSpec => ({ name, label, type: 'bool', default: false, ...(billing ? { billing_relevant: true } : {}) });
const size: ParamSpec = { name: 'size', label: 'Size (width*height)', type: 'text', pattern: '^\\d{3,4}\\*\\d{3,4}$', side_range: [256, 1536], billing_relevant: true };

const sz = (lo: number, hi: number, def?: string): ParamSpec => ({ name: 'size', label: 'Size (width*height)', type: 'text', pattern: '^\\d{2,5}\\*\\d{2,5}$', side_range: [lo, hi], billing_relevant: true, ...(def ? { default: def } : {}) });
const boolOn = (name: string, label: string): ParamSpec => ({ name, label, type: 'bool', default: true });
const QSEED = seed({ max: 2147483647 });
type Entry = { model_id: string; name: string; kind: 't2i' | 'edit'; max_images: number; sequence: number | null; params: ParamSpec[]; prompt_max?: number; notes?: string; image_field?: 'images' | 'image'; ref_style?: 'figure' | 'picture' };
const ENTRIES: Entry[] = [
  { model_id: 'wavespeed-ai/z-image/turbo', name: 'Z-Image Turbo', kind: 't2i', max_images: 0, sequence: 1, params: [{ ...size, default: '1024*1024' }, seed(), fmt(['jpeg', 'png', 'webp'], 'jpeg')],
    notes: 'The model also accepts an optional reference image with strength; the Lab registers it as text-to-image only.' },
  { model_id: 'openai/gpt-image-2.5-flare/text-to-image', name: 'GPT Image 2.5 Flare (text-to-image)', kind: 't2i', max_images: 0, sequence: 2,
    params: [ar(AR15), res(['1k', '2k', '4k']), quality(['low', 'medium', 'high', 'xhigh', 'max']), fmt(['png', 'jpeg', 'webp'], 'png')] },
  { model_id: 'openai/gpt-image-2/text-to-image', name: 'GPT Image 2 (text-to-image)', kind: 't2i', max_images: 0, sequence: 3,
    params: [ar(AR15), res(['1k', '2k', '4k']), quality(['low', 'medium', 'high']), fmt(['png', 'jpeg', 'webp'], 'png')] },
  { model_id: 'bytedance/seedream-v5.0-flash', name: 'Seedream 5.0 Flash', kind: 't2i', max_images: 0, sequence: 4,
    params: [{ ...ar(AR15), default: '1:1' }, res(['1k', '1.5k', '2k'], '1k', 'All resolution tiers share one price.'), fmt(['jpeg', 'png'], 'jpeg')] },
  { model_id: 'alibaba/qwen-image-3.0/text-to-image', name: 'Qwen Image 3.0 (text-to-image)', kind: 't2i', max_images: 0, sequence: 5, prompt_max: 800,
    params: [{ ...ar(AR15), default: '1:1' }, res(['1k', '2k'], '1k', 'Used for billing.'), bool('enable_prompt_expansion', 'Prompt expansion'), seed({ max: 2147483647 })] },
  { model_id: 'bytedance/seedream-v5.0-pro', name: 'Seedream 5.0 Pro', kind: 't2i', max_images: 0, sequence: 6,
    params: [{ ...ar(AR15), default: '1:1' }, res(['1k', '1.5k', '2k'], '1k', '2k costs more than 1k.'), fmt(['jpeg', 'png'], 'jpeg'),
      { name: 'prompt_optimization_mode', label: 'Prompt optimization', type: 'enum', values: ['standard', 'fast'], default: 'standard' }] },
  { model_id: 'google/nano-banana-2/text-to-image', name: 'Nano Banana 2 (text-to-image)', kind: 't2i', max_images: 0, sequence: 7,
    params: [ar(AR_NB2), res(['0.5k', '1k', '2k', '4k']), bool('enable_web_search', 'Web search', true), bool('enable_image_search', 'Image search', true), fmt(['png', 'jpeg'], 'png')] },
  { model_id: 'google/nano-banana-pro/text-to-image', name: 'Nano Banana Pro (text-to-image)', kind: 't2i', max_images: 0, sequence: 8,
    params: [ar(AR_NBP), res(['1k', '2k', '4k']), fmt(['png', 'jpeg'], 'png')] },
  { model_id: 'openai/gpt-image-2.5-sunburst/text-to-image', name: 'GPT Image 2.5 Sunburst (text-to-image)', kind: 't2i', max_images: 0, sequence: null,
    params: [ar(AR15), res(['1k', '2k', '4k']), quality(['low', 'medium', 'high', 'xhigh', 'max']), fmt(['png', 'jpeg', 'webp'], 'png')] },
  // Image-editing variants: prepared, outside the one-by-one sequence.
  { model_id: 'openai/gpt-image-2.5-sunburst/edit', name: 'GPT Image 2.5 Sunburst (edit)', kind: 'edit', max_images: 16, sequence: null,
    params: [ar(AR15, 'Empty = detected from the input image.'), res(['1k', '2k', '4k']), quality(['low', 'medium', 'high', 'xhigh', 'max']), fmt(['png', 'jpeg', 'webp'], 'png')],
    notes: 'The API documentation states no image maximum; the WaveSpeed playground shows 16 reference images for GPT Image 2.5. NXBooth Basic needs 2 (template + face), the same request production sends to gpt-image-2.5. Unverified through the API: if WaveSpeed rejects the request, lower the limit.' },
  { model_id: 'bytedance/seedream-v5.0-flash/edit', name: 'Seedream 5.0 Flash (edit)', kind: 'edit', max_images: 10, sequence: null,
    params: [ar(AR15, 'Empty = closest ratio to the first input image.'), res(['1k', '1.5k', '2k'], '1k', 'All resolution tiers share one price.'), fmt(['jpeg', 'png'], 'jpeg')] },
  { model_id: 'bytedance/seedream-v5.0-pro/edit', name: 'Seedream 5.0 Pro (edit)', kind: 'edit', max_images: 10, sequence: null,
    params: [ar(AR15, 'Empty = closest ratio to the first input image.'), res(['1k', '1.5k', '2k'], '1k'), fmt(['jpeg', 'png'], 'jpeg'),
      { name: 'prompt_optimization_mode', label: 'Prompt optimization', type: 'enum', values: ['standard', 'fast'], default: 'standard' }] },
  { model_id: 'google/nano-banana-2/edit', name: 'Nano Banana 2 (edit)', kind: 'edit', max_images: 14, sequence: null,
    params: [ar(AR_NB2), res(['0.5k', '1k', '2k', '4k']), bool('enable_web_search', 'Web search', true), bool('enable_image_search', 'Image search', true), fmt(['png', 'jpeg'], 'png')] },
  { model_id: 'openai/gpt-image-2.5-flare/edit', name: 'GPT Image 2.5 Flare (edit)', kind: 'edit', max_images: 16, sequence: null,
    params: [ar(AR15, 'Empty = detected from the input image.'), res(['1k', '2k', '4k']), quality(['low', 'medium', 'high', 'xhigh', 'max']), fmt(['png', 'jpeg', 'webp'], 'png')],
    notes: 'The API documentation states no image maximum; the WaveSpeed playground shows 16 reference images for GPT Image 2.5. NXBooth Basic needs 2 (template + face), the same request production sends to gpt-image-2.5. Unverified through the API: if WaveSpeed rejects the request, lower the limit.' },
  { model_id: 'openai/gpt-image-2/edit', name: 'GPT Image 2 (edit)', kind: 'edit', max_images: 16, sequence: null,
    params: [ar(AR15, 'Empty = detected from the input image.'), res(['1k', '2k', '4k']), quality(['low', 'medium', 'high']), fmt(['png', 'jpeg', 'webp'], 'png')],
    notes: 'The API documentation states no image maximum; the WaveSpeed playground shows 16 reference images for GPT Image 2. NXBooth Basic needs 2 (template + face). Unverified through the API: if WaveSpeed rejects the request, lower the limit.' },
  { model_id: 'google/nano-banana-pro/edit', name: 'Nano Banana Pro (edit)', kind: 'edit', max_images: 14, sequence: null, params: [ar(AR_NBP), res(['1k', '2k', '4k']), fmt(['png', 'jpeg'], 'png')] },
  { model_id: 'alibaba/qwen-image-3.0/edit', name: 'Qwen Image 3.0 (edit)', kind: 'edit', max_images: 3, sequence: null, prompt_max: 800,
    params: [{ ...ar(AR15, 'Empty = ratio of the first input image.') }, res(['1k', '2k'], '1k', 'Used for billing.'), bool('enable_prompt_expansion', 'Prompt expansion'), seed({ max: 2147483647 })],
    notes: 'Prompts are limited to 800 characters, so Basic tests use a condensed version of the production prompt; Advanced tests are refused. Input images must be 384-2048 px per side.' },
  { model_id: 'wavespeed-ai/qwen-image/edit-plus', name: 'Qwen Image Edit Plus', kind: 'edit', max_images: 3, sequence: null, params: [size, seed(), fmt(['jpeg', 'png', 'webp'], 'jpeg')] },
  // ---- more WaveSpeed image models (schemas from each model's official page, checked 2026-10-12) ----
  { model_id: 'google/nano-banana-2.1/text-to-image', name: 'Nano Banana 2.1 (text-to-image)', kind: 't2i', max_images: 0, sequence: null,
    params: [ar(AR_NB2), res(['1k', '2k', '4k']), bool('enable_web_search', 'Web search', true), bool('enable_image_search', 'Image search', true), fmt(['png', 'jpeg'], 'png')] },
  { model_id: 'alibaba/wan-2.7/text-to-image', name: 'WAN 2.7 (text-to-image)', kind: 't2i', max_images: 0, sequence: null, params: [sz(272, 4096, '1024*1024'), boolOn('thinking_mode', 'Thinking mode (slower, better reasoning)'), seed()] },
  { model_id: 'alibaba/wan-2.7/text-to-image-pro', name: 'WAN 2.7 Pro (text-to-image)', kind: 't2i', max_images: 0, sequence: null, params: [sz(272, 4096, '1024*1024'), boolOn('thinking_mode', 'Thinking mode (slower, better reasoning)'), seed()] },
  { model_id: 'bytedance/seedream-v5.0-lite', name: 'Seedream 5.0 Lite (text-to-image)', kind: 't2i', max_images: 0, sequence: null, params: [sz(64, 16384, '2048*2048'), fmt(['jpeg', 'png'], 'jpeg')] },
  { model_id: 'bytedance/seedream-v4.5', name: 'Seedream 4.5 (text-to-image)', kind: 't2i', max_images: 0, sequence: null, params: [sz(64, 16384, '2048*2048')] },
  { model_id: 'wavespeed-ai/minimax-h3/text-to-image', name: 'MiniMax H3 (text-to-image)', kind: 't2i', max_images: 0, sequence: null,
    params: [{ ...ar(AR15), default: '1:1' }, res(['1k', '2k'], '1k', '1k is about 1 MP, 2k about 4 MP.'), fmt(['jpeg', 'png', 'webp'], 'jpeg'), seed()] },
  { model_id: 'wavespeed-ai/qwen-image-2.0/text-to-image', name: 'Qwen Image 2.0 (text-to-image)', kind: 't2i', max_images: 0, sequence: null, prompt_max: 800, params: [sz(256, 4096, '1024*1024'), QSEED] },
  { model_id: 'wavespeed-ai/qwen-image-2.0-pro/text-to-image', name: 'Qwen Image 2.0 Pro (text-to-image)', kind: 't2i', max_images: 0, sequence: null, prompt_max: 800, params: [sz(256, 4096, '1024*1024'), QSEED] },
  { model_id: 'alibaba/qwen-image-3.0-pro/text-to-image', name: 'Qwen Image 3.0 Pro (text-to-image)', kind: 't2i', max_images: 0, sequence: null, prompt_max: 800,
    params: [{ ...ar(AR15), default: '1:1' }, res(['1k', '2k'], '1k', 'Used for billing.'), bool('enable_prompt_expansion', 'Prompt expansion'), QSEED] },
  { model_id: 'wavespeed-ai/flux-2-klein-9b/text-to-image', name: 'FLUX.2 Klein 9B (text-to-image)', kind: 't2i', max_images: 0, sequence: null, params: [sz(256, 2048, '1024*1024'), seed()] },
  { model_id: 'wavespeed-ai/flux-2-klein-4b/text-to-image', name: 'FLUX.2 Klein 4B (text-to-image)', kind: 't2i', max_images: 0, sequence: null, params: [sz(256, 2048, '1024*1024'), seed()] },
  { model_id: 'alibaba/wan-2.6/text-to-image', name: 'WAN 2.6 (text-to-image)', kind: 't2i', max_images: 0, sequence: null, params: [sz(384, 2880, '1024*1024'), bool('enable_prompt_expansion', 'Prompt expansion'), seed()] },
  { model_id: 'wavespeed-ai/qwen-image/text-to-image', name: 'Qwen Image (text-to-image)', kind: 't2i', max_images: 0, sequence: null, params: [sz(256, 1536, '1024*1024'), seed(), fmt(['jpeg', 'png', 'webp'], 'jpeg')] },
  { model_id: 'google/nano-banana-2.1/edit', name: 'Nano Banana 2.1 (edit)', kind: 'edit', max_images: 14, sequence: null,
    params: [ar(AR_NB2), res(['1k', '2k', '4k']), bool('enable_web_search', 'Web search', true), bool('enable_image_search', 'Image search', true), fmt(['png', 'jpeg'], 'png')] },
  { model_id: 'alibaba/wan-2.7/image-edit', name: 'WAN 2.7 (edit)', kind: 'edit', max_images: 9, sequence: null, params: [sz(272, 4096), seed()] },
  { model_id: 'alibaba/wan-2.7/image-edit-pro', name: 'WAN 2.7 Pro (edit)', kind: 'edit', max_images: 9, sequence: null, params: [sz(272, 4096), seed()] },
  { model_id: 'bytedance/seedream-v5.0-lite/edit', name: 'Seedream 5.0 Lite (edit)', kind: 'edit', max_images: 10, sequence: null, params: [sz(64, 16384), fmt(['jpeg', 'png'], 'jpeg')],
    ref_style: 'figure', notes: 'WaveSpeed refers to input images as "Figure 1", "Figure 2"; the Lab renames "Image 1/2" in the production prompt to match.' },
  { model_id: 'bytedance/seedream-v4.5/edit', name: 'Seedream 4.5 (edit)', kind: 'edit', max_images: 10, sequence: null, params: [sz(64, 16384)] },
  { model_id: 'wavespeed-ai/minimax-h3/image-edit', name: 'MiniMax H3 (edit)', kind: 'edit', max_images: 9, sequence: null,
    params: [ar(AR15, 'Empty = ratio of the first input image.'), res(['1k', '2k'], '1k'), fmt(['jpeg', 'png', 'webp'], 'jpeg'), seed()],
    ref_style: 'picture', notes: 'The documentation refers to input images as <Picture 1>, <Picture 2>; the Lab renames "Image 1/2" in the production prompt to match.' },
  { model_id: 'wavespeed-ai/qwen-image-2.0/edit', name: 'Qwen Image 2.0 (edit)', kind: 'edit', max_images: 3, sequence: null, prompt_max: 800, params: [sz(256, 4096), QSEED],
    notes: 'Prompts are limited to 800 characters, so Basic tests use a condensed version of the production prompt (same directives, shortened); Advanced tests are refused. Input images must be 384-3072 px per side.' },
  { model_id: 'wavespeed-ai/qwen-image-2.0-pro/edit', name: 'Qwen Image 2.0 Pro (edit)', kind: 'edit', max_images: 3, sequence: null, prompt_max: 800, params: [sz(256, 4096), QSEED],
    notes: 'Prompts are limited to 800 characters, so Basic tests use a condensed version of the production prompt (same directives, shortened); Advanced tests are refused. Input images must be 384-3072 px per side.' },
  { model_id: 'alibaba/qwen-image-3.0-pro/edit', name: 'Qwen Image 3.0 Pro (edit)', kind: 'edit', max_images: 3, sequence: null, prompt_max: 800,
    params: [ar(AR15, 'Empty = ratio of the first input image.'), res(['1k', '2k'], '1k', 'Used for billing.'), bool('enable_prompt_expansion', 'Prompt expansion'), QSEED],
    notes: 'Prompts are limited to 800 characters, so Basic tests use a condensed version of the production prompt; Advanced tests are refused. Input images must be 384-2048 px per side.' },
  { model_id: 'wavespeed-ai/flux-2-klein-9b/edit', name: 'FLUX.2 Klein 9B (edit)', kind: 'edit', max_images: 3, sequence: null, params: [sz(256, 2048), seed()] },
  { model_id: 'wavespeed-ai/flux-2-klein-4b/edit', name: 'FLUX.2 Klein 4B (edit)', kind: 'edit', max_images: 3, sequence: null, params: [sz(256, 2048), seed()] },
  { model_id: 'alibaba/wan-2.6/image-edit', name: 'WAN 2.6 (edit)', kind: 'edit', max_images: 3, sequence: null, params: [sz(384, 4096), bool('enable_prompt_expansion', 'Prompt expansion'), seed()] },
  { model_id: 'wavespeed-ai/qwen-image/edit', name: 'Qwen Image Edit (single image)', kind: 'edit', max_images: 1, sequence: null, image_field: 'image', params: [sz(256, 1536), seed(), fmt(['jpeg', 'png', 'webp'], 'jpeg')],
    notes: 'Takes a single input image in the `image` field, so it can run Advanced tests but not Basic (template + face).' },
];
export const WAVESPEED_CATALOG_IDS = ENTRIES.map(e => e.model_id);

// Builds model documents for a registered WaveSpeed provider. Pricing is the provider quote, never a local price.
export function wavespeedCatalog(providerId: string, newId: () => string, now: string): LabModel[] {
  return ENTRIES.map(e => ({
    id: newId(), provider_id: providerId, model_id: e.model_id, display_name: e.name,
    tasks: e.kind === 't2i' ? ['text-to-image'] : e.max_images > 1 ? ['image-to-image', 'multi-reference-edit'] : ['image-to-image'],
    sizes: [], max_reference_images: e.max_images, supports: { negative_prompt: false, seed: e.params.some(p => p.name === 'seed'), size: e.params.some(p => p.name === 'size'), quality: [], output_format: [] },
    pricing: { method: 'provider_quote', currency: 'USD', source: 'WaveSpeedAI Pricing API (POST /api/v3/model/price), per request', verified_at: null, assumptions: 'Request-specific provider quotation; the Lab keeps no local price table for this model.' },
    status: 'untested', enabled: true, last_tested_at: null, created_at: now, updated_at: now,
    params: e.params, prompt_max: e.prompt_max ?? null, sequence: e.sequence,
    verification: { status: 'unverified', note: '', run_id: null, difference_usd: null, at: null, by: null },
    schema_source: `https://wavespeed.ai/models/${e.model_id}/llms.txt`, schema_verified_at: WAVESPEED_SCHEMA_CHECKED, notes: e.notes ?? '', catalog_version: CATALOG_VERSION, ...(e.image_field ? { image_field: e.image_field } : {}), ...(e.ref_style ? { ref_style: e.ref_style } : {}),
  }));
}
