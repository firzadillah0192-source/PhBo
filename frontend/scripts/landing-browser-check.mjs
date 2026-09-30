// Optional browser acceptance check. Requires Playwright Core and its browsers;
// production services are never started or changed by this script.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = process.env.NXBOOTH_SCREENSHOT_DIR || resolve(frontend, '../test/output/landing')
const base = process.env.NXBOOTH_PREVIEW_URL || 'http://127.0.0.1:5177'
const cache = process.env.NXBOOTH_CATALOG_CACHE || '/tmp/nxbooth-public-preview-cache'
const library = process.env.NXBOOTH_PLAYWRIGHT_MODULE || 'playwright-core'
const { chromium, webkit, devices } = await import(library)
let previewServer
let browser

try {
  if (process.env.NXBOOTH_START_PREVIEW === '1') {
    const { createServer } = await import(pathToFileURL(resolve(frontend, 'node_modules/vite/dist/node/index.js')))
    const { default: react } = await import(pathToFileURL(resolve(frontend, 'node_modules/@vitejs/plugin-react/dist/index.js')))
    previewServer = await createServer({ root: frontend, configFile: false, plugins: [react()], cacheDir: '/tmp/nxbooth-landing-vite-cache', server: { host: '127.0.0.1', port: 5177, strictPort: true }, logLevel: 'silent' })
    await previewServer.listen()
  }
  await mkdir(output, { recursive: true })
  let catalog
  if (process.env.NXBOOTH_OFFLINE === '1') {
    catalog = JSON.parse(await readFile(resolve(cache, 'catalog.json'), 'utf8'))
  } else {
    await mkdir(cache, { recursive: true })
    const [experiencesResponse, templatesResponse] = await Promise.all([fetch(base + '/api/experiences'), fetch(base + '/api/templates')])
    assert.ok(experiencesResponse.ok && templatesResponse.ok, 'Public preview catalogs must be reachable for the visual check')
    catalog = { experiences: await experiencesResponse.json(), templates: await templatesResponse.json(), images: {} }
    const paths = [...catalog.experiences.experiences.map((item) => item.thumbnail), ...catalog.templates.templates.map((item) => item.preview_url)].filter(Boolean)
    await Promise.all(paths.map(async (path, index) => {
      const response = await fetch(base + path)
      assert.ok(response.ok, `Public preview image unavailable: ${path}`)
      const filename = `published-${index}.image`
      await writeFile(resolve(cache, filename), Buffer.from(await response.arrayBuffer()))
      catalog.images[path] = { filename, type: response.headers.get('content-type') }
    }))
    await writeFile(resolve(cache, 'catalog.json'), JSON.stringify(catalog))
  }
  assert.ok(catalog.experiences.experiences.length, 'At least one actual published Experience is required for this visual check')
  const layouts = [1, 2, 3].map((index) => ({ id: `classic-frame-00${index}`, name: `Classic Frame ${index}`, shot_count: index === 3 ? 3 : 4, canvas_width: 724, canvas_height: 2172, preview_url: `/api/classic/layouts/classic-frame-00${index}/preview` }))
  const frames = [{ id: 'natural', name: 'Natural', description: 'Organic photographic framing.' }, { id: 'modern', name: 'Modern', description: 'Contemporary photographic framing.' }]
  const savedFlow = { mode: 'ADVANCED', uploadId: 'test-saved-upload', experienceId: catalog.experiences.experiences[0].id, frameStyleId: 'modern', ornamentIds: ['sparkles'], stage: 'review' }
  const engine = process.env.NXBOOTH_BROWSER || 'chromium'
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(process.env.NXBOOTH_BROWSER_EXECUTABLE ? { executablePath: process.env.NXBOOTH_BROWSER_EXECUTABLE } : {}) })
  const cases = engine === 'webkit'
    ? [{ name: 'ipad-safari-portrait', options: { ...devices['iPad (gen 7)'] } }, { name: 'ipad-safari-landscape', options: { ...devices['iPad (gen 7) landscape'] } }]
    : [{ name: 'desktop', options: { viewport: { width: 1440, height: 1000 } } }, { name: 'android-chrome', options: { ...devices['Pixel 7'] } }, { name: 'narrow-mobile', options: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } }, { name: 'ipad-chromium-layout', options: { ...devices['iPad (gen 7)'] } }]
  const reports = []
  for (const sample of cases) {
    const motionCheck = process.env.NXBOOTH_MOTION_CHECK === '1'
    const context = await browser.newContext({ ...sample.options, reducedMotion: motionCheck ? 'no-preference' : 'reduce' })
    const page = await context.newPage()
    const errors = []
    let catalogUnavailable = false
    page.on('pageerror', (error) => errors.push(error.message))
    await context.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (path === '/api/account/usage') return json({ ai_remaining: 2, authenticated: false })
      if (path === '/api/experiences') return catalogUnavailable ? json({ detail: 'Test catalog unavailable' }, 503) : json(catalog.experiences)
      if (path === '/api/templates') return catalogUnavailable ? json({ detail: 'Test catalog unavailable' }, 503) : json(catalog.templates)
      if (catalog.images[path]) return route.fulfill({ contentType: catalog.images[path].type, body: await readFile(resolve(cache, catalog.images[path].filename)) })
      if (path === '/api/classic/layouts') return json(layouts)
      const frame = path.match(/^\/api\/classic\/layouts\/classic-frame-00([123])\/preview$/)
      if (frame) return route.fulfill({ contentType: 'image/png', body: await readFile(resolve(frontend, `../templates/_classic/classic-frame${frame[1]}.png`)) })
      if (path === '/api/advanced/frame-styles') return json(frames)
      if (path === '/api/advanced/ornaments') return json([{ id: 'sparkles', name: 'Sparkles', description: 'Subtle accents.' }])
      if (path === '/api/uploads/test-saved-upload') return json({ upload_id: 'test-saved-upload', preview_url: catalog.experiences.experiences[0].thumbnail, width: 512, height: 512 })
      if (path === '/api/kiosk/session') return json({ reset_after_seconds: 90 })
      if (path.startsWith('/api/admin/')) return json({ detail: 'Admin authentication required' }, 401)
      if (path.startsWith('/api/public/results/')) return json({ detail: 'Test claim expired' }, 410)
      // Block all other service calls, especially uploads, generation, credits and auth.
      return json({ detail: 'Not part of this frontend acceptance test' }, 404)
    })
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.locator('.landing-experience-card').first().waitFor()
    const featuredNames = await page.locator('.landing-experience-card h3').allTextContents()
    assert.ok(featuredNames.length > 0 && featuredNames.length <= 6)
    const allowedNames = new Set([...catalog.experiences.experiences, ...catalog.templates.templates].map((item) => item.name))
    assert.ok(featuredNames.every((name) => allowedNames.has(name)))
    assert.equal(await page.locator('.customer-credit').count(), 0)
    assert.equal(await page.locator('.landing-nav .customer-mode-nav').count(), 0)
    if (motionCheck) {
      const reel = page.locator('.landing-reel')
      await reel.scrollIntoViewIfNeeded()
      const firstPreview = await reel.locator('figcaption').textContent()
      await page.waitForFunction((initial) => document.querySelector('.landing-reel figcaption')?.textContent !== initial, firstPreview, { timeout: 10000 })
      await page.getByRole('button', { name: 'Pause experience animation' }).click()
      assert.equal(await reel.locator('.landing-reel-photo').evaluate((element) => getComputedStyle(element).animationPlayState), 'paused')
      const pausedPreview = await reel.locator('figcaption').textContent()
      if (sample.name === 'desktop') {
        await page.waitForTimeout(6500)
        assert.equal(await reel.locator('figcaption').textContent(), pausedPreview, 'Pause stops catalog rotation')
      }
      await page.getByRole('button', { name: 'Play experience animation' }).click()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForFunction(() => document.querySelector('.landing-reel')?.classList.contains('is-paused'))
      assert.equal(await reel.locator('.landing-reel-photo').evaluate((element) => getComputedStyle(element).animationName), 'none')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.waitForFunction(() => document.querySelector('.landing-reel')?.classList.contains('is-playing'))
    }
    // Load below-the-fold art before capturing the full editorial page.
    await page.evaluate(() => document.querySelectorAll('.nx-landing img').forEach((image) => { image.loading = 'eager' }))
    await page.waitForFunction(() => [...document.querySelectorAll('.nx-landing img')].every((image) => image.complete && image.naturalWidth > 0))
    await page.evaluate(async () => {
      await Promise.all([...document.querySelectorAll('.nx-landing img')].map((image) => image.decode()))
      // Chromium may omit decoded, never-painted offscreen images in a full-page capture.
      for (const section of document.querySelectorAll('.nx-landing main > section')) {
        section.scrollIntoView()
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }
      window.scrollTo(0, 0)
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, headline: document.querySelector('.landing-hero h1').scrollWidth, headlineBox: document.querySelector('.landing-hero h1').clientWidth }))
    assert.ok(dimensions.page <= dimensions.viewport + 1, `${sample.name}: page overflows horizontally: ${JSON.stringify(dimensions)}`)
    assert.ok(dimensions.headline <= dimensions.headlineBox + 1, `${sample.name}: headline overflows`)
    await page.screenshot({ path: resolve(output, `${sample.name}-hero.png`) })
    await page.screenshot({ path: resolve(output, `${sample.name}-landing.png`), fullPage: true })
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor()
    await page.getByLabel('Email', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await page.getByRole('link', { name: /^Try NXBooth Free/ }).first().click()
    assert.equal(new URL(page.url()).pathname, '/create')
    assert.equal(new URL(page.url()).search, '')
    await page.getByRole('heading', { name: 'Choose how you want to create.' }).waitFor()
    assert.equal(await page.locator('.landing-mode-grid article').count(), 3)
    await page.screenshot({ path: resolve(output, `${sample.name}-chooser.png`), fullPage: true })
    for (const [mode, heading] of [['Classic', 'Choose your frame.'], ['Basic', 'Choose your studio.'], ['Advanced', 'Choose your world.']]) {
      await page.goto(base + '/create', { waitUntil: 'networkidle' })
      await page.getByRole('link', { name: new RegExp(`^Choose ${mode}`) }).click()
      await page.getByRole('heading', { name: heading, exact: true }).waitFor()
      assert.equal(new URL(page.url()).searchParams.get('mode'), mode.toLowerCase())
      if (engine === 'webkit') continue
      if (mode === 'Classic') {
        await page.getByRole('button', { name: /Continue to camera/ }).click()
        await page.locator('.classic-capture').waitFor()
      } else if (mode === 'Basic') {
        await page.getByRole('button', { name: /Continue to photo/ }).click()
        await page.locator('.photo-stage').waitFor()
      } else {
        await page.locator('.look-card').first().click()
        await page.getByRole('button', { name: /Choose frame style/ }).click()
        await page.getByRole('heading', { name: 'Choose a frame style.' }).waitFor()
      }
    }
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.evaluate((flow) => sessionStorage.setItem('photobooth:active-customer-flow', JSON.stringify(flow)), savedFlow)
    await page.getByRole('link', { name: /^Try NXBooth Free/ }).first().click()
    await page.getByRole('heading', { name: 'Choose how you want to create.' }).waitFor()
    assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow'))), savedFlow)
    await page.getByRole('link', { name: /^Resume your advanced creation/ }).click()
    await page.locator('.review-stage').waitFor()
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('.review-stage').waitFor()
    assert.equal(await page.locator('.advanced-review-summary').getByText('Modern', { exact: true }).count(), 1)
    assert.equal(await page.locator('.advanced-review-summary').getByText('Sparkles', { exact: true }).count(), 1)
    await page.getByRole('button', { name: 'NXBooth', exact: true }).click()
    await page.getByRole('heading', { name: /Moments, made/ }).waitFor()
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow')).uploadId), savedFlow.uploadId)
    await page.goto(base + '/kiosk', { waitUntil: 'networkidle' })
    await page.locator('.campaign-modes').waitFor()
    assert.equal(await page.locator('.campaign-modes button').count(), 3)
    await page.goto(base + '/admin', { waitUntil: 'networkidle' })
    await page.locator('.admin-gate').waitFor()
    await page.goto(base + '/r/test-expired-claim', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'This photo link is no longer available.' }).waitFor()
    catalogUnavailable = true
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /^Reload previews/ }).waitFor()
    assert.equal(await page.locator('.landing-experience-card').count(), 0)
    assert.equal(await page.getByRole('link', { name: /^Try NXBooth Free/ }).count(), 2)
    assert.deepEqual(errors, [], `${sample.name}: runtime errors`)
    reports.push({ sample: sample.name, browser: engine, dimensions, featuredNames, checks: ['landing', 'CTA chooser', 'three modes', 'sign-in', 'no marketing credits', 'published art', 'mode galleries', 'photo and art-direction entry', 'refresh recovery', 'homepage recovery', 'admin', 'kiosk', 'claim route', 'catalog failure'], passed: true })
    if (motionCheck) reports.at(-1).checks.push('animated preview rotation', 'pause and play', 'reduced motion')
    if (engine === 'webkit') reports.at(-1).checks = reports.at(-1).checks.filter((check) => check !== 'photo and art-direction entry')
    await writeFile(resolve(output, `${engine}-checks.json`), JSON.stringify(reports, null, 2))
    console.log(JSON.stringify({ sample: sample.name, passed: true }))
    await context.close()
  }
  await writeFile(resolve(output, `${engine}-checks.json`), JSON.stringify(reports, null, 2))
  console.log(JSON.stringify({ browser: engine, casesPassed: reports.length, publishedExperiences: catalog.experiences.experiences.length, output }))
} finally {
  if (browser) await browser.close()
  if (previewServer) await previewServer.close()
}
