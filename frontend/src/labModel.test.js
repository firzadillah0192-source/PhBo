import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedFrames, modelFits, scenarioBody, scenarioPayload, scenarioRefCount, capabilities, costLabel, idr, pricingPayload, runBody, splitList, usd, isTerminal } from './labModel.js'

test('unknown pricing is never displayed as a number', () => {
  assert.equal(costLabel({ known: false, usd: null }), 'Pricing Unknown')
  assert.equal(costLabel({ known: true, usd: 0.02 }), '$0.0200')
  assert.equal(usd(null), '—'); assert.equal(idr(null), '—')
})
test('pricing payload drops blanks and keeps source and verification date', () => {
  const body = pricingPayload({ method: 'per_image', per_image_usd: '0.02', per_megapixel_usd: '', source: 'docs', verified_at: '2026-10-01', assumptions: 'a' })
  assert.deepEqual(Object.keys(body).sort(), ['assumptions', 'currency', 'method', 'per_image_usd', 'source', 'verified_at'])
  assert.equal(body.per_image_usd, 0.02); assert.ok(body.verified_at.startsWith('2026-10-01'))
})
test('request body only includes parameters the model supports', () => {
  const form = { prompt: 'p', negative_prompt: 'n', size: '1024*1024', quality: 'high', seed: '5', output_format: 'png' }
  assert.deepEqual(runBody(form, capabilities(null)), { prompt: 'p' })
  const caps = capabilities({ max_reference_images: 3, supports: { seed: true, size: true, negative_prompt: false, quality: [], output_format: ['png'] }, sizes: [] })
  assert.deepEqual(runBody(form, caps), { prompt: 'p', size: '1024*1024', seed: 5, output_format: 'png' })
})
test('helpers', () => { assert.deepEqual(splitList('a, b,,c'), ['a', 'b', 'c']); assert.equal(isTerminal({ status: 'PROCESSING' }), false); assert.equal(isTerminal({ status: 'FAILED' }), true) })

test('scenario helpers: model fit, payload and server-owned fields', () => {
  const two = { max_reference_images: 2, tasks: ['image-to-image'] }, one = { max_reference_images: 1, tasks: ['image-to-image'] }, t2i = { max_reference_images: 0, tasks: ['text-to-image'] }
  assert.deepEqual([modelFits(two, 'basic'), modelFits(one, 'basic'), modelFits(one, 'advanced'), modelFits(t2i, 'advanced'), modelFits(t2i, 'freeform')], [true, false, true, false, true])
  assert.equal(scenarioRefCount('basic'), 1); assert.equal(scenarioRefCount('advanced'), 0)
  assert.deepEqual(scenarioPayload('advanced', { experience_id: 'e', frame_style_id: 'f', template_id: 'x' }), { kind: 'advanced', experience_id: 'e', frame_style_id: 'f' })
  const caps = capabilities({ max_reference_images: 2, supports: { seed: true, size: true, negative_prompt: true, quality: [], output_format: [] }, sizes: [] })
  assert.deepEqual(scenarioBody({ prompt: 'x', negative_prompt: 'n', size: '1x1', seed: '3' }, caps), { seed: 3 })
  const catalog = { advanced: { experiences: [{ id: 'e', compatible_frame_style_ids: ['a'] }, { id: 'f', compatible_frame_style_ids: null }], frame_styles: [{ id: 'a' }, { id: 'b' }] } }
  assert.deepEqual(allowedFrames(catalog, 'e').map((x) => x.id), ['a']); assert.deepEqual(allowedFrames(catalog, 'f').map((x) => x.id), ['a', 'b'])
})

