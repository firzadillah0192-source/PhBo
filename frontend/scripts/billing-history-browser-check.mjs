import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from '../../frontend-enhanced/node_modules/playwright/index.mjs'
const root = process.env.NXBOOTH_BILLING_ROOT || '/opt/photobooth/frontend'
const output = '/opt/photobooth/test/output/billing-history'
await mkdir(output, { recursive: true })
const source = `import React from 'react';import{createRoot}from'react-dom/client';import AccountCenter from '/src/components/customer/AccountCenter.jsx';import '/src/styles.css';import '/src/customer.css';import '/src/retro.css';function Harness(){const[tab,setTab]=React.useState('billing');return <div className="retro-app customer-app"><AccountCenter usage={{authenticated:true}} tab={tab} onTabChange={setTab} onHome={()=>{}} onUsageChanged={()=>{}}/></div>}createRoot(document.getElementById('root')).render(<Harness/>);`
const vite = await createServer({ root, logLevel: 'silent', server: { host: '127.0.0.1', port: 5205, strictPort: true }, plugins: [{ name: 'billing-history-test', resolveId(id) { if (id === '/billing-check.jsx') return id }, load(id) { if (id === '/billing-check.jsx') return source }, configureServer(server) { server.middlewares.use(async (req, res, next) => { if (req.url === '/billing-check') { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/billing-check.jsx"></script></body></html>')) } else next() }) } }] })
await vite.listen()
const browser = await chromium.launch({ executablePath: '/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] })
const results = [], errors = []
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    let mode = 'pending', checks = 0, historyCalls = 0, enabled = true
    const row = () => ({ id: 'a'.repeat(32), merchant_order_id: 'nxpay_' + 'a'.repeat(32), credits: 100, amount_rupiah: 10000, status: mode === 'paid' ? 'PAID' : 'PENDING' })
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/account/center') return route.fulfill({ json: { account: { email: 'synthetic@example.invalid', display_name: 'Test account' }, usage: { authenticated: true, ai_remaining: 50 }, current_plan: { name: 'Free' }, creations: [], sessions: [], privacy: {}, billing: { enabled, message: enabled ? 'Sandbox: saldo uji terpisah.' : 'Pembayaran belum tersedia.' } } })
      if (path.endsWith('/refresh')) { checks++; mode = 'paid'; return route.fulfill({ json: row() }) }
      if (path === '/api/account/topups') {
        historyCalls++
        await new Promise(resolve => setTimeout(resolve, 100))
        if (mode === 'error') return route.fulfill({ status: 503, json: { detail: { error_code: 'PAYMENT_GATEWAY_UNAVAILABLE', message: 'Riwayat tidak dapat dimuat.' } } })
        return route.fulfill({ json: { transactions: mode === 'empty' ? [] : [row()], total: mode === 'empty' ? 0 : 1, sandbox_balance: mode === 'paid' ? 100 : 0 } })
      }
      return route.fulfill({ status: 404, json: {} })
    })
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:5205/billing-check')
    await page.getByRole('heading', { name: 'Riwayat pembayaran.', exact: true }).waitFor()
    await page.getByText(/100 kredit uji.*PENDING/).waitFor()
    assert.equal(checks, 0)
    assert.equal(await page.getByText('Billing is not live yet', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Cek pembayaran', exact: true }).click()
    await page.getByText(/100 kredit uji.*PAID/).waitFor()
    assert.equal(checks, 1)
    await page.screenshot({ path: `${output}/billing-paid-${width}.png`, fullPage: true })
    mode = 'error'; await page.getByRole('button', { name: 'Muat ulang riwayat' }).click()
    await page.getByRole('alert').filter({ hasText: 'Riwayat tidak dapat dimuat.' }).waitFor()
    mode = 'empty'; await page.getByRole('button', { name: 'Muat ulang riwayat' }).click()
    await page.getByText('Belum ada transaksi Sandbox.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('alert').count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const before = historyCalls; enabled = false; await page.reload()
    await page.getByRole('heading', { name: 'Pembayaran belum tersedia.', exact: true }).waitFor()
    assert.equal(historyCalls, before)
    assert.equal(await page.getByRole('region', { name: 'Riwayat pembayaran Sandbox' }).count(), 0)
    results.push({ width, billingHistory: true, manualCheck: true, errorRetry: true, emptyState: true, disabledState: true })
    await context.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(`${output}/results.json`, JSON.stringify({ status: 'PASS', results, errors }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', results }))
} finally { await browser.close(); await vite.close() }
