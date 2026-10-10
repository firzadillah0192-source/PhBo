import test from 'node:test'
import assert from 'node:assert/strict'
import { checkoutDestination, checkoutUnavailable } from './topUpCheckout.js'

test('server checkout accepts HTTPS and same-origin development links only', () => {
  const origin = 'http://localhost:5195'
  assert.equal(checkoutDestination({ checkout_url: 'https://checkout.example.invalid/session/123' }, origin), 'https://checkout.example.invalid/session/123')
  assert.equal(checkoutDestination({ checkout_url: '/payment/123' }, origin), origin + '/payment/123')
  for (const checkout_url of ['javascript:alert(1)', 'data:text/html,test', 'http://external.example.invalid', 'https://user:password@example.invalid', '']) {
    assert.equal(checkoutDestination({ checkout_url }, origin), null)
  }
  assert.equal(checkoutDestination({}, origin), null)
})

test('unavailable gateway and network errors use the support popup; auth and validation errors do not', () => {
  for (const status of [404, 502, 503, 504]) assert.equal(checkoutUnavailable({ status }), true)
  assert.equal(checkoutUnavailable(new TypeError('Failed to fetch')), true)
  assert.equal(checkoutUnavailable({ errorCode: 'PAYMENT_GATEWAY_UNAVAILABLE' }), true)
  for (const status of [400, 401, 403, 422]) assert.equal(checkoutUnavailable({ status }), false)
})
