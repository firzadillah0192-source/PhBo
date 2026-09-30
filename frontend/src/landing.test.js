import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { initialCustomerStage, parseCustomerRoute, stageForRoute } from './customerRoute.js'
import { featuredPreviews } from './components/home/landingCatalog.js'
import { customerFlowKey } from './customerSession.js'

test('marketing CTA reaches chooser and all three entries keep the existing routes', () => {
  assert.equal(stageForRoute(parseCustomerRoute('/')), 'home')
  assert.equal(stageForRoute(parseCustomerRoute('/create')), 'chooser')
  for (const mode of ['classic', 'basic', 'advanced']) {
    const route = parseCustomerRoute('/create', `?mode=${mode}`)
    assert.equal(route.mode, mode.toUpperCase())
    assert.equal(stageForRoute(route), 'gallery')
  }
})

test('landing and chooser preserve a saved creation without silently entering it', () => {
  const flow = { mode: 'ADVANCED', uploadId: 'upload-1', experienceId: 'published-world', frameStyleId: 'modern', ornamentIds: ['sparkles'], stage: 'review' }
  assert.equal(initialCustomerStage(parseCustomerRoute('/'), flow), 'home')
  assert.equal(initialCustomerStage(parseCustomerRoute('/create'), flow), 'chooser')
  assert.equal(initialCustomerStage(parseCustomerRoute('/create', '?mode=advanced'), flow), 'restoring')
  assert.equal(initialCustomerStage(parseCustomerRoute('/create', '?mode=basic'), flow), 'gallery')
  assert.equal(initialCustomerStage(parseCustomerRoute('/create', '?mode=advanced'), { ...flow, uploadId: null, stage: 'art-direction' }), 'art-direction')
  assert.equal(stageForRoute(parseCustomerRoute('/kiosk')), 'home')
  assert.equal(stageForRoute(parseCustomerRoute('/kiosk/create', '?mode=classic')), 'gallery')
  assert.equal(parseCustomerRoute('/r/token').name, 'claim')
  assert.equal(parseCustomerRoute('/result/result-1').id, 'result-1')
})

test('featured previews contain only public records with their own art and are capped at six', () => {
  const experiences = Array.from({ length: 10 }, (_, index) => ({ id: `public-${index}`, name: `World ${index}`, thumbnail: `/api/experiences/public-${index}/thumbnail`, enabled: true }))
  experiences.unshift({ id: 'draft', name: 'Draft', status: 'draft', thumbnail: '/draft.png' }, { id: 'disabled', enabled: false, thumbnail: '/disabled.png' }, { id: 'no-preview', name: 'No preview' })
  const templates = [{ id: 'framed', name: 'Framed world', preview_url: '/api/templates/framed/preview', basic_available: true }, { id: 'missing', basic_available: false, preview_url: '/missing.png' }]
  const featured = featuredPreviews(experiences, templates)
  assert.equal(featured.length, 6)
  assert.deepEqual(featured.slice(0, 3).map((item) => item.id), ['public-0', 'public-1', 'framed'])
  assert.equal(featured.some((item) => ['draft', 'disabled', 'no-preview', 'missing'].includes(item.id)), false)
  assert.equal(featured.find((item) => item.id === 'public-0').preview, '/api/experiences/public-0/thumbnail')
  assert.deepEqual(featuredPreviews([], []), [])
})

test('landing, chooser, sign-in and mobile component structure render through the real application shell', async () => {
  const vite = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  const originalWindow = globalThis.window
  const originalStorage = globalThis.sessionStorage
  const saved = JSON.stringify({ mode: 'ADVANCED', uploadId: 'saved-upload', experienceId: 'published-world', frameStyleId: 'modern', ornamentIds: ['sparkles'], stage: 'review' })
  const storage = { getItem: (key) => key === customerFlowKey() ? saved : null }
  globalThis.sessionStorage = storage
  try {
    const App = (await vite.ssrLoadModule('/src/App.jsx')).default
    const LandingPage = (await vite.ssrLoadModule('/src/components/home/LandingPage.jsx')).default
    const CustomerNav = (await vite.ssrLoadModule('/src/components/customer/CustomerNav.jsx')).default
    globalThis.window = { location: { pathname: '/', search: '' }, innerWidth: 390, sessionStorage: storage }
    const root = renderToStaticMarkup(React.createElement(App))
    assert.match(root, /Moments, made/)
    assert.match(root, /href="\/create"[^>]*>Try NXBooth Free/)
    for (const section of ['How it works', 'Three ways to create', 'Featured Experiences', 'Made to leave', 'Ready for your']) assert.ok(root.includes(section), section)
    assert.match(root, />Sign In</)
    assert.doesNotMatch(root, /customer-credit|AI credits|Photobooth AI|9Router|face swap|prompt composer/)
    assert.ok(root.indexOf('Moments, made') < root.indexOf('Classic Photobooth'))

    for (const width of [390, 768, 1024]) {
      globalThis.window = { location: { pathname: '/create', search: '' }, innerWidth: width, sessionStorage: storage }
      const chooser = renderToStaticMarkup(React.createElement(App))
      assert.match(chooser, /Choose how you want to create/)
      for (const mode of ['classic', 'basic', 'advanced']) assert.match(chooser, new RegExp(`href="/create\\?mode=${mode}"`))
      assert.match(chooser, /Resume your advanced creation/)
      assert.doesNotMatch(chooser, /Restoring your portrait/)
    }
    assert.equal(storage.getItem(customerFlowKey()), saved)

    const navProps = { usage: { ai_remaining: 2, authenticated: false } }
    const marketingNav = renderToStaticMarkup(React.createElement(CustomerNav, { ...navProps, marketing: true }))
    assert.doesNotMatch(marketingNav, /customer-credit|2 AI credits/)
    assert.match(marketingNav, /href="#experiences"/)
    const creationNav = renderToStaticMarkup(React.createElement(CustomerNav, navProps))
    assert.match(creationNav, /2 AI credits/)

    const featured = renderToStaticMarkup(React.createElement(LandingPage, { experiences: [{ id: 'public', name: 'Published World', thumbnail: '/api/experiences/public/thumbnail' }, { id: 'no-art', name: 'Unpictured World' }], templates: [{ id: 'basic-public', name: 'Curated World', preview_url: '/api/templates/basic-public/preview' }] }))
    assert.match(featured, /Published World preview/)
    assert.match(featured, /Curated World preview/)
    assert.match(featured, /aria-label="Animated experience preview"/)
    assert.match(featured, /aria-label="Pause experience animation"/)
    assert.match(featured, /landing-reel-photo/)
    assert.doesNotMatch(featured, /Unpictured World/)
    const empty = renderToStaticMarkup(React.createElement(LandingPage, { error: true, onRetry: () => {} }))
    assert.match(empty, /Reload previews/)
    assert.doesNotMatch(empty, /Anime|Mini Me|8-Bit Gamer/)
  } finally {
    globalThis.window = originalWindow
    globalThis.sessionStorage = originalStorage
    await vite.close()
  }
})
