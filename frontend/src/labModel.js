// Pure helpers for the AI Provider Lab UI (unit-tested; no React).
export const PRICING_METHODS = [
  ['unknown', 'Pricing Unknown'], ['per_image', 'Fixed price per image'], ['per_megapixel', 'Price per megapixel'],
  ['tokens', 'Input / output tokens'], ['compute_time', 'Compute time'],
]
export const RATING_LABELS = [
  ['identity', 'Facial identity preservation'], ['template', 'Template preservation'], ['hair_pose', 'Hair and pose consistency'],
  ['lighting', 'Lighting consistency'], ['quality', 'Visual quality'], ['print', 'Print readiness'], ['overall', 'Overall suitability for NXBooth'],
]
export function usd(value) { return value === null || value === undefined ? '—' : '$' + Number(value).toFixed(value < 0.01 && value > 0 ? 6 : 4) }
export function idr(value) { return value === null || value === undefined ? '—' : 'Rp ' + Math.round(value).toLocaleString('id-ID') }
export function costLabel(estimate) { return estimate && estimate.known ? usd(estimate.usd) : 'Pricing Unknown' }
export function numberOrUndefined(value) { if (value === '' || value === null || value === undefined) return undefined; const n = Number(value); return Number.isFinite(n) ? n : undefined }
export function pricingPayload(form) {
  const out = { method: form.method, currency: 'USD', source: form.source || '', verified_at: form.verified_at ? new Date(form.verified_at).toISOString() : null, assumptions: form.assumptions || '' }
  for (const key of ['per_image_usd', 'per_megapixel_usd', 'input_usd_per_million_tokens', 'output_usd_per_million_tokens', 'per_second_usd', 'reference_image_fee_usd', 'assumed_input_tokens', 'assumed_output_tokens', 'assumed_seconds']) {
    const value = numberOrUndefined(form[key]); if (value !== undefined) out[key] = value
  }
  return out
}
export function splitList(text) { return String(text || '').split(',').map((item) => item.trim()).filter(Boolean) }
// Which controls a model supports, so the UI never offers (or sends) unsupported parameters.
export function capabilities(model) {
  if (!model) return { images: 0, size: false, seed: false, negative: false, quality: [], formats: [], sizes: [] }
  const supports = model.supports || {}
  return { images: model.max_reference_images || 0, size: Boolean(supports.size), seed: Boolean(supports.seed), negative: Boolean(supports.negative_prompt),
    quality: supports.quality || [], formats: supports.output_format || [], sizes: model.sizes || [] }
}
export function runBody(form, caps) {
  const body = { prompt: form.prompt }
  if (caps.negative && form.negative_prompt) body.negative_prompt = form.negative_prompt
  if (caps.size && form.size) body.size = form.size
  if (caps.quality.length && form.quality) body.quality = form.quality
  if (caps.formats.length && form.output_format) body.output_format = form.output_format
  const seed = numberOrUndefined(form.seed); if (caps.seed && seed !== undefined && Number.isInteger(seed)) body.seed = seed
  return body
}
export const isTerminal = (run) => run && (run.status === 'SUCCEEDED' || run.status === 'FAILED')

// NXBooth scenarios: Basic sends template + customer photo (2 images); Advanced sends the customer photo (1 image).
export const SCENARIO_KINDS = [['freeform', 'Free test (own images & prompt)'], ['basic', 'NXBooth Basic (template → face)'], ['advanced', 'NXBooth Advanced (experience + frame)']]
export function modelFits(model, kind) {
  if (!model || kind === 'freeform') return true
  if (kind === 'basic') return model.max_reference_images >= 2 && model.tasks.some((t) => t !== 'text-to-image')
  return model.max_reference_images >= 1 && model.tasks.some((t) => t !== 'text-to-image')
}
export function scenarioRefCount(kind) { return kind === 'basic' ? 1 : 0 }
export function scenarioPayload(kind, sel) {
  return kind === 'basic' ? { kind, template_id: sel.template_id } : { kind, experience_id: sel.experience_id, frame_style_id: sel.frame_style_id }
}
// Prompt, negative prompt and size are server-owned in scenario mode and must not be sent.
export function scenarioBody(form, caps) { const { prompt, negative_prompt, size, ...rest } = runBody({ ...form, prompt: '-' }, caps); return rest }
export function allowedFrames(catalog, experienceId) {
  const exp = catalog?.advanced.experiences.find((e) => e.id === experienceId)
  const all = catalog?.advanced.frame_styles || []
  return exp?.compatible_frame_style_ids ? all.filter((f) => exp.compatible_frame_style_ids.includes(f.id)) : all
}

