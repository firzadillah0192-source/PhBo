import test from 'node:test'
import assert from 'node:assert/strict'
import { selectionOptions, jobDestination } from './generation.mjs'
const photos = n => Array.from({ length: n }, (_, i) => ({ upload_id: 'synthetic-' + i }))
test('Classic uses exactly the published photo count, including four shots', () => {
  for (const count of [1, 2, 3, 4]) assert.equal(selectionOptions('CLASSIC', { id: 'layout', shot_count: count }, '', photos(count)).captureUploadIds.length, count)
  assert.throws(() => selectionOptions('CLASSIC', { id: 'layout', shot_count: 4 }, '', photos(3)))
  assert.throws(() => selectionOptions('CLASSIC', { id: 'layout', shot_count: 2 }, '', [{ upload_id: 'same' }, { upload_id: 'same' }]))
})
test('personalized Classic requires an event name and valid capture timestamp', () => {
  const layout = { id: 'event', shot_count: 1, requires_event_name: true }
  for (const input of [{}, { eventName: 'Valid' }, { eventName: '\u0000', capturedAt: new Date().toISOString() }]) assert.throws(() => selectionOptions('CLASSIC', layout, '', photos(1), input))
  assert.equal(selectionOptions('CLASSIC', layout, '', photos(1), { eventName: ' Event ', capturedAt: '2026-10-11T01:00:00Z' }).eventName, 'Event')
})
test('AI requires a real upload, selection and Advanced frame', () => {
  assert.throws(() => selectionOptions('BASIC', null, '', photos(1)))
  assert.throws(() => selectionOptions('BASIC', { id: 'theme' }, '', []))
  assert.throws(() => selectionOptions('ADVANCED', { id: 'style' }, '', photos(1)))
  assert.deepEqual(selectionOptions('ADVANCED', { id: 'style' }, 'frame', photos(1), { ornamentIds: ['stars'] }).ornamentIds, ['stars'])
})
test('only a backend-completed, payable result can become a result route', () => {
  for (const state of ['QUEUED', 'PROCESSING', 'FAILED']) assert.equal(jobDestination({ state, result_id: 'r' }), null)
  assert.equal(jobDestination({ state: 'COMPLETED' }), null)
  assert.equal(jobDestination({ state: 'COMPLETED', result_id: 'r', credit_charge: { status: 'PENDING' } }), null)
  assert.equal(jobDestination({ state: 'COMPLETED', result_id: 'r', credit_charge: { status: 'PAID' } }), '/app/result/r')
})
