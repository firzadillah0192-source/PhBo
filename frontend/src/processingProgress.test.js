import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateProgress, processingPhrases } from './processingProgress.js'

test('queued progress stays low and running progress rises but never reaches 100', () => {
  assert.equal(estimateProgress('QUEUED', 0), 0)
  assert.ok(estimateProgress('QUEUED', 600000) <= 12)
  const early = estimateProgress('PROCESSING', 5000), late = estimateProgress('PROCESSING', 60000)
  assert.ok(early >= 12 && early < late)
  assert.ok(estimateProgress('PROCESSING', 3600000) <= 95)
  assert.ok(estimateProgress('PROCESSING', 10000, 'CLASSIC') > estimateProgress('PROCESSING', 10000, 'BASIC'))
})

test('phrases follow the mode and end with the last step', () => {
  const t = (id) => id
  assert.equal(processingPhrases('BASIC', t).at(-1), 'Satu langkah lagi…')
  assert.ok(processingPhrases('CLASSIC', t).includes('Memasang bingkai…'))
})
