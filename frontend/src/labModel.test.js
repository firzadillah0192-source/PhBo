import test from 'node:test'
import assert from 'node:assert/strict'
import { whyNotFit, cleanParams, diffLabel, nextInQueue, paramsFor, tokenLabel, allowedFrames, modelFits, scenarioBody, scenarioPayload, scenarioRefCount, capabilities, costLabel, idr, pricingPayload, runBody, splitList, usd, isTerminal } from './labModel.js'

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


test('schema-driven params: only set values are sent, typed per spec', () => {
  const model = { params: [{ name: 'size', type: 'text' }, { name: 'seed', type: 'int' }, { name: 'enable_web_search', type: 'bool' }, { name: 'resolution', type: 'enum' }] }
  assert.deepEqual(cleanParams(model, { size: '1024*1024', seed: '-1', enable_web_search: true, resolution: '', unknown: 'x' }), { size: '1024*1024', seed: -1, enable_web_search: true })
  assert.deepEqual(cleanParams(model, { enable_web_search: false }), {})
  assert.deepEqual(cleanParams(model, { enable_web_search: 'false' }), { enable_web_search: false }, 'a default-on option can be turned off explicitly')
  assert.deepEqual(cleanParams(model, { enable_web_search: 'true' }), { enable_web_search: true })
  assert.deepEqual(paramsFor({ supports: { size: true, quality: ['high'], seed: true, output_format: [] }, sizes: [] }).map((p) => p.name), ['size', 'quality', 'seed'])
})
test('tokens are N/A unless reported; cost difference is signed; queue points at the next unverified model', () => {
  assert.equal(tokenLabel(null), 'N/A'); assert.equal(tokenLabel({ availability: 'not_reported' }), 'N/A')
  assert.equal(tokenLabel({ availability: 'reported', input: 10, output: 20, total: 30 }), '10 in / 20 out / 30 total')
  assert.deepEqual([diffLabel(0.004), diffLabel(-0.004), diffLabel(0), diffLabel(null)], ['+$0.0040', '−$0.0040', '±$0.0000', '—'])
  const models = [{ id: 'b', sequence: 2, verification: { status: 'unverified' } }, { id: 'a', sequence: 1, verification: { status: 'verified' } }, { id: 'e', sequence: null }]
  assert.equal(nextInQueue(models).id, 'b'); assert.equal(nextInQueue([{ sequence: 1, verification: { status: 'blocked' } }]), null)
})

test('models that cannot run Basic/Advanced say why', () => {
  const t2i = { tasks: ['text-to-image'], max_reference_images: 0 }, one = { tasks: ['image-to-image'], max_reference_images: 1 }, many = { tasks: ['image-to-image'], max_reference_images: 10 }
  assert.match(whyNotFit(t2i, 'basic'), /text-to-image only/); assert.match(whyNotFit(one, 'basic'), /Basic needs 2/)
  assert.equal(whyNotFit(one, 'advanced'), ''); assert.equal(whyNotFit(many, 'basic'), ''); assert.equal(whyNotFit(t2i, 'freeform'), '')
})
