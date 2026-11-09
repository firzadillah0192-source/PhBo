import assert from 'node:assert/strict'
import test from 'node:test'
import { modeRoute, parseCustomerRoute, stageForRoute } from './customerRoute.js'

test('mode links and direct URLs resolve to the same route state', () => {
  for (const mode of ['BASIC', 'ADVANCED']) {
    const direct = parseCustomerRoute('/create', `?mode=${mode.toLowerCase()}`)
    const clicked = parseCustomerRoute(new URL(modeRoute(mode), 'https://photobooth.test').pathname, `?mode=${mode.toLowerCase()}`)
    assert.deepEqual(clicked, direct)
    assert.equal(stageForRoute(direct), 'gallery')
    assert.equal(direct.mode, mode)
  }
})

test('home, back, forward and refresh remain URL-derived', () => {
  const history = ['/', modeRoute('ADVANCED'), modeRoute('BASIC')]
  assert.equal(stageForRoute(parseCustomerRoute(history[0], '')), 'home')
  assert.equal(parseCustomerRoute(history[1].split('?')[0], '?mode=advanced').mode, 'ADVANCED')
  assert.equal(parseCustomerRoute(history[2].split('?')[0], '?mode=basic').mode, 'BASIC')
  assert.equal(stageForRoute(parseCustomerRoute('/create', '?mode=advanced')), 'gallery')
})
