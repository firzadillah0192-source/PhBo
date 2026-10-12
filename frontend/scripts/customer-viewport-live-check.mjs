// Live UI/catalog smoke check. No uploads, generations or customer photos.
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import http from 'node:http'
import { resolve, extname } from 'node:path'
const { chromium } = await import(process.env.NXBOOTH_PLAYWRIGHT_MODULE || '../../frontend-enhanced/node_modules/playwright/index.mjs')
const upstream = process.env.NXBOOTH_LIVE_URL || 'http://127.0.0.1:3000'
let origin = upstream
let server
if (process.env.NXBOOTH_LIVE_DIST) {
  const root = resolve(process.env.NXBOOTH_LIVE_DIST)
  server = http.createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://local').pathname
      if (path.startsWith('/api/')) {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
        const response = await fetch(upstream + req.url)
        res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json' })
        res.end(Buffer.from(await response.arrayBuffer()))
        return
      }
      let file = resolve(root, '.' + path)
      if (file !== root && !file.startsWith(root + '/')) throw new Error('Invalid path')
      let data
      try { data = await readFile(file) } catch { file = resolve(root, 'index.html'); data = await readFile(file) }
      res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.ttf': 'font/ttf' })[extname(file)] || 'application/octet-stream')
      res.end(data)
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${server.address().port}`
}
const output = '/tmp/nxbooth-customer-viewport-live'
await mkdir(output, { recursive: true })
const response = await fetch(origin + '/api/classic/layouts')
assert.ok(response.ok, 'Public frame catalog reachable through web')
const layouts = await response.json()
const eventLayout = layouts.find(item => item.requires_event_name)
assert.ok(eventLayout, 'Published event frame exists')
const browser = await chromium.launch({ executablePath: process.env.NXBOOTH_BROWSER_EXECUTABLE || '/home/mahez/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', headless: true, args: ['--no-sandbox'] })
const failures = []
const reports = []
try {
  for (const [width, height] of [[1366, 768], [1440, 900], [1024, 768], [768, 1024], [390, 844], [375, 667], [320, 740], [844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin || request.method() !== 'GET') return route.abort()
      if (url.pathname === '/api/account/usage') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ai_remaining: 100, authenticated: false }) })
      if (url.pathname === '/api/account/me') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: false }) })
      return route.continue()
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const fit = async (selectors, stage, checkScroll = true) => {
      await page.evaluate(() => document.fonts.ready)
      await page.locator('.studio-picker-image img, .classic-selected-frame img').evaluateAll(nodes => Promise.all(nodes.map(img => img.decode().catch(() => {}))))
      const boxes = await page.locator(selectors).evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right } }))
      assert.ok(boxes.length, stage + ' exists')
      const bad = boxes.filter(r => r.top < -1 || r.bottom > height + 1 || r.left < -1 || r.right > width + 1)
      const scroll = await page.evaluate(() => ({ y: scrollY, height: document.documentElement.scrollHeight, modal: document.querySelector('.studio-popup-body') ? document.querySelector('.studio-popup-body').scrollHeight - document.querySelector('.studio-popup-body').clientHeight : null }))
      if (bad.length || (checkScroll && (scroll.y || (scroll.modal === null ? scroll.height > height + 1 : scroll.modal > 1)))) failures.push({ width, height, stage, bad, scroll })
      await page.screenshot({ path: `${output}/${width}x${height}-${stage}.png` })
    }
    await page.goto(origin)
    await page.locator('.landing-reel').waitFor()
    await fit('.landing-hero-art, .landing-hero .landing-primary', 'home', false)
    await page.goto(origin + '/create')
    await fit('.creation-chooser .landing-mode-copy>a', 'chooser')
    for (const mode of ['basic', 'advanced', 'classic']) {
      await page.goto(origin + '/create?mode=' + mode)
      await page.locator('.studio-picker-card').first().waitFor()
      await fit('.studio-picker-card, .studio-popup-nav, .studio-picker-pages', mode + '-catalog')
      if (mode === 'classic') {
        await page.locator('input[type="search"]').fill(eventLayout.name)
        await page.locator('.studio-picker-card').filter({ hasText: eventLayout.name }).first().click()
        await page.locator('#classic-event-name').fill('Viewport check')
        await fit('.capture-navigation, .classic-selected-frame, .camera-actions', 'event')
        await page.getByRole('button', { name: 'Lanjut ambil foto' }).click()
        await fit('.capture-navigation, .classic-selected-frame, .classic-camera-stage, .camera-actions', 'camera-idle')
      }
    }
    assert.deepEqual(errors, [], 'No live UI runtime errors')
    reports.push({ width, height, status: 'checked' })
    console.log(`${width}x${height}: real catalog and customer navigation checked`)
    await context.close()
  }
  await writeFile(output + '/report.json', JSON.stringify({ reports, failures }, null, 2))
  assert.deepEqual(failures, [], 'Live controls and previews fit at 100%')
} finally { await browser.close(); if (server) await new Promise(done => server.close(done)) }
