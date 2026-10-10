import test from 'node:test'
import assert from 'node:assert/strict'
import { recordStudioStep, restoredStudioStep } from './studioHistory.js'

test('studio browser Back/Forward restores the step while keeping unrelated history state', () => {
  const entries = [{ external: 'keep' }]
  let index = 0
  const history = {
    get state() { return entries[index] },
    replaceState(value) { entries[index] = value },
    pushState(value) { entries.splice(++index, entries.length, value) },
    back() { index -= 1 },
  }
  recordStudioStep(history, 'ADVANCED', 'gallery', 'art-direction')
  recordStudioStep(history, 'ADVANCED', 'art-direction', 'photo')
  recordStudioStep(history, 'ADVANCED', 'photo', 'review')
  history.back()
  assert.equal(restoredStudioStep(history.state, 'ADVANCED'), 'photo')
  recordStudioStep(history, 'ADVANCED', 'photo', 'art-direction')
  assert.equal(index, 1, 'The in-app back button reuses the preceding entry')
  assert.equal(restoredStudioStep(history.state, 'ADVANCED'), 'art-direction')
  history.back()
  assert.equal(restoredStudioStep(history.state, 'ADVANCED'), 'gallery')
  assert.equal(history.state.external, 'keep')
  assert.equal(entries.length, 4, 'Returning never creates another history entry')
})

test('untrusted, cross-mode and job states cannot restore an editable step', () => {
  for (const state of [null, {}, { studioMode: 'BASIC', studioStage: 'photo' }, { studioMode: 'ADVANCED', studioStage: 'processing' }]) {
    assert.equal(restoredStudioStep(state, 'ADVANCED'), null)
  }
  const history = { replaceState() { assert.fail('Invalid transition must not change history') } }
  recordStudioStep(history, 'BASIC', 'photo', 'photo')
  recordStudioStep(history, 'BASIC', 'review', 'processing')
})
