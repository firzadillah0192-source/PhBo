// Isolated layout acceptance: fixture catalog/result only, no production calls.
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.NXBOOTH_PLAYWRIGHT_MODULE || '../../frontend-enhanced/node_modules/playwright/index.mjs')
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const output = '/tmp/nxbooth-customer-viewport'
await mkdir(output, { recursive: true })
const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://local').pathname
    let file = resolve(root, '.' + path)
    if (file !== root && !file.startsWith(root + '/')) throw new Error('Invalid path')
    let data
    try { data = await readFile(file) } catch { file = resolve(root, 'index.html'); data = await readFile(file) }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.ttf': 'font/ttf' })[extname(file)] || 'application/octet-stream')
    res.end(data)
  } catch { res.writeHead(404); res.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ executablePath: process.env.NXBOOTH_BROWSER_EXECUTABLE || '/home/mahez/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="900"><rect width="300" height="900" fill="#a8cdda"/><text x="20" y="60">Layout test fixture</text></svg>'
const layouts = Array.from({ length: 15 }, (_, i) => ({ id: `frame-${i}`, name: `Event frame ${i}`, preview_url: '/api/fixture/image', shot_count: 3, requires_event_name: true }))
const templates = [{ id: 'template-1', name: 'Test scene', preview_url: '/api/fixture/image' }]
const experiences = [{ id: 'experience-1', name: 'Test world', thumbnail: '/api/fixture/image' }]
const frameStyles = Array.from({ length: 8 }, (_, i) => ({ id: `style-${i}`, name: `Style ${i}`, description: 'A photographic frame style.' }))
const ornaments = Array.from({ length: 8 }, (_, i) => ({ id: `ornament-${i}`, name: `Effect ${i}` }))
const failures = []
try {
  for (const [width, height] of [[1918, 872], [1366, 768], [1440, 900], [1024, 768], [768, 1024], [390, 844], [375, 667], [320, 740], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', permissions: ['camera'] })
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
      if (path === '/api/account/usage') return json({ ai_remaining: 100, authenticated: false })
      if (path === '/api/account/me') return json({ authenticated: false })
      if (path === '/api/classic/layouts') return json(layouts)
      if (path === '/api/templates') return json({ templates })
      if (path === '/api/experiences') return json({ experiences })
      if (path === '/api/advanced/frame-styles') return json(frameStyles)
      if (path === '/api/advanced/ornaments') return json(ornaments)
      if (path === '/api/uploads') return json({ upload_id: 'upload-fixture', preview_url: '/api/fixture/image', width: 300, height: 900 })
      if (path.endsWith('/image')) return route.fulfill({ contentType: 'image/svg+xml', body: image })
      if (path.endsWith('/claim')) return json({ claim_url: origin + '/r/test-fixture', qr_payload: origin + '/r/test-fixture', image_url: '/api/fixture/image', expires_at: '2030-01-01T00:00:00Z' })
      if (path === '/api/results/result-fixture') return json({ job_id: 'job-fixture' })
      if (path === '/api/generations/job-fixture') return json({ job_id: 'job-fixture', result_id: 'result-fixture', mode: 'CLASSIC', state: 'COMPLETED' })
      return json({})
    })
    const fit = async (selector, label) => {
      const boxes = await page.locator(selector).evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right } }))
      assert.ok(boxes.length, label + ' exists')
      const bad = boxes.filter(r => r.top < -1 || r.bottom > height + 1 || r.left < -1 || r.right > width + 1)
      if (bad.length) failures.push({ width, height, label, bad })
      const scroll = await page.evaluate(() => ({ y: scrollY, height: document.documentElement.scrollHeight, modal: Boolean(document.querySelector('[role="dialog"]')), home: location.pathname === '/' }))
      if (!scroll.home && !scroll.modal && (scroll.y !== 0 || scroll.height > height + 1)) failures.push({ width, height, label: label + ' page scroll', scroll })
      if (scroll.modal) {
        const modalScroll = await page.locator('.studio-popup-body').evaluate(node => node.scrollHeight - node.clientHeight)
        if (modalScroll > 1) failures.push({ width, height, label: label + ' dialog scroll', modalScroll })
      }
    }
    await page.goto(origin)
    await page.locator('.landing-reel').waitFor({ timeout: 10000 }).catch(async error => { await page.screenshot({ path: output + '/home-failure.png' }); console.log(await page.locator('body').innerText(), errors); throw error })
    await fit('.landing-hero-art, .landing-hero .landing-primary', 'home preview and start')
    await page.screenshot({ path: `${output}/${width}x${height}-home.png` })
    await page.goto(origin + '/create')
    await page.screenshot({ path: `${output}/${width}x${height}-chooser.png` })
    await fit('.creation-chooser .landing-mode-copy>a', 'all mode choices')
    await page.locator('.mode-classic .landing-mode-copy>a').click()
    await page.locator('.studio-picker-card').first().waitFor()
    await fit('.studio-popup-nav, .studio-picker-card, .studio-picker-pages', 'all picker choices and navigation')
    await page.getByRole('button', { name: 'Berikutnya' }).click()
    await fit('.studio-picker-card, .studio-picker-pages', 'picker next page')
    await page.getByRole('button', { name: 'Sebelumnya' }).click()
    await page.locator('.studio-picker-card').first().click()
    await page.locator('#classic-event-name').fill('Viewport event')
    await fit('.capture-navigation, .classic-selected-frame, .camera-actions', 'event preview and continue')
    await page.screenshot({ path: `${output}/${width}x${height}-event.png` })
    await page.getByRole('button', { name: 'Lanjut ambil foto' }).click()
    await fit('.capture-navigation, .classic-selected-frame, .classic-camera-stage, .camera-actions', 'capture preview and actions')
    await page.getByRole('button', { name: 'Open camera', exact: true }).click()
    await page.locator('video').waitFor()
    await page.waitForFunction(() => document.querySelector('video')?.videoWidth > 0)
    await fit('.classic-camera-stage, .camera-actions', 'live camera and take')
    const cameraLayout = await page.locator('.classic-capture').evaluate(node => ({
      heading: node.querySelector('.classic-capture-heading').getBoundingClientRect().height,
      preview: node.querySelector('.classic-camera-stage').getBoundingClientRect().height,
      fit: getComputedStyle(node.querySelector('video')).objectFit,
    }))
    assert.ok(cameraLayout.heading <= 85, `Compact capture heading at ${width}x${height}: ${cameraLayout.heading}`)
    assert.ok(cameraLayout.preview >= (height - 180) * .45, `Camera has usable height at ${width}x${height}: ${cameraLayout.preview}`)
    assert.equal(cameraLayout.fit, 'contain', 'Camera preserves the full video frame')
    await page.screenshot({ path: `${output}/${width}x${height}-camera.png` })
    await page.getByRole('button', { name: 'Start photo 1 countdown' }).click()
    await page.locator('.classic-shot-review').waitFor()
    await fit('.capture-navigation, .classic-selected-frame, .classic-camera-stage, .classic-shot-review', 'classic shot review and retake')
    const reviewHeight = await page.locator('.classic-camera-stage').evaluate(node => node.getBoundingClientRect().height)
    assert.ok(reviewHeight >= (height - 180) * .35, `Review preview has usable height at ${width}x${height}: ${reviewHeight}`)
    await page.screenshot({ path: `${output}/${width}x${height}-classic-shot-review.png` })
    await page.getByRole('button', { name: 'Retake photo' }).click()
    await page.goto(origin + '/result/result-fixture')
    await page.locator('.result-stage.is-revealed .result-phone-panel svg').waitFor()
    await fit('.result-navigation, .result-frame, .result-phone-panel, .result-stage footer', 'result and download')
    await page.screenshot({ path: `${output}/${width}x${height}-result.png` })
    for (const mode of ['basic', 'advanced']) {
      await page.evaluate(() => sessionStorage.clear())
      await page.goto(origin + '/create?mode=' + mode)
      await page.locator('.studio-picker-card').first().click()
      if (mode === 'advanced') {
        await page.screenshot({ path: `${output}/${width}x${height}-advanced-options.png` })
        await fit('.advanced-style-card, .advanced-ornaments, .advanced-options>.studio-picker-pages, .selection-dock', 'advanced choices and continue')
        await page.getByRole('navigation', { name: 'Frame style pages' }).getByRole('button', { name: 'Next' }).click()
        await page.locator('.advanced-style-card').first().click()
        await page.getByRole('navigation', { name: 'Art direction options' }).getByRole('button', { name: 'Ornaments' }).click()
        await fit('.advanced-ornaments, .selection-dock', 'advanced ornaments and continue')
        await page.getByRole('navigation', { name: 'Ornament pages' }).getByRole('button', { name: 'Next' }).click()
        await page.getByRole('button', { name: 'Effect 4', exact: true }).click()
        await page.getByRole('button', { name: 'Continue to photo' }).click()
      }
      await fit('.photo-stage .capture-navigation, .photo-stage .camera-stage, .photo-stage .camera-actions, .photo-file-note', mode + ' photo and controls')
      await page.locator('input[type="file"]').setInputFiles({ name: 'layout-fixture.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(image) })
      await page.locator('.review-stage').waitFor()
      await fit('.review-stage .capture-navigation, .review-composition, .review-actions, .advanced-review-summary', mode + ' review and generate')
      await page.screenshot({ path: `${output}/${width}x${height}-${mode}-review.png` })
    }
    assert.deepEqual(errors, [], 'No browser runtime errors')
    console.log(`${width}x${height}: PASS Home, chooser, paged catalogs, event, camera, retake, result, Basic/Advanced options and review`)
    await context.close()
  }
  assert.deepEqual(failures, [], 'Controls/previews must fit at 100% zoom')
} finally { await browser.close(); await new Promise(done => server.close(done)) }
