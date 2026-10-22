// Pure helpers for the AI Provider Lab UI (unit-tested; no React).
export const PRICING_METHODS = [
  ['unknown', 'Pricing Unknown'], ['per_image', 'Fixed price per image'], ['per_megapixel', 'Price per megapixel'],
  ['tokens', 'Input / output tokens'], ['compute_time', 'Compute time'], ['provider_quote', 'Provider price quotation (per request)'],
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
  // Per-quality token assumptions have no form field; keep them when a model is edited.
  if (form.assumed_output_tokens_by_quality && typeof form.assumed_output_tokens_by_quality === 'object') out.assumed_output_tokens_by_quality = form.assumed_output_tokens_by_quality
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
export const isTerminal = (run) => run && ['SUCCEEDED', 'FAILED', 'AMBIGUOUS'].includes(run.status)

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


// ---- schema-driven parameters (WaveSpeed models carry a verified parameter schema) ----
export function paramsFor(model) {
  if (!model) return []
  if (model.params) return model.params
  const s = model.supports || {}, out = []
  if (s.size) out.push({ name: 'size', label: 'Size', type: model.sizes?.length ? 'enum' : 'text', values: model.sizes })
  if (s.quality?.length) out.push({ name: 'quality', label: 'Quality', type: 'enum', values: s.quality })
  if (s.seed) out.push({ name: 'seed', label: 'Seed', type: 'int' })
  if (s.output_format?.length) out.push({ name: 'output_format', label: 'Output format', type: 'enum', values: s.output_format })
  return out
}
// Only values the admin actually set are sent; empty means "provider default" (so the quote matches the provider's own default).
export function cleanParams(model, values) {
  const out = {}
  for (const spec of paramsFor(model)) {
    const v = values?.[spec.name]
    if (v === undefined || v === null || v === '' || v === false) continue
    if (spec.type === 'int') { const n = Number(v); if (Number.isInteger(n)) out[spec.name] = n } else if (spec.type === 'bool') { if (v === true || v === 'true') out[spec.name] = true; else if (v === 'false') out[spec.name] = false }
    else out[spec.name] = String(v)
  }
  return out
}
export function quoteKey(parts) { return JSON.stringify(parts) }
export const COST_TONE = { Estimated: '', 'Pending Billing': 'warn', Confirmed: 'ok', Unavailable: 'bad', Review: 'warn' }
export function tokenLabel(tokens) {
  if (!tokens || tokens.availability !== 'reported') return 'N/A'
  const f = (n) => (n === null || n === undefined ? '—' : n.toLocaleString())
  return `${f(tokens.input)} in / ${f(tokens.output)} out / ${f(tokens.total)} total`
}
export function diffLabel(diff) { if (diff === null || diff === undefined) return '—'; return (diff > 0 ? '+' : diff < 0 ? '−' : '±') + '$' + Math.abs(diff).toFixed(4) }
export function nextInQueue(models) { return [...models].filter((m) => typeof m.sequence === 'number').sort((a, b) => a.sequence - b.sequence).find((m) => (m.verification?.status || 'unverified') === 'unverified') || null }

// Why a model cannot run a Basic/Advanced test (shown next to the model name).
export function whyNotFit(model, kind) {
  if (!model || kind === 'freeform' || modelFits(model, kind)) return ''
  if (!model.tasks.some((t) => t !== 'text-to-image')) return 'text-to-image only: cannot take a face photo'
  return `accepts ${model.max_reference_images} input image(s); ${kind === 'basic' ? 'Basic needs 2' : 'Advanced needs 1'}`
}
