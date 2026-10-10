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
  const frames = ['Natural', 'Modern', 'Minimal', 'Luxury', 'Retro', 'Film', 'Cute', 'Editorial', 'Futuristic', 'Artistic'].map((name) => ({ id: name.toLowerCase(), slug: name.toLowerCase(), name, description: `${name} photographic framing.` }))
  const savedFlow = { mode: 'ADVANCED', uploadId: 'test-saved-upload', experienceId: catalog.experiences.experiences[0].id, frameStyleId: 'modern', ornamentIds: ['sparkles'], stage: 'review' }
  const engine = process.env.NXBOOTH_BROWSER || 'chromium'
  const classicCheck = process.env.NXBOOTH_CLASSIC_REVIEW_CHECK === '1'
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, ...(engine === 'chromium' && (classicCheck || process.env.NXBOOTH_GENERATION_CHECK === '1') ? { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } : {}), ...(process.env.NXBOOTH_BROWSER_EXECUTABLE ? { executablePath: process.env.NXBOOTH_BROWSER_EXECUTABLE } : {}) })
  const cases = engine === 'webkit'
    ? [{ name: 'ipad-safari-portrait', options: { ...devices['iPad (gen 7)'] } }, { name: 'ipad-safari-landscape', options: { ...devices['iPad (gen 7) landscape'] } }]
    : [{ name: 'desktop', options: { viewport: { width: 1440, height: 1000 } } }, { name: 'android-chrome', options: { ...devices['Pixel 7'] } }, { name: 'narrow-mobile', options: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } }, { name: 'ipad-chromium-layout', options: { ...devices['iPad (gen 7)'] } }]
  const reports = []
  const requestedCases = process.env.NXBOOTH_BROWSER_CASES?.split(',')
  for (const sample of cases.filter((sample) => !requestedCases || requestedCases.includes(sample.name))) {
    const motionCheck = process.env.NXBOOTH_MOTION_CHECK === '1'
    const context = await browser.newContext({ ...sample.options, reducedMotion: motionCheck ? 'no-preference' : 'reduce' })
    const page = await context.newPage()
    const errors = []
    let catalogUnavailable = false
    let failGeneration = false
    let holdUpload = false
    let releaseUpload
    let uploadReleased = false
    const generationFixtures = new Map()
    let fixtureSequence = 0
    let uploadSequence = 0
    const pollUrls = []
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
      if (classicCheck || process.env.NXBOOTH_GENERATION_CHECK === '1') {
        const preview = catalog.images[catalog.experiences.experiences[0].thumbnail]
        if (path === '/api/uploads' && route.request().method() === 'POST') {
          const wasHeld = holdUpload
          if (wasHeld) await new Promise((resolve) => { releaseUpload = resolve })
          const response = await json({ upload_id: `test-fixture-photo-${++uploadSequence}`, preview_url: catalog.experiences.experiences[0].thumbnail, width: 512, height: 768 }, 201)
          if (wasHeld) uploadReleased = true
          return response
        }
        if (path === '/api/generations' && route.request().method() === 'POST') {
          const payload = route.request().postDataJSON()
          const id = `test-fixture-job-${++fixtureSequence}`
          generationFixtures.set(id, { ...payload, job_id: id, state: 'QUEUED', polls: 0 })
          return json({ ...payload, job_id: id, state: 'QUEUED' }, 202)
        }
        const id = path.split('/').pop()
          const fixture = generationFixtures.get(id)
        if (path.startsWith('/api/generations/') && fixture) {
          pollUrls.push(route.request().url())
          if (failGeneration) return json({ ...fixture, state: 'FAILED', error_code: 'AI_PROVIDER_NOT_CONNECTED' })
          const poll = ++fixture.polls
          if (poll === 1) return json({ detail: 'Temporary test disconnection' }, 503)
          const state = poll === 2 ? 'QUEUED' : poll === 3 ? 'PROCESSING' : 'COMPLETED'
          return json({ ...fixture, state, result_id: state === 'COMPLETED' ? `result-${id}` : null })
        }
        if (path.startsWith('/api/results/result-test-fixture-job-')) {
          if (path.endsWith('/image')) return route.fulfill({ contentType: preview.type, body: await readFile(resolve(cache, preview.filename)) })
          if (path.endsWith('/download')) return route.fulfill({ contentType: preview.type, headers: { 'content-disposition': 'attachment; filename="test-portrait.png"' }, body: await readFile(resolve(cache, preview.filename)) })
          return json({ job_id: id.replace(/^result-/, '') })
        }
        if (/^\/api\/uploads\/test-fixture-photo-\d+\/preview$/.test(path)) return route.fulfill({ contentType: preview.type, body: await readFile(resolve(cache, preview.filename)) })
        if (path === '/api/generations/test-fixture-pending') return json({ job_id: 'test-fixture-pending', mode: 'ADVANCED', state: 'PROCESSING' })
      }
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
    assert.equal(await page.getByLabel('Email', { exact: true }).evaluate((element) => document.activeElement === element), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button', { name: 'Sign In', exact: true }).getAttribute('aria-expanded'), 'false')
    assert.equal(await page.getByRole('button', { name: 'Sign In', exact: true }).evaluate((element) => document.activeElement === element), true)
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
        await page.locator('.classic-layout-card').first().click()
        await page.locator('.classic-capture').waitFor()
      } else if (mode === 'Basic') {
        await page.locator('.template-card').first().click()
        await page.locator('.photo-stage').waitFor()
        await page.screenshot({ path: resolve(output, `${sample.name}-photo.png`), fullPage: true })
        await page.goBack()
        await page.getByRole('heading', { name: 'Choose your studio.', exact: true }).waitFor()
        await page.goForward()
        await page.locator('.photo-stage').waitFor()
      } else {
        await page.locator('.look-card').first().click()
        await page.getByRole('heading', { name: 'Choose a frame style.' }).waitFor()
      }
    }
    if (classicCheck && engine === 'chromium' && ['desktop', 'android-chrome'].includes(sample.name)) {
      await context.grantPermissions(['camera'])
      for (const index of sample.name === 'desktop' ? [0, 2] : [2]) {
        await page.evaluate(() => sessionStorage.clear())
        await page.goto(base + '/create?mode=classic', { waitUntil: 'networkidle' })
        await page.locator('.classic-layout-card').nth(index).click()
        await page.locator('.camera-actions').getByRole('button', { name: 'Open camera', exact: true }).click()
        await page.getByRole('button', { name: 'Start photo 1 countdown', exact: true }).click()
        await page.locator('.classic-shot-review').waitFor()
        const shots = layouts[index].shot_count
        const uploadsBefore = uploadSequence
        assert.match(await page.locator('.classic-shot-review').textContent(), /in 10s/)
        for (let retake = 0; retake < 3; retake++) {
          await page.getByRole('button', { name: /^Retake photo/ }).click()
          await page.locator('.classic-shot-review').waitFor()
          assert.equal(uploadSequence, uploadsBefore, 'Rejected shots are never uploaded')
          assert.match(await page.locator('.classic-retake-allowance').textContent(), new RegExp(`${2 - retake} of 3`))
        }
        assert.equal(await page.getByRole('button', { name: /^Retake photo/ }).isDisabled(), true)
        await page.screenshot({ path: resolve(output, `${sample.name}-classic-${shots}-photo-review.png`), fullPage: true })
        await page.getByRole('button', { name: /^Next photo/ }).click()
        await page.getByRole('heading', { name: `Photo 2 of ${shots}`, exact: true }).waitFor()
        // Refresh midway: accepted upload IDs and the exhausted allowance survive.
        await page.reload({ waitUntil: 'networkidle' })
        await page.locator('.classic-capture').waitFor()
        assert.match(await page.locator('.classic-retake-allowance').textContent(), /0 of 3/)
        assert.match(await page.locator('.stage-heading').textContent(), new RegExp(`1 of ${shots} photographs accepted`))
        await page.locator('.camera-actions').getByRole('button', { name: 'Open camera', exact: true }).click()
        await page.getByRole('button', { name: 'Start photo 2 countdown', exact: true }).click()
        await page.getByRole('heading', { name: `Photo 2 of ${shots}`, exact: true }).waitFor()
        assert.equal(await page.getByRole('button', { name: /^Retake photo/ }).isDisabled(), true)
        // Let the real 10-second timer accept this photo automatically.
        await page.getByRole('heading', { name: `Photo 3 of ${shots}`, exact: true }).waitFor({ timeout: 16000 })
        if (shots === 4) {
          await page.getByRole('button', { name: /^Next photo/ }).click()
          await page.getByRole('heading', { name: 'Photo 4 of 4', exact: true }).waitFor()
        }
        // Last-photo timeout automatically composes through the shared Result route.
        await page.locator('.result-stage').waitFor({ timeout: 22000 })
        const payload = [...generationFixtures.values()].filter((item) => item.mode === 'CLASSIC').at(-1)
        assert.equal(payload.layout_id, layouts[index].id)
        assert.equal(payload.capture_upload_ids.length, shots)
        assert.equal(new Set(payload.capture_upload_ids).size, shots)
        assert.equal(uploadSequence - uploadsBefore, shots)
      }
      await page.evaluate(() => sessionStorage.clear())
    }
    if (process.env.NXBOOTH_GENERATION_CHECK === '1') {
      // Leave a running job through SPA navigation: busy must not disable a new photo.
      await page.goto(base + '/generate/test-fixture-pending', { waitUntil: 'networkidle' })
      await page.locator('.processing-stage').waitFor()
      await page.screenshot({ path: resolve(output, `${sample.name}-processing.png`), fullPage: true })
      await page.locator('.customer-mode-nav').getByRole('button', { name: 'Advanced', exact: true }).click()
      await page.locator('.look-card').first().click()
      assert.equal(await page.locator('.frame-style-preview svg').count(), 10)
      await page.getByRole('button', { name: /^Modern/ }).click()
      await page.getByRole('button', { name: 'Sparkles', exact: true }).click()
      await page.screenshot({ path: resolve(output, `${sample.name}-advanced-frames.png`), fullPage: true })
      await page.getByRole('button', { name: /Continue to photo/ }).click()
      assert.equal(await page.getByRole('button', { name: 'Upload photo', exact: true }).isEnabled(), true)
      assert.equal(await page.getByRole('button', { name: 'Take photo', exact: true }).isEnabled(), true)
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator('.photo-stage').waitFor()
      assert.equal(await page.getByRole('button', { name: 'Upload photo', exact: true }).isEnabled(), true)
      assert.deepEqual(await page.locator('.camera-actions button').allTextContents(), ['Take photo', 'Upload photo'])
      const restoredOptions = await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow')))
      assert.equal(restoredOptions.mode, 'ADVANCED')
      assert.equal(restoredOptions.frameStyleId, 'modern')
      assert.deepEqual(restoredOptions.ornamentIds, ['sparkles'])
      const fixtureImage = catalog.images[catalog.experiences.experiences[0].thumbnail]
      assert.deepEqual(await page.locator('.camera-actions button').allTextContents(), ['Take photo', 'Upload photo'])
      for (const mode of ['ADVANCED', 'BASIC']) {
        if (mode === 'BASIC') {
          await page.locator('.customer-mode-nav').getByRole('button', { name: 'Basic', exact: true }).click()
          await page.locator('.template-card').first().click()
          await page.locator('.photo-stage').waitFor()
        }
        if (mode === 'ADVANCED' && engine === 'chromium') {
          await context.grantPermissions(['camera'])
          await page.evaluate(() => {
            window.originalCameraRequest = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
            navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test permission denial', 'NotAllowedError') }
          })
          await page.getByRole('button', { name: 'Take photo', exact: true }).click()
          await page.getByRole('status').filter({ hasText: 'Camera permission is blocked' }).waitFor()
          assert.equal(await page.getByRole('button', { name: 'Upload photo', exact: true }).isEnabled(), true)
          await page.evaluate(() => {
            navigator.mediaDevices.getUserMedia = window.originalCameraRequest
            const play = HTMLMediaElement.prototype.play
            let first = true
            HTMLMediaElement.prototype.play = function () {
              if (first) { first = false; return Promise.reject(new DOMException('Test playback denial', 'NotAllowedError')) }
              return play.call(this)
            }
          })
          await page.getByRole('button', { name: 'Take photo', exact: true }).click()
          await page.getByRole('status').filter({ hasText: 'camera preview could not start' }).waitFor()
          await page.getByRole('button', { name: 'Take photo', exact: true }).click()
          await page.waitForFunction(() => document.querySelector('.photo-stage video')?.videoWidth > 0)
          assert.equal(await page.locator('.photo-stage video').evaluate((video) => getComputedStyle(video).objectFit), 'contain', 'Preview shows the full camera image without zoom cropping')
          await page.getByRole('button', { name: 'Take photo', exact: true }).click()
        } else {
          if (mode === 'ADVANCED') {
            await page.evaluate(() => {
              navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test unavailable camera', 'NotReadableError') }
            })
            await page.getByRole('button', { name: 'Take photo', exact: true }).click()
            await page.getByRole('status').filter({ hasText: 'Close other apps' }).waitFor()
          }
          if (mode === 'BASIC' && engine === 'chromium') {
            await page.getByRole('button', { name: 'Take photo', exact: true }).click()
            await page.waitForFunction(() => document.querySelector('.photo-stage video')?.videoWidth > 0)
            await page.evaluate(() => { window.testCameraStream = document.querySelector('.photo-stage video').srcObject })
          }
          const chooserPromise = page.waitForEvent('filechooser')
          await page.getByRole('button', { name: 'Upload photo', exact: true }).click()
          const chooser = await chooserPromise
          assert.equal(await chooser.element().getAttribute('capture'), null)
          assert.equal(await chooser.element().getAttribute('accept'), 'image/*,.heic,.heif')
          await chooser.setFiles({ name: 'phone-camera-test.png', mimeType: fixtureImage.type, buffer: await readFile(resolve(cache, fixtureImage.filename)) })
          if (mode === 'BASIC' && engine === 'chromium') assert.equal(await page.evaluate(() => window.testCameraStream.getTracks().every((track) => track.readyState === 'ended')), true)
        }
        await page.locator('.review-stage').waitFor()
        if (mode === 'ADVANCED') {
          assert.match(await page.locator('.advanced-review-summary').textContent(), /Modern.*Sparkles/)
        }
        await page.locator('.review-create .customer-solid-button').click()
        await page.locator('.result-stage').waitFor({ timeout: 15000 })
        await page.screenshot({ path: resolve(output, `${sample.name}-${mode.toLowerCase()}-result.png`), fullPage: true })
        const downloadPending = page.waitForEvent('download')
        await page.getByRole('link', { name: /^Download photo/ }).click()
        const download = await downloadPending
        assert.equal(await download.failure(), null, 'The result download delivers a file')
        assert.match(new URL(page.url()).pathname, /^\/result\/result-test-fixture-job-/)
      }
      assert.equal(new Set(pollUrls).size, pollUrls.length, 'Every status read uses a fresh URL')
      const advancedFixture = [...generationFixtures.values()].find((item) => item.mode === 'ADVANCED')
      assert.equal(advancedFixture.frame_style_id, 'modern')
      assert.deepEqual(advancedFixture.ornament_ids, ['sparkles'])
      // A disconnected engine must show a real failure and retain the user's photo.
      await page.locator('.customer-mode-nav').getByRole('button', { name: 'Advanced', exact: true }).click()
      await page.locator('.look-card').first().click()
      await page.getByRole('button', { name: /^Modern/ }).click()
      await page.getByRole('button', { name: /Continue to photo/ }).click()
      await page.locator('input[type="file"]').setInputFiles(resolve(cache, fixtureImage.filename))
      await page.locator('.review-stage').waitFor()
      const beforeFailure = await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow')).uploadId)
      failGeneration = true
      await page.locator('.review-create .customer-solid-button').click()
      await page.getByRole('heading', { name: "This portrait didn't make it through." }).waitFor()
      await page.screenshot({ path: resolve(output, `${sample.name}-failed.png`), fullPage: true })
      assert.equal(await page.locator('.result-stage').count(), 0)
      await page.locator('.customer-empty .customer-solid-button').click()
      await page.locator('.review-stage').waitFor()
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow')).uploadId), beforeFailure)
      failGeneration = false
      // A slow upload from an abandoned mode must not overwrite the next studio.
      await page.locator('.customer-mode-nav').getByRole('button', { name: 'Basic', exact: true }).click()
      await page.locator('.template-card').first().click()
      holdUpload = true
      await page.locator('input[type="file"]').setInputFiles(resolve(cache, fixtureImage.filename))
      await page.getByRole('button', { name: 'Preparing photo…', exact: true }).waitFor()
      await page.locator('.customer-mode-nav').getByRole('button', { name: 'Advanced', exact: true }).click()
      await page.getByRole('heading', { name: 'Choose your world.', exact: true }).waitFor()
      assert.equal(typeof releaseUpload, 'function')
      releaseUpload()
      while (!uploadReleased) await new Promise((resolve) => setTimeout(resolve, 20))
      await page.waitForLoadState('networkidle')
      assert.equal(await page.locator('.review-stage').count(), 0)
      assert.equal(await page.getByRole('heading', { name: 'Choose your world.', exact: true }).count(), 1)
      assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow')).uploadId), null)
      holdUpload = false
      await page.evaluate(() => sessionStorage.clear())
    }
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.evaluate((flow) => sessionStorage.setItem('photobooth:active-customer-flow', JSON.stringify(flow)), savedFlow)
    await page.getByRole('link', { name: /^Try NXBooth Free/ }).first().click()
    await page.getByRole('heading', { name: 'Choose how you want to create.' }).waitFor()
    assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow'))), savedFlow)
    await page.getByRole('link', { name: /^Resume your advanced creation/ }).click()
    await page.locator('.review-stage').waitFor()
    await page.screenshot({ path: resolve(output, `${sample.name}-review.png`), fullPage: true })
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
    await page.getByRole('alert').filter({ hasText: 'This photo link is no longer available.' }).waitFor()
    catalogUnavailable = true
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /^Reload previews/ }).waitFor()
    assert.equal(await page.locator('.landing-experience-card').count(), 0)
    assert.equal(await page.getByRole('link', { name: /^Try NXBooth Free/ }).count(), 2)
    assert.deepEqual(errors, [], `${sample.name}: runtime errors`)
    reports.push({ sample: sample.name, browser: engine, dimensions, featuredNames, checks: ['landing', 'CTA chooser', 'three modes', 'sign-in', 'no marketing credits', 'published art', 'mode galleries', 'photo and art-direction entry', 'refresh recovery', 'homepage recovery', 'admin', 'kiosk', 'claim route', 'catalog failure'], passed: true })
    if (motionCheck) reports.at(-1).checks.push('animated preview rotation', 'pause and play', 'reduced motion')
    if (classicCheck && engine === 'chromium' && ['desktop', 'android-chrome'].includes(sample.name)) reports.at(-1).checks.push('Classic shot review', 'three shared retakes', 'manual Next', 'ten second automatic Next', 'accepted-shot and quota refresh recovery', 'Classic shared Result')
    if (process.env.NXBOOTH_GENERATION_CHECK === '1') reports.at(-1).checks.push('ten frame thumbnails', 'ornament photo buttons enabled', 'Basic and Advanced queued to result', 'transient polling recovery', 'cancel previous job navigation')
    if (process.env.NXBOOTH_GENERATION_CHECK === '1') reports.at(-1).checks.push(...(engine === 'chromium' ? ['camera permission error and retry through Take photo', 'first camera frame readiness', 'full camera field without preview crop'] : ['camera hardware error and upload fallback']))
    if (process.env.NXBOOTH_GENERATION_CHECK === '1') reports.at(-1).checks.push('photo controls limited to Take photo and Upload', 'upload fallback reaches the shared Result flow', 'actual file download with fixture API', 'provider failure retains upload', 'late upload cannot overwrite another mode')
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
