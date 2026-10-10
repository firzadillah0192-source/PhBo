import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from '/tmp/nxbooth-kiosk-browser-harness/node_modules/playwright-core/index.mjs'
const output = '/opt/photobooth/test/output/credit-wallet'
await mkdir(output, { recursive: true })
const vite = await createServer({ root: '/opt/photobooth/frontend', server: { host:'127.0.0.1', port:5195, strictPort:true, proxy:{'/api':{target:'http://127.0.0.1:5196',changeOrigin:true}} }, logLevel:'silent' })
await vite.listen()
const browser = await chromium.launch({ executablePath:'/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args:['--no-sandbox'] })
const checks=[], errors=[]
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#d9e8fd"/><rect x="100" y="100" width="400" height="400" rx="24" fill="#f6eedb" stroke="#263449" stroke-width="8"/><text x="300" y="310" text-anchor="middle" fill="#263449" font-size="32">Catalog fixture</text></svg>'
const base='http://127.0.0.1:5195'
try {
 for (const width of [1440,390,320]) {
  const context = await browser.newContext({ viewport:{width,height:900},reducedMotion:'reduce' })
  const response=await context.request.post('http://127.0.0.1:5196/api/account/login',{data:{email:'creator@example.invalid',password:'Synthetic-wallet-preview-123'}})
  assert.equal(response.status(),200)
  await context.route('**/fixture-preview.svg',route=>route.fulfill({contentType:'image/svg+xml',body:svg}))
  const page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message))
  for (const [mode,name,search] of [['classic','Photo Booth','Blue'],['basic','Scene Remix','Retro'],['advanced','Creative Studio','Pixel']]) {
   await page.goto(`${base}/create?mode=${mode}`)
   const dialog=page.getByRole('dialog',{name,exact:true}); await dialog.waitFor()
   await dialog.locator('.studio-picker-card').first().waitFor(); const input=dialog.getByRole('searchbox'); await input.fill(search)
   await assert.equal(await dialog.locator('.studio-picker-card').count(),1)
   await input.fill('zzzz-does-not-exist'); await page.getByRole('heading',{name:'Tidak ada yang cocok.'}).waitFor()
   await dialog.getByRole('button',{name:'Hapus pencarian'}).click()
   assert.equal(await dialog.locator('.studio-picker-card').count(),2)
   await dialog.locator('button').last().focus(); await page.keyboard.press('Tab')
   assert.equal(await dialog.getByRole('button',{name:'Back',exact:true}).evaluate(node=>node===document.activeElement),true)
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden')
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true)
   if(mode==='basic')await page.screenshot({path:`${output}/picker-${width}.png`})
   await dialog.getByRole('button',{name:'Back',exact:true}).click(); await page.waitForURL('**/create')
   assert.equal(await page.getByRole('dialog').count(),0)
   await page.goto(`${base}/create?mode=${mode}`); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); await page.waitForURL(base+'/')
   assert.equal(await page.evaluate(()=>document.body.style.overflow),'')
   checks.push(`picker ${mode} ${width}: search, empty, clear, focus trap, Back, Escape, no overflow`)
  }
  await page.goto(`${base}/account?tab=plan`)
  await page.getByRole('heading',{name:'Tambah Bekal Kreatif.'}).waitFor({timeout:8000}).catch(async error=>{ console.log('ACCOUNT DEBUG',errors,await page.locator('body').innerText()); await page.screenshot({path:output+'/account-debug.png'}); throw error })
  await page.getByRole('button',{name:/Racik Bekalmu/}).click()
  await page.getByLabel('Jumlah kredit',{exact:true}).fill('750')
  assert.match(await page.locator('.bekal-total').innerText(),/75\.000/)
  await page.getByRole('button',{name:'Bayar',exact:true}).click()
  const paymentNotice=page.getByRole('dialog',{name:'Pembayaran belum tersedia'}); await paymentNotice.waitFor(); assert.equal(await paymentNotice.getByRole('link',{name:'support@gennexbyte.com'}).getAttribute('href'),'mailto:support@gennexbyte.com'); await page.keyboard.press('Escape')
  const usage=await (await context.request.get('http://127.0.0.1:5196/api/account/usage')).json()
  assert.equal(usage.credit_wallet.free_remaining,50); assert.equal(usage.credit_wallet.top_up_remaining,0)
  await page.getByLabel('Jumlah kredit',{exact:true}).fill('1.5'); assert.equal(await page.getByRole('button',{name:'Bayar',exact:true}).isDisabled(),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true)
  checks.push(`wallet ${width}: real account API, custom Rp75000, invalid input, no fake topup, no overflow`)
  await page.screenshot({path:`${output}/wallet-${width}.png`}); await context.close()
 }
 for (const [email,remaining] of [['low@example.invalid',9],['exact@example.invalid',10]]) {
  const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'})
  await context.request.post('http://127.0.0.1:5196/api/account/login',{data:{email,password:'Synthetic-wallet-preview-123'}})
  await context.addInitScript(()=>sessionStorage.setItem('photobooth:active-customer-flow',JSON.stringify({mode:'BASIC',uploadId:'saved-photo',templateId:'scene-one',stage:'review'})))
  await context.route('**/fixture-preview.svg',route=>route.fulfill({contentType:'image/svg+xml',body:svg}))
  await context.route('**/api/uploads/saved-photo*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({upload_id:'saved-photo',preview_url:'/fixture-preview.svg'})}))
  let posts=0
  await context.route('**/api/generations',route=>{posts++;return route.fulfill({contentType:'application/json',body:JSON.stringify({job_id:'synthetic-job',state:'QUEUED',mode:'BASIC',upload_id:'saved-photo'})})})
  await context.route('**/api/generations/synthetic-job*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({job_id:'synthetic-job',state:'PROCESSING',mode:'BASIC',upload_id:'saved-photo'})}))
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('response',async response=>{if(response.url().includes('/api/')&&response.status()>=400)console.log('API ERROR',response.url(),response.status(),await response.text())});await page.goto(base+'/create?mode=basic')
  const generate=page.getByRole('button',{name:'Generate AI'});await generate.waitFor({timeout:8000}).catch(async error=>{console.log('REVIEW DEBUG',email,errors,await page.locator('body').innerText(),await page.evaluate(()=>sessionStorage.getItem('photobooth:active-customer-flow')));throw error});await page.waitForFunction(()=>document.querySelector('.customer-credit')?.textContent.includes('credit'))
  if(remaining===9){assert.equal(await generate.isDisabled(),true);await page.getByRole('button',{name:'Isi Bekal',exact:true}).click();await page.getByRole('dialog',{name:'Tambah Bekal Kreatif'}).waitFor();assert.match(await page.locator('.bekal-minimum').innerText(),/minimal 10 kredit/);assert.equal(posts,0);assert.equal(new URL(page.url()).pathname,'/create');await page.screenshot({path:output+'/minimum-popup.png'});await page.keyboard.press('Escape');await generate.waitFor()}
  else {assert.equal(await generate.isDisabled(),false);await generate.click();await page.waitForURL('**/generate/synthetic-job');assert.equal(posts,1)}
  checks.push(`AI minimum ${remaining}: ${remaining===9?'popup, saved photo retained, no generation':'10 allowed, one request'}`);await context.close()
 }
 assert.deepEqual(errors,[])
 await writeFile(output+'/report.json',JSON.stringify({checks,errors,realAccountApi:true,syntheticCatalog:true,realProviderCalls:0,productionWrites:0},null,2))
 console.log(`PASS ${checks.length} browser scenarios; real disposable account API; 0 production writes / provider calls`)
} finally { await browser.close(); await vite.close() }
