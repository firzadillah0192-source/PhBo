// Local UI contract check with explicit synthetic API/image fixtures.
// Does not upload photos, access a provider, or modify production services.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const { chromium } = await import(process.env.NXBOOTH_PLAYWRIGHT_MODULE || 'playwright-core')
const frontend = resolve(dirname(fileURLToPath(import.meta.url)),'..')
const output = resolve(frontend,'../test/output/kiosk-claim')
const server = await createServer({ root: frontend,configFile: false,plugins: [react()],cacheDir: '/tmp/nxbooth-kiosk-browser-vite',
  server: { host: '127.0.0.1',port: 5188,strictPort: true },logLevel: 'silent' })
let browser
try {
  await server.listen(); await mkdir(output,{ recursive: true })
  browser = await chromium.launch({ headless: true,...(process.env.NXBOOTH_BROWSER_EXECUTABLE ? { executablePath: process.env.NXBOOTH_BROWSER_EXECUTABLE } : {}) })
  const code = 'c'.repeat(24),token = 't'.repeat(43),jobId = 'b'.repeat(32),resultId = 'd'.repeat(32)
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="480"><rect width="320" height="480" fill="#374151"/><circle cx="160" cy="170" r="70" fill="#c7b39a"/><text x="160" y="330" text-anchor="middle" fill="white" font-size="15">Synthetic test fixture</text></svg>'
  for (const [device,viewport] of [['desktop',{ width: 1440,height: 1000 }],['phone',{ width: 390,height: 844 }],['tablet',{ width: 820,height: 1180 }]]) {
    for (const mode of ['CLASSIC','BASIC','ADVANCED']) {
      const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = []
      page.on('pageerror',error => errors.push(error.message))
      let claimed = false,polls = 0,lostResponse = false,signedRequests = 0,fallbackRequests = 0
      const keys = [],photos = [1,2,3].map(n => ({ id: String(n).repeat(32),imageUrl: `/api/v1/photos/${String(n).repeat(32)}`,width: 320,height: 480 }))
      const session = { code,id: 'session',photos,generationLimit: 3,remainingGeneration: 3,claimed: true,expiresAt: new Date(Date.now()+3600000).toISOString() }
      const job = { id: jobId,mode,status: 'PROCESSING',resultId: null,createdAt: new Date().toISOString() }
      await page.route('https://signed.fixture/**',route => { signedRequests++; return route.abort('failed') })
      await page.route('**/api/**',async route => {
        if (new URL(route.request().url()).hostname === 'signed.fixture') { signedRequests++; return route.abort('failed') }
        const path = new URL(route.request().url()).pathname,method = route.request().method()
        const json = (data,status = 200) => route.fulfill({ status,contentType: 'application/json',body: JSON.stringify({ data }) })
        if (path === `/api/v1/photo-sessions/${code}`) return claimed ? json(session) : route.fulfill({ status: 401,contentType: 'application/json',body: '{}' })
        if (path.endsWith('/claim') && path.includes('/photo-sessions/')) { claimed = true; return json(session) }
        if (path === '/api/v1/frames') return json([{ id: 'reviewed',name: 'Reviewed Classic',slug: 'reviewed',shot_count: 3,preview_url: '/api/fixture',theme_name: 'Classic Originals' }])
        if (path === '/api/v1/templates') return json([{ id: 'template',name: 'Curated Fixture',description: 'Synthetic preview',preview_url: '/api/fixture',basic_available: true }])
        if (path === '/api/v1/experiences') return json([{ id: 'world',name: 'Featured Fixture',category: 'PORTRAIT',description: 'Synthetic preview',thumbnail: '/api/fixture',max_ornaments: 3 }])
        if (path === '/api/v1/frame-styles') return json([{ id: 'natural',slug: 'natural',name: 'Natural',description: 'Subtle framing.' }])
        if (path === '/api/v1/ornaments') return json([{ id: 'sparkles',name: 'Sparkles' }])
        if (path === '/api/v1/generations' && method === 'POST') {
          keys.push(route.request().headers()['idempotency-key'])
          const body = route.request().postDataJSON()
          assert.equal(body.mode,mode); assert.equal(body.sessionCode,code); assert.equal(body.photoIds.length,mode === 'CLASSIC' ? 3 : 1)
          if (mode === 'ADVANCED') { assert.equal(body.frameStyleId,'natural'); assert.deepEqual(body.ornamentIds,['sparkles']) }
          if (device === 'desktop' && mode === 'ADVANCED' && !lostResponse) { lostResponse = true; return route.abort('failed') }
          return json(job,202)
        }
        if (path === `/api/v1/generations/${jobId}`) return json(++polls === 1 ? job : { ...job,status: 'COMPLETED',resultId })
        if (path === `/api/v1/results/${resultId}`) return json({ print_download_url: mode === 'CLASSIC' ? `/api/v1/results/${resultId}/download?rendition=print` : null })
        if (path === `/api/v1/results/${resultId}/claim`) return json({ claim_url: `http://127.0.0.1:5188/r/${token}`,expires_at: new Date(Date.now()+3600000).toISOString() })
        if (/^\/api\/v1\/(photos|results)\/[a-f0-9]{32}\/url$/.test(path)) return json({ url: `https://signed.fixture${path}`,delivery: 'minio',expires_at: new Date(Date.now()+60000).toISOString() })
        if (path === '/api/fixture' || path.startsWith('/api/v1/photos/') || path.endsWith('/image')) { fallbackRequests++; return route.fulfill({ contentType: 'image/svg+xml',body: image }) }
        return route.fulfill({ status: 404,contentType: 'application/json',body: '{}' })
      })
      await page.goto(`http://127.0.0.1:5188/claim/${code}#token=${token}`)
      await page.getByRole('heading',{ name: 'Choose how you want to create.' }).waitFor()
      assert.equal(new URL(page.url()).hash,'')
      await page.getByRole('link',{ name: `Choose ${mode[0]+mode.slice(1).toLowerCase()}` }).click()
      await page.locator(mode === 'CLASSIC' ? '.classic-layout-card' : mode === 'BASIC' ? '.template-card' : '.look-card').first().click()
      const continueButton = page.getByRole('button',{ name: mode === 'CLASSIC' ? /Continue to camera/ : mode === 'BASIC' ? /Continue to photo/ : /Choose frame style/ })
      if (await continueButton.count()) await continueButton.click()
      if (mode === 'ADVANCED') {
        await page.locator('.advanced-options').waitFor()
        await page.locator('.advanced-style-card').first().click()
        await page.getByRole('button',{ name: 'Sparkles',exact: true }).click()
        await page.getByRole('button',{ name: /Continue to photo/ }).click()
      } else {
        await page.locator('.kiosk-photo-grid').waitFor()
      }
      await page.getByRole('button',{ name: 'Generate',exact: true }).click()
      if (device === 'desktop' && mode === 'ADVANCED') {
        await page.getByRole('alert').waitFor(); await page.reload()
        await page.getByRole('button',{ name: 'Generate',exact: true }).click()
        assert.equal(keys.length,2); assert.equal(keys[0],keys[1])
      }
      await page.getByRole('link',{ name: /Download photo/ }).waitFor()
      assert.equal(await page.getByRole('link',{ name: /Download photo/ }).getAttribute('href'),`/api/v1/results/${resultId}/download`)
      await page.reload(); await page.getByRole('link',{ name: /Download photo/ }).waitFor()
      await page.waitForFunction(() => {
        const img = document.querySelector('.result-frame > img')
        return img?.complete && img.naturalWidth>0 && img.getAttribute('src')?.startsWith('/api/v1/results/')
      })
      await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.startsWith('https://signed.fixture/')))
      assert.ok(signedRequests>0,'signed delivery was attempted'); assert.ok(fallbackRequests>0,'API images remain available')
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1),true,`${device}/${mode} must fit viewport`)
      assert.deepEqual(errors,[])
      await page.screenshot({ path: resolve(output,`${device}-${mode.toLowerCase()}.png`),fullPage: true })
      console.log(`PASS ${device}: ${mode} claim, selection, generation, Result and refresh`)
      await context.close()
    }
  }
} finally { await browser?.close(); await server.close() }
