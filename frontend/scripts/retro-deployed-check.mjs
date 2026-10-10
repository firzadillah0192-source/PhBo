// Read-only production acceptance checks. Never upload or start a generation.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const origin = process.env.NXBOOTH_PRODUCTION_URL || 'https://nxbooth.gennexbyte.com'
const release = (await readFile('/tmp/photobooth-retro-release-path', 'utf8')).trim()
const output = '/opt/photobooth/test/output/retro-deployed'
await mkdir(output, { recursive: true })
const sha = (data) => createHash('sha256').update(data).digest('hex')
const localIndex = await readFile(resolve(release, 'frontend/dist/index.html'), 'utf8')
const expectedAssets = [...localIndex.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((match) => match[1])
const response = await fetch(origin + '/', { headers: { 'cache-control': 'no-cache' } })
assert.equal(response.status, 200)
const remoteIndex = await response.text()
for (const asset of [...expectedAssets, '/fonts/baloo2-bold.ttf', '/fonts/baloo2-extrabold.ttf', '/favicon.svg']) {
  if (asset.startsWith('/assets/')) assert.ok(remoteIndex.includes(asset), 'Production must serve the new bundle')
  const actual = await fetch(origin + asset)
  assert.equal(actual.status, 200, 'Published asset is available')
  assert.equal(sha(Buffer.from(await actual.arrayBuffer())), sha(await readFile(resolve(release, 'frontend/dist', asset.slice(1)))), 'Production asset matches the release')
}
const healthResponse = await fetch(origin + '/api/health')
assert.equal(healthResponse.status, 200)
const health = await healthResponse.json()
assert.equal(health.status, 'ok')
for (const dependency of ['database', 'redis', 'storage', 'queue']) assert.equal(health.checks[dependency], 'ok')

const { chromium } = await import(process.env.NXBOOTH_PLAYWRIGHT_MODULE || '/tmp/nxbooth-kiosk-browser-harness/node_modules/playwright-core/index.mjs')
const browser = await chromium.launch({ headless: true, executablePath: process.env.NXBOOTH_BROWSER_EXECUTABLE || '/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' })
const reports = []
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }], ['narrow', { width: 320, height: 740 }], ['tablet', { width: 820, height: 1180 }]]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await context.route('**/api/generations', (route) => route.abort())
    const screenshot = async (stage) => {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name}/${stage}: no horizontal overflow`)
      await page.screenshot({ path: resolve(output, `${name}-${stage}.png`), fullPage: true })
    }
    await page.goto(origin, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: /Moments, made/ }).waitFor()
    assert.equal(await page.locator('.retro-app').count(), 1)
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.locator('.retro-app').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(255, 244, 221)')
    await screenshot('home')
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await page.getByLabel('Email', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button', { name: 'Sign In', exact: true }).getAttribute('aria-expanded'), 'false')
    await page.getByRole('link', { name: /^Try NXBooth Free/ }).first().click()
    await page.getByRole('heading', { name: 'Choose how you want to create.' }).waitFor()
    await screenshot('chooser')
    await page.getByRole('link', { name: /^Choose Basic/ }).click()
    await page.getByRole('heading', { name: 'Choose your studio.', exact: true }).waitFor()
    await page.locator('.template-card').first().click()
    await page.locator('.photo-stage').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Upload photo', exact: true }).isEnabled(), true)
    await screenshot('photo')
    await page.goBack()
    await page.getByRole('heading', { name: 'Choose your studio.', exact: true }).waitFor()
    await page.goForward()
    await page.locator('.photo-stage').waitFor()
    await page.reload({ waitUntil: 'networkidle' })
    await page.locator('.photo-stage').waitFor()
    await page.getByRole('button', { name: 'Change studio' }).click()
    await page.getByRole('heading', { name: 'Choose your studio.', exact: true }).waitFor()
    await page.getByRole('button', { name: 'All modes' }).click()
    await page.getByRole('heading', { name: 'Choose how you want to create.' }).waitFor()
    await page.getByRole('link', { name: /^Choose Advanced/ }).click()
    await page.getByRole('heading', { name: 'Choose your world.', exact: true }).waitFor()
    await page.locator('.look-card').first().click()
    await page.getByRole('heading', { name: 'Choose a frame style.' }).waitFor()
    await screenshot('frame-options')
    await page.locator('.advanced-style-card').first().click()
    await page.getByRole('button', { name: /Continue to photo/ }).click()
    await page.locator('.photo-stage').waitFor()
    await page.getByRole('button', { name: 'NXBooth', exact: true }).click()
    await page.getByRole('heading', { name: /Moments, made/ }).waitFor()
    assert.deepEqual(errors, [], `${name}: no browser runtime errors`)
    reports.push({ name, viewport, passed: true, checks: ['new production bundle and fonts', 'retro theme', 'real published catalogs', 'chooser', 'Basic photo entry', 'browser back and forward', 'refresh recovery', 'in-app back', 'Advanced frame options', 'Escape closes sign-in', 'no horizontal overflow', 'no runtime errors'] })
    console.log(JSON.stringify({ name, passed: true }))
    await context.close()
  }
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ origin, health: health.status, release, reports }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', cases: reports.length, health: 'ok', output }))
} finally {
  await browser.close()
}
