import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_USD_TO_IDR, rupiahFromUsd } from './pricingDisplay.js'

test('Chibi simulation converts with the selected exchange rate', () => {
  assert.equal(DEFAULT_USD_TO_IDR, 18000)
  assert.match(rupiahFromUsd(0.028195, DEFAULT_USD_TO_IDR), /507,51/)
  assert.match(rupiahFromUsd(0.037876, DEFAULT_USD_TO_IDR), /681,77/)
  assert.match(rupiahFromUsd(0.028195, 16000), /451,12/)
  assert.match(rupiahFromUsd(0.037876, 16000), /606,02/)
  assert.match(rupiahFromUsd(0.028195, 20000), /563,9/)
})

test('Missing cost and invalid rates do not display a zero price', () => {
  for (const [value, rate] of [[null, 16000], [0.01, 0], [0.01, NaN]]) assert.equal(rupiahFromUsd(value, rate), 'Tidak tersedia')
  assert.match(rupiahFromUsd(0, 16000), /Rp/)
})
