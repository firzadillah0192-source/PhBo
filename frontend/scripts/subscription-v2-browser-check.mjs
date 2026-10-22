import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from '../../frontend-enhanced/node_modules/playwright/index.mjs'
import { subscriptionCatalog } from '../../backend-express/src/services/subscription-policy.service.ts'

const output = process.env.NXBOOTH_SUBSCRIPTION_OUTPUT || '/opt/photobooth/test/output/subscription-v2'
await mkdir(output, { recursive: true })
const source = `import React from 'react';import{createRoot}from'react-dom/client';import AccountCenter from '/src/components/customer/AccountCenter.jsx';import ReviewStage from '/src/components/customer/ReviewStage.jsx';import GenerationApiRoutes from '/src/components/admin/GenerationApiRoutes.jsx';import '/src/styles.css';import '/src/customer.css';import '/src/retro.css';import '/src/admin-retro.css';function Harness(){const[tab,setTab]=React.useState('plan'),[lane,setLane]=React.useState('standard');const screen=new URLSearchParams(location.search).get('screen');const s=new URLSearchParams(location.search).has('free')?{...window.__subscription,plan:{...window.__subscription.plan,premium:false}}:window.__subscription;return <div className={screen==='admin'?'admin-retro':'retro-app customer-app'} style={{padding:screen==='admin'?16:undefined}}>{screen==='admin'?<GenerationApiRoutes/>:screen==='review'?<ReviewStage mode="BASIC" subscription={s} apiRoutes={{standard:true,fast:new URLSearchParams(location.search).has('ready')}} aiLane={lane} onAiLane={setLane} selection={{name:'Synthetic template'}} upload={{upload_id:'fixture'}} aiRemaining={s.ai.remaining} onCreate={()=>{}}/>:<AccountCenter usage={{authenticated:true}} tab={tab} onTabChange={setTab} onHome={()=>{}} onUsageChanged={()=>{}}/>}</div>}createRoot(document.getElementById('root')).render(<Harness/>);`
const catalog = subscriptionCatalog()
const plan = catalog.plans.find(p => p.code === 'starter')
const subscription = { policy_version: 2, plan, period_start: '2026-10-18T00:00:00Z', period_end: '2026-11-17T00:00:00Z', ai: { monthly_remaining: 2500, top_up_remaining: 0, remaining: 2500 }, classic: { monthly_remaining: 1250, top_up_remaining: 0, remaining: 1250, daily_remaining: 5, daily_limit: 5 }, storage: { used_bytes: 4000000, reserved_bytes: 0, limit_bytes: 500000000 }, catalog }
const server = await createServer({ root: process.env.NXBOOTH_SUBSCRIPTION_ROOT || '/opt/photobooth/frontend', logLevel: 'silent', server: { host: '127.0.0.1', port: 5207, strictPort: true }, plugins: [{ name: 'subscription-test', resolveId(id) { if (id === '/subscription-check.jsx') return id }, load(id) { if (id === '/subscription-check.jsx') return source }, configureServer(vite) { vite.middlewares.use(async (req,res,next) => { if (req.url.startsWith('/subscription-check?')) { res.setHeader('Content-Type','text/html'); res.end(await vite.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/subscription-check.jsx"></script></body></html>')) } else next() }) } }] })
await server.listen()
const browser = await chromium.launch({ executablePath: '/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] })
const results = [], errors = []
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addInitScript(value => { window.__subscription = value }, subscription)
    let saved = 0, checkout = 0, historyMode = 'ok'
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/account/center') return route.fulfill({ json: { account: { email: 'synthetic@example.invalid' }, usage: { authenticated: true, ai_remaining: 2500, subscription }, current_plan: plan, plans: [], creations: [], sessions: [], privacy: { retention_message: 'Retensi mengikuti paket.' }, billing: { enabled: true } } })
      if (path === '/api/account/topups') return route.fulfill({ json: { transactions: [], total: 0, sandbox_balance: null } })
      if (path.endsWith('/checkout')) {
        checkout++
        if (path.includes('/subscriptions/')) assert.equal(route.request().postDataJSON().plan_code, 'plus')
        else assert.equal(route.request().postDataJSON().credits, 1000)
        return route.fulfill({ status: 503, json: { detail: { error_code: 'PAYMENT_GATEWAY_UNAVAILABLE', message: 'Simulasi checkout belum terhubung.' } } })
      }
      if (path === '/api/admin/generation-api-routes') return route.fulfill({ json: { routes: [{ lane:'standard', enabled:true, configured:true, ready:true, model:'openai/gpt-image-2.5-flare', credits:50 }, {lane:'fast', enabled:false, configured:false, ready:false, model:'gpt-image-2.5-flare', credits:100 }] } })
      if (path === '/api/admin/generation-api-routes/fast') { saved++; assert.equal(route.request().postDataJSON().api_key,'synthetic-only'); return route.fulfill({json:{lane:'fast',enabled:true,configured:true,ready:true,model:'gpt-image-2.5-flare',credits:100}}) }
      return route.fulfill({status:404,json:{}})
    })
    const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message))
    await page.goto('http://127.0.0.1:5207/subscription-check?screen=plans')
    await page.getByRole('heading',{name:'Pilih paket bulanan',exact:true}).waitFor()
    for (const name of ['Free','Starter','Plus','Pro','Max']) await page.getByRole('heading',{name,exact:true}).waitFor()
    await page.getByRole('button',{name:'Pilih Plus',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'Simulasi checkout belum terhubung.'}).waitFor()
    await page.getByRole('button',{name:'Checkout AI Credit',exact:true}).click()
    assert.equal(checkout,2)
    await page.screenshot({path:`${output}/plans-${width}.png`,fullPage:true})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.goto('http://127.0.0.1:5207/subscription-check?screen=review')
    assert.equal(await page.getByRole('radio',{name:/Standard/}).isChecked(),true)
    assert.equal(await page.getByRole('radio',{name:/Fast/}).isDisabled(),true)
    await page.getByText(/50 AI Credit per hasil berhasil/).waitFor()
    await page.goto('http://127.0.0.1:5207/subscription-check?screen=review&ready=1')
    await page.getByRole('radio',{name:/Fast/}).check()
    await page.getByText(/100 AI Credit per hasil berhasil/).waitFor()
    await page.goto('http://127.0.0.1:5207/subscription-check?screen=review&ready=1&free=1')
    assert.equal(await page.getByRole('radio',{name:/Fast/}).isDisabled(),true)
    await page.goto('http://127.0.0.1:5207/subscription-check?screen=admin')
    await page.getByRole('heading',{name:'Fast · OpenAI langsung',exact:true}).waitFor()
    const fast = page.locator('form').filter({has:page.getByRole('heading',{name:'Fast · OpenAI langsung',exact:true})})
    await fast.getByLabel('API key baru').fill('synthetic-only')
    await fast.getByLabel('Aktifkan jalur').check()
    await fast.getByRole('button',{name:'Simpan jalur'}).click()
    await fast.getByRole('status').waitFor()
    assert.equal(await fast.getByLabel('API key baru').inputValue(),'')
    assert.equal(saved,1)
    await page.screenshot({path:`${output}/admin-${width}.png`,fullPage:true})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    results.push({width,plans:true,checkoutError:true,separateBalances:true,fastDisabledWithoutKey:true,adminKeyClearedAfterSave:true})
    await context.close()
  }
  assert.deepEqual(errors,[])
  await writeFile(`${output}/results.json`,JSON.stringify({status:'PASS',fixtures:'synthetic API; no paid generation',results,errors},null,2))
  console.log(JSON.stringify({status:'PASS',results}))
} finally { await browser.close(); await server.close() }
