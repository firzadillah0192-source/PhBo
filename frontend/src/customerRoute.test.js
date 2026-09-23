import assert from 'node:assert/strict'
import test from 'node:test'
import { accountTabRoute, kioskModeRoute, kioskResultRoute, modeRoute, parseCustomerRoute, stageForRoute } from './customerRoute.js'
import { experienceSections, reconcileSelectedExperienceId } from './components/customer/experienceCatalog.js'

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


test('advanced gallery mirrors the public API catalog exactly', () => {
  const apiResponse = {
    experiences: [{ id: 'mini-me', name: 'Mini Me', category: 'Playful', thumbnail: null }],
  }
  const oneCard = experienceSections(apiResponse.experiences).flatMap((section) => section.items)
  assert.deepEqual(oneCard.map((item) => item.id), ['mini-me'])
  assert.equal(oneCard[0].name, 'Mini Me')
  for (const forbidden of ['3D Avatar', 'Anime', 'Animal Infographic', '8-bit Game']) {
    assert.equal(oneCard.some((item) => item.name === forbidden), false)
  }

  const fortyFour = Array.from({ length: 44 }, (_, index) => ({
    id: `published-${index + 1}`,
    name: `Published ${index + 1}`,
    category: index % 2 ? 'Fantasy' : 'Portrait',
    thumbnail: null,
  }))
  const cards = experienceSections({ experiences: fortyFour }.experiences).flatMap((section) => section.items)
  assert.equal(cards.length, 44)
  assert.equal(new Set(cards.map((item) => item.id)).size, 44)
})

test('stale advanced selections are never preserved', () => {
  const published = [{ id: 'mini-me' }]
  assert.equal(reconcileSelectedExperienceId('3d-avatar', published), 'mini-me')
  assert.equal(reconcileSelectedExperienceId('3d-avatar', [{ id: 'published-1' }, { id: 'published-2' }]), null)
  assert.equal(reconcileSelectedExperienceId('published-1', [{ id: 'published-1' }, { id: 'published-2' }]), 'published-1')
})


test('account center tab URLs survive refresh and reject unknown tabs', () => {
  const direct = parseCustomerRoute('/account', '?tab=security')
  const clicked = parseCustomerRoute(new URL(accountTabRoute('security'), 'https://photobooth.test').pathname, '?tab=security')
  assert.deepEqual(clicked, direct)
  assert.equal(stageForRoute(direct), 'account')
  assert.equal(parseCustomerRoute('/account', '?tab=unknown').tab, 'overview')
})


test('kiosk and public claim routes are explicit and refresh-safe', () => {
  const kiosk = parseCustomerRoute('/kiosk/create', '?mode=advanced')
  assert.equal(kiosk.kiosk, true)
  assert.equal(kiosk.mode, 'ADVANCED')
  assert.equal(stageForRoute(kiosk), 'gallery')
  const result = parseCustomerRoute(new URL(kioskResultRoute('result-1'), 'https://photobooth.test').pathname, '')
  assert.equal(result.kiosk, true)
  assert.equal(result.id, 'result-1')
  assert.equal(stageForRoute(result), 'result')
  assert.equal(parseCustomerRoute('/r/opaque-token-value', '').name, 'claim')
  assert.equal(kioskModeRoute('BASIC'), '/kiosk/create?mode=basic')
})
