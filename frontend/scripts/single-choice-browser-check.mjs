// UI acceptance only: all API calls intercepted; never runs paid generation.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const { chromium } = await import(process.env.NXBOOTH_PLAYWRIGHT_MODULE || 'playwright-core')
const remote = process.env.NXBOOTH_PREVIEW_URL
const base = remote || 'http://127.0.0.1:5191'
const server = remote ? null : await createServer({ root, configFile: false, plugins: [react()], cacheDir: '/tmp/nxbooth-oneclick-vite-cache', server: { host: '127.0.0.1', port: 5191, strictPort: true }, logLevel: 'silent' })
const templates = ['a','b'].map(id => ({ id: `basic-${id}`, name: `Studio ${id}`, preview_url: '/api/fixture.svg', enabled: true, basic_available: true }))
const layouts = [3,4].map(n => ({ id: `classic-${n}`, name: `Frame ${n}`, shot_count: n, canvas_width: 1200, canvas_height: 3600, preview_url: '/api/fixture.svg', theme_slug: `theme-${n}`, theme_name: `Theme ${n}` }))
const experiences = ['a','b'].map(id => ({ id: `world-${id}`, name: `World ${id}`, category: 'cinematic', thumbnail: '/api/fixture.svg', compatible_frame_style_ids: ['modern'], max_ornaments: 3 }))
let browser
try {
  await server?.listen()
  browser = await chromium.launch({ headless: true })
  for (const width of [1440,390]) {
    for (const mode of ['BASIC','CLASSIC','ADVANCED']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const page = await context.newPage(), errors = [], mutations = []
      page.on('pageerror', error => errors.push(error.message))
      await context.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname
        if (route.request().method() !== 'GET') mutations.push(path)
        const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
        if (path === '/api/templates') return json({ templates })
        if (path === '/api/experiences') return json({ experiences })
        if (path === '/api/classic/layouts') return json(layouts)
        if (path === '/api/advanced/frame-styles') return json([{ id: 'modern', slug: 'modern', name: 'Modern', enabled: true }])
        if (path === '/api/advanced/ornaments') return json([])
        if (path === '/api/account/usage') return json({ authenticated: false, ai_remaining: 10 })
        if (path === '/api/fixture.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#304070"/></svg>' })
        return json({ authenticated: false })
      })
      await page.goto(`${base}/create?mode=${mode.toLowerCase()}`, { waitUntil: 'networkidle' })
      const card = mode === 'BASIC' ? '.template-card' : mode === 'CLASSIC' ? '.classic-layout-card' : '.look-card'
      await page.locator(card).last().waitFor()
      assert.equal(await page.locator('.gallery-page .selection-dock').count(), 0, 'Gallery must not require a second confirmation')
      if (mode === 'CLASSIC') {
        await page.locator('.classic-theme-list').getByRole('button', { name: /Theme 4/ }).click()
        assert.equal(await page.locator('.classic-layout-card').count(), 1)
        assert.equal(await page.locator('.classic-capture').count(), 0, 'Theme filtering must not choose a frame')
      }
      await page.locator(card).last().click()
      const stage = mode === 'CLASSIC' ? '.classic-capture' : mode === 'BASIC' ? '.photo-stage' : '.advanced-options'
      await page.locator(stage).waitFor()
      const field = mode === 'CLASSIC' ? 'layoutId' : mode === 'BASIC' ? 'templateId' : 'experienceId'
      const expected = mode === 'CLASSIC' ? 'classic-4' : mode === 'BASIC' ? 'basic-b' : 'world-b'
      const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow')))
      assert.equal(saved[field], expected, 'Save the clicked ID instead of the previous/default selection')
      assert.equal(saved.stage, mode === 'ADVANCED' ? 'art-direction' : 'photo')
      if (mode === 'ADVANCED') { assert.equal(saved.frameStyleId, null); assert.deepEqual(saved.ornamentIds, []) }
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator(stage).waitFor()
      assert.equal((await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow'))))[field], expected)
      await page.locator(stage).getByRole('button', { name: /Change|Back/ }).first().click()
      await page.locator(card).first().waitFor()
      await page.locator(card).first().focus()
      await page.keyboard.press('Enter')
      await page.locator(stage).waitFor()
      const changed = await page.evaluate(() => JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow')))
      assert.equal(changed[field], mode === 'CLASSIC' ? 'classic-3' : mode === 'BASIC' ? 'basic-a' : 'world-a')
      assert.deepEqual(mutations, [], 'Choosing must never upload or start generation')
      assert.deepEqual(errors, [])
      console.log(JSON.stringify({ mode, width, oneClick: 'PASS', refresh: 'PASS', keyboardChange: 'PASS' }))
      await context.close()
    }
  }
} finally { await browser?.close(); await server?.close() }
