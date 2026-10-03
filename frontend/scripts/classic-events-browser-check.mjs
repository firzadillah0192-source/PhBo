// Local gallery acceptance using published-style fixture metadata and synthetic camera.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.env.NXBOOTH_SCREENSHOT_DIR || resolve(root, 'test/output/classic-strip-v2/browser')
const { chromium, webkit, devices } = await import(process.env.NXBOOTH_PLAYWRIGHT_MODULE || 'playwright-core')
const frames = JSON.parse(await readFile(resolve(root, 'backend/app/data/classic_event_frames.json'))).frames
const layouts = [...[1, 2, 3].map((index) => ({ id: `classic-frame-00${index}`, name: `Classic Frame ${index}`, shot_count: index === 3 ? 3 : 4, canvas_width: 1200, canvas_height: 3600, preview_url: `/api/classic/layouts/classic-frame-00${index}/preview` })), ...frames.map((item) => ({ ...item, preview_url: `/api/classic/layouts/${item.id}/preview` }))]
const engine = process.env.NXBOOTH_BROWSER || 'chromium'
const cases = engine === 'webkit' ? [{ name: 'ipad-safari', options: devices['iPad (gen 7)'] }] : [{ name: 'desktop', options: { viewport: { width: 1440, height: 1000 } } }, { name: 'android', options: devices['Pixel 7'] }, { name: 'ipad', options: devices['iPad (gen 7)'] }, { name: 'narrow-mobile', options: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } }]
const server = await createServer({ root: resolve(root, 'frontend'), configFile: false, plugins: [react()], cacheDir: '/tmp/nxbooth-classic-events-vite-cache', server: { host: '0.0.0.0', port: 5178, strictPort: true }, logLevel: 'silent' })
let browser
try {
  await server.listen()
  await mkdir(output, { recursive: true })
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true })
  const results = []
  for (const item of cases) {
    const context = await browser.newContext({ ...item.options, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await context.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      const json = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) })
      if (path === '/api/classic/layouts') return json(layouts)
      if (path === '/api/account/usage') return json({ ai_remaining: 2, authenticated: false })
      if (path === '/api/templates') return json({ templates: [] })
      if (path === '/api/experiences') return json({ experiences: [] })
      if (path.startsWith('/api/advanced/')) return json([])
      const frame = frames.find((frame) => path === `/api/classic/layouts/${frame.id}/preview`)
      if (frame) return route.fulfill({ contentType: 'image/png', body: await readFile(resolve(root, 'templates/_classic/events', dirname(frame.filename), 'previews', `${frame.id}.png`)) })
      const original = path.match(/classic-frame-00([123])\/preview/)
      if (original) return route.fulfill({ contentType: 'image/png', body: await readFile(resolve(root, `templates/_classic/original-masters/previews/classic-frame${original[1]}.png`)) })
      return json({ authenticated: false })
    })
    await page.goto('http://127.0.0.1:5178/create?mode=classic', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Choose your frame.' }).waitFor()
    assert.equal(await page.locator('.classic-layout-card').count(), 35)
    for (const theme of [...new Set(frames.map((frame) => frame.theme_name))]) {
      await page.getByRole('navigation', { name: 'Frame themes' }).getByRole('button', { name: theme, exact: false }).click()
      assert.equal(await page.locator('.classic-layout-card').count(), 4)
      assert.equal(await page.getByRole('button', { name: /Continue to camera/ }).isEnabled(), false)
      await page.waitForFunction(() => [...document.querySelectorAll('.classic-layout-card img')].filter((image) => image.getBoundingClientRect().top < innerHeight).every((image) => image.complete && image.naturalWidth > 0))
    }
    await page.screenshot({ path: resolve(output, `${engine}-${item.name}.png`), fullPage: true })
    const chosen = frames.find((frame) => frame.theme_slug === 'birthday' && frame.shot_count === 3)
    await page.locator('.classic-layout-card').filter({ hasText: chosen.name }).click()
    await page.getByRole('button', { name: /Continue to camera/ }).click()
    await page.locator('.classic-capture').waitFor()
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow')).layoutId), chosen.id)
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('.classic-capture').waitFor()
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow')).layoutId), chosen.id)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    assert.deepEqual(errors, [])
    results.push({ device: item.name, browser: engine, themes: 8, frames: 35, selectionRecovery: true, passed: true })
    console.log(JSON.stringify(results.at(-1)))
    await context.close()
  }
  await writeFile(resolve(output, `${engine}-checks.json`), JSON.stringify(results, null, 2))
} finally {
  await browser?.close()
  await server.close()
}
