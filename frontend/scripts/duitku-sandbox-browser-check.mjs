import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from '../../frontend-enhanced/node_modules/playwright/index.mjs'
const output = '/opt/photobooth/test/output/duitku-sandbox'
await mkdir(output, { recursive: true })
const source = `import React from 'react';import{createRoot}from'react-dom/client';import Payments from '/src/components/admin/PaymentsPanel.jsx';import TopUp from '/src/components/customer/SandboxTopUp.jsx';import '/src/styles.css';import '/src/admin-retro.css';function App(){return location.search.includes('admin')?<div className="admin-app admin-retro"><Payments/></div>:<TopUp/>}createRoot(document.getElementById('root')).render(<App/>);`
const vite = await createServer({ root: '/opt/photobooth/frontend', logLevel: 'silent', server: { host: '127.0.0.1', port: 5204, strictPort: true }, plugins: [{ name: 'duitku-test', resolveId(id) { if (id === '/duitku-check.jsx') return id }, load(id) { if (id === '/duitku-check.jsx') return source }, configureServer(server) { server.middlewares.use(async (req, res, next) => { if (req.url.startsWith('/duitku-check?')) { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/duitku-check.jsx"></script></body></html>')) } else next() }) } }] })
await vite.listen()
const browser = await chromium.launch({ executablePath: '/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] })
const checks = [], failures = []
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    let paid = false, checkoutCalls = 0, requestKeys = [], accountChecks = 0
    const row = () => ({ id: 'a'.repeat(32), merchant_order_id: 'nxpay_' + 'a'.repeat(32), reference: 'DTESTREF', environment: 'sandbox', credits: 100, amount_rupiah: 10000, status: paid ? 'PAID' : 'PENDING', user_email: 'synthetic@example.invalid', created_at: '2026-10-17T08:00:00Z', paid_at: paid ? '2026-10-17T08:05:00Z' : null })
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), path = url.pathname
      let body
      if (path.endsWith('/checkout')) {
        checkoutCalls++; requestKeys.push(route.request().headers()['idempotency-key'])
        assert.equal(route.request().postDataJSON().credits, 100)
        if (checkoutCalls === 1) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ detail: { error_code: 'PAYMENT_GATEWAY_UNAVAILABLE', message: 'Fixture unavailable' } }) })
        body = { checkout_url: 'https://app-sandbox.duitku.com/redirect_checkout?reference=DTESTREF' }
      } else if (path.endsWith('/config')) body = { enabled: true, environment: 'sandbox' }
      else if (path.endsWith('/refresh')) { paid = true; accountChecks++; body = row() }
      else if (/\/[a-f0-9]{32}$/.test(path)) body = row()
      else body = { transactions: url.searchParams.get('status') === 'FAILED' ? [] : [row()], total: url.searchParams.get('status') === 'FAILED' ? 0 : 1, sandbox_balance: paid ? 100 : 0 }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await context.route('https://app-sandbox.duitku.com/**', route => route.fulfill({ status: 200, body: 'Synthetic hosted checkout; no payment made.' }))
    const page = await context.newPage(); page.on('pageerror', error => { failures.push(error.message); console.log('PAGEERROR', error.message) }); page.on('console', msg => { if(msg.type() === 'error') console.log('CONSOLE',msg.text()) })
    await page.goto('http://127.0.0.1:5204/duitku-check?customer')
    await page.getByRole('button', { name: /Bayar uji/ }).click()
    await page.getByRole('alert').waitFor()
    await page.getByRole('button', { name: /Bayar uji/ }).click()
    await page.waitForURL('https://app-sandbox.duitku.com/**')
    assert.equal(checkoutCalls, 2); assert.ok(requestKeys[0]); assert.equal(requestKeys[0], requestKeys[1])
    await page.goto('http://127.0.0.1:5204/payment-return.html?order_id=' + 'a'.repeat(32) + '&resultCode=00')
    await page.getByRole('status').filter({ hasText: 'PENDING' }).waitFor()
    assert.equal(accountChecks, 0)
    await page.getByRole('button', { name: 'Cek pembayaran ke Duitku' }).click()
    await page.getByRole('status').filter({ hasText: 'terverifikasi' }).waitFor()
    assert.equal(accountChecks, 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${output}/return-${width}.png`, fullPage: true })
    paid = false
    await page.goto('http://127.0.0.1:5204/duitku-check?admin')
    await page.getByRole('button', { name: 'Lihat', exact: true }).click()
    await page.getByRole('button', { name: 'Cek ulang ke Duitku', exact: true }).click()
    await page.getByRole('button', { name: 'Cek ulang ke Duitku', exact: true }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Cek ulang ke Duitku' && b.disabled))
    assert.equal(accountChecks, 2)
    await page.getByRole('button', { name: 'Tutup', exact: true }).click()
    await page.getByLabel('Status', { exact: true }).selectOption('FAILED')
    await page.getByText('Tidak ada transaksi yang sesuai.').waitFor()
    await page.getByLabel('Status', { exact: true }).selectOption('')
    await page.getByRole('button', { name: 'Lihat', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${output}/admin-${width}.png`, fullPage: true })
    checks.push({ width, checkoutRetrySameKey: true, redirectNotProof: true, adminCheckAndFilter: true })
    await context.close()
  }
  assert.deepEqual(failures, [])
  await writeFile(`${output}/results.json`, JSON.stringify({ status: 'PASS', checks, failures }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', checks }))
} finally { await browser.close(); await vite.close() }
