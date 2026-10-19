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
  const i18n = await vite.ssrLoadModule('/src/i18n.js')
  i18n.setLanguage('en') // these assertions cover the English copy; Indonesian is the default and is asserted below
  const originalWindow = globalThis.window
  const originalStorage = globalThis.sessionStorage
  const saved = JSON.stringify({ mode: 'ADVANCED', uploadId: 'saved-upload', experienceId: 'published-world', frameStyleId: 'modern', ornamentIds: ['sparkles'], stage: 'review' })
  const storage = { getItem: (key) => key === customerFlowKey() ? saved : null }
  globalThis.sessionStorage = storage
  try {
    const App = (await vite.ssrLoadModule('/src/App.jsx')).default
    const LandingPage = (await vite.ssrLoadModule('/src/components/home/LandingPage.jsx')).default
    const CustomerNav = (await vite.ssrLoadModule('/src/components/customer/CustomerNav.jsx')).default
    const PhotoStage = (await vite.ssrLoadModule('/src/components/customer/PhotoStage.jsx')).default
    for (const mode of ['BASIC', 'ADVANCED']) {
      const photo = renderToStaticMarkup(React.createElement(PhotoStage, { mode, busy: false, onFile: () => {}, onBack: () => {} }))
      assert.match(photo, />Take photo<\/button>/)
      assert.match(photo, />Upload photo<\/button>/)
      assert.doesNotMatch(photo, /Use phone camera|Resume preview|capture="user"/)
      assert.match(photo, /accept="image\/\*,\.heic,\.heif"/)
      assert.equal((photo.match(/class="customer-outline-button/g) || []).length, 1)
      assert.match(photo, /class="customer-solid-button shutter-button"/)
      const blockedPhoto = renderToStaticMarkup(React.createElement(PhotoStage, { mode, busy: true, onFile: () => {}, onBack: () => {} }))
      assert.match(blockedPhoto, /class="customer-solid-button shutter-button"[^>]*disabled=""/)
      assert.match(blockedPhoto, /class="customer-outline-button" disabled="">Preparing photo…<\/button>/)
    }
    globalThis.window = { location: { pathname: '/', search: '' }, innerWidth: 390, sessionStorage: storage }
    const root = renderToStaticMarkup(React.createElement(App))
    assert.match(root, /One photo/)
    assert.match(root, /href="\/create"[^>]*>Try NXBooth Free/)
    for (const section of ['How it works', 'Three ways to create', 'Featured Experiences', 'Made to leave', 'Ready to write']) assert.ok(root.includes(section), section)
    const journey = ['three doors into your story.', 'One face is enough to begin.', 'watch your portrait come to life.', 'keep it as a memory.']
    const journeyPositions = journey.map((step) => root.indexOf(step))
    assert.ok(journeyPositions.every((position) => position >= 0))
    assert.deepEqual(journeyPositions, [...journeyPositions].sort((a, b) => a - b))
    assert.doesNotMatch(root, /scan the QR|print-ready|<strong>Print<\/strong>|<strong>QR<\/strong>/i)
    assert.match(root, />Sign In</)
    assert.doesNotMatch(root, /customer-credit|AI credits|Photobooth AI|9Router|face swap|prompt composer/)
    assert.ok(root.indexOf('One photo') < root.indexOf('Photo Booth'))

    for (const width of [390, 768, 1024]) {
      globalThis.window = { location: { pathname: '/create', search: '' }, innerWidth: width, sessionStorage: storage }
      const chooser = renderToStaticMarkup(React.createElement(App))
      assert.match(chooser, /Choose how you want to create/)
      for (const mode of ['classic', 'basic', 'advanced']) assert.match(chooser, new RegExp(`href="/create\\?mode=${mode}"`))
      assert.match(chooser, /Resume your Creative Studio creation/)
      assert.doesNotMatch(chooser, /Restoring your portrait/)
    }
    assert.equal(storage.getItem(customerFlowKey()), saved)

    const navProps = { usage: { ai_remaining: 2, authenticated: false } }
    const marketingNav = renderToStaticMarkup(React.createElement(CustomerNav, { ...navProps, marketing: true }))
    assert.doesNotMatch(marketingNav, /customer-credit|2 AI credits/)
    assert.match(marketingNav, /href="#experiences"/)
    const creationNav = renderToStaticMarkup(React.createElement(CustomerNav, navProps))
    assert.match(creationNav, /2 credits/)

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

    const signedInProps = { usage: { authenticated: true, ai_remaining: 120 }, account: { display_name: 'Budi Santoso', email: 'budi@example.com' } }
    const signedInEn = renderToStaticMarkup(React.createElement(LandingPage, signedInProps))
    assert.match(signedInEn, /Welcome back, Budi Santoso/)
    assert.match(signedInEn, /Create a New Portrait/)
    assert.match(signedInEn, /href="\/account\?tab=creations"/)
    assert.match(signedInEn, /You have 120 credits/)
    assert.doesNotMatch(signedInEn, /Try NXBooth Free|Explore Experiences/)
    const signedOutEn = renderToStaticMarkup(React.createElement(LandingPage, { usage: { authenticated: false, ai_remaining: 2 } }))
    assert.match(signedOutEn, /Try NXBooth Free/)
    assert.doesNotMatch(signedOutEn, /Welcome back|Create a New Portrait/)
    const signedInNav = renderToStaticMarkup(React.createElement(CustomerNav, { usage: { ai_remaining: 120, authenticated: true }, account: { email: 'budi@example.com' }, marketing: true }))
    assert.match(signedInNav, /Start Creating/)
    assert.doesNotMatch(signedInNav, /Try for Free/)
    const catalog = { ai_top_up_rupiah_per_credit: 10, plans: [
      { code: 'free', name: 'Free', price_rupiah: 0, monthly_ai_credits: 0, monthly_classic_credits: 500, classic_daily_results: 2, storage_bytes: 150000000, retention_days: 7 },
      { code: 'starter', name: 'Starter', price_rupiah: 25000, monthly_ai_credits: 2500, monthly_classic_credits: 1250, classic_daily_results: 5, storage_bytes: 500000000, retention_days: 14, fast_results_per_period: 25 },
    ] }
    const priced = renderToStaticMarkup(React.createElement(LandingPage, { usage: { authenticated: false, subscription: { catalog } } }))
    assert.match(priced, /id="harga"/)
    assert.match(priced, /Rp\s25\.000/)
    assert.match(priced, /Buy Starter/)
    assert.match(priced, /Start Free/)
    assert.match(priced, /Add AI Credit/)
    assert.match(priced, /Rp\s10\.000/)
    assert.match(priced, /Duitku/)
    assert.match(priced, /Sandbox/)
    assert.match(priced, /landing-pricing-alert/)
    assert.match(priced, /please contact <a href="mailto:support@gennexbyte\.com">support@gennexbyte\.com<\/a>/)
    assert.doesNotMatch(priced, /simulations and do not add production credit/)
    const unpriced = renderToStaticMarkup(React.createElement(LandingPage, {}))
    assert.match(unpriced, /Loading prices…/)
    assert.match(priced, /id="kontak"/)
    assert.match(priced, /href="mailto:support@gennexbyte\.com"/)
    assert.match(priced, /href="tel:\+6281292323040"/)
    assert.match(priced, /0812-9232-3040/)
    assert.match(priced, /Jl\. TB Badaruddin No\. 38/)
    assert.match(priced, /Kel\. Jatinegara Kaum, Kec\. Pulogadung/)
    assert.match(priced, /Jakarta Timur, DKI Jakarta 13250/)
    assert.doesNotMatch(priced, /RT 09|RW 01/)
    i18n.setLanguage('id')
    const indonesian = renderToStaticMarkup(React.createElement(LandingPage, {}))
    for (const copy of ['Cara kerja', 'Tiga cara berkreasi', 'Pengalaman Pilihan', 'Coba NXBooth Gratis']) assert.ok(indonesian.includes(copy), copy)
    assert.doesNotMatch(indonesian, /How it works|Three ways to create|Try NXBooth Free/)
    const pricedId = renderToStaticMarkup(React.createElement(LandingPage, { usage: { authenticated: false, subscription: { catalog } } }))
    for (const copy of ['Produk &amp; harga', 'Beli Starter', 'Mulai Gratis', 'Tambah AI Credit', 'Alamat usaha']) assert.ok(pricedId.includes(copy), copy)
    const signedInId = renderToStaticMarkup(React.createElement(LandingPage, signedInProps))
    assert.match(signedInId, /Selamat datang kembali, Budi Santoso/)
    assert.match(signedInId, /Buat Potret Baru/)
    assert.doesNotMatch(signedInId, /Coba NXBooth Gratis/)
    const indonesianNav = renderToStaticMarkup(React.createElement(CustomerNav, navProps))
    assert.match(indonesianNav, />Masuk</)
    assert.match(indonesianNav, /2 kredit/)
    assert.match(indonesianNav, /aria-pressed="true"[^>]*>ID</)
  } finally {
    i18n.setLanguage('id')
    globalThis.window = originalWindow
    globalThis.sessionStorage = originalStorage
    await vite.close()
  }
})
