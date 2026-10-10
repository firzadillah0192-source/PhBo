import test from 'node:test'
import assert from 'node:assert/strict'
import { TOP_UP_OPTIONS, topUpPrice, MODE_NAMES } from './creditCatalog.js'
test('top ups keep Rp100 denomination including custom and reject invalid values', () => {
  for (const item of TOP_UP_OPTIONS) assert.equal(topUpPrice(item.credits), item.credits * 100)
  assert.equal(topUpPrice('750'), 75000)
  for (const value of ['', '0', '-1', '1.5', '1e3', 'NaN', '9007199254740991']) assert.equal(topUpPrice(value), null)
})
test('customer mode names describe outcomes without changing persisted mode identifiers', () => {
  assert.equal(MODE_NAMES.CLASSIC, 'Photo Booth'); assert.equal(MODE_NAMES.BASIC, 'Scene Remix'); assert.equal(MODE_NAMES.ADVANCED, 'Creative Studio')
})
