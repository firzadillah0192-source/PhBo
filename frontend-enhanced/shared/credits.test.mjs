import test from 'node:test'
import assert from 'node:assert/strict'
import {minimumCredits, canStart} from './credits.mjs'
test('Classic has a one-credit gate; AI has a ten-credit start gate', () => {
  assert.equal(minimumCredits('classic'), 1)
  for (const mode of ['BASIC', 'ADVANCED']) { assert.equal(minimumCredits(mode), 10); assert.equal(canStart(mode, 9), false); assert.equal(canStart(mode, 10), true) }
  assert.equal(canStart('CLASSIC', 0), false); assert.equal(canStart('CLASSIC', 1), true)
  for(const balance of [undefined, null, NaN, '50']) assert.equal(canStart('BASIC', balance), false)
})
