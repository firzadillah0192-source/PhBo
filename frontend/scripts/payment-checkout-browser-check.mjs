import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium } from '/tmp/nxbooth-kiosk-browser-harness/node_modules/playwright-core/index.mjs'
const output='/opt/photobooth/test/output/payment-checkout'
await mkdir(output,{recursive:true})
const source=`import React from 'react';import{createRoot}from'react-dom/client';import CreditTopUp from '/src/components/customer/CreditTopUp.jsx';import CreditTopUpModal from '/src/components/customer/CreditTopUpModal.jsx';import '/src/styles.css';import '/src/customer.css';import '/src/retro.css';const usage={authenticated:true,ai_remaining:9,credit_wallet:{free_remaining:9,top_up_remaining:0}};function Harness(){const[open,setOpen]=React.useState(true);return new URLSearchParams(location.search).has('nested')?(open?<CreditTopUpModal usage={usage} onClose={()=>setOpen(false)}/>:<p>Picker closed</p>):<CreditTopUp data={{usage}}/>}createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);`
const vite=await createServer({root:'/opt/photobooth/frontend',logLevel:'silent',server:{host:'127.0.0.1',port:5195,strictPort:true},plugins:[{name:'payment-test-harness',resolveId(id){if(id==='/payment-check.jsx')return id},load(id){if(id==='/payment-check.jsx')return source},configureServer(server){server.middlewares.use(async(req,res,next)=>{if(req.url?.startsWith('/payment-check?')||req.url==='/payment-check'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/payment-check.jsx"></script></body></html>'))}else if(req.url==='/fixture-checkout'){res.end('Fixture checkout destination')}else next()})}}]})
await vite.listen()
const browser=await chromium.launch({executablePath:'/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']})
const checks=[],errors=[]
try{
 for(const width of[1440,390,320])for(const nested of[false,true]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'})
  let status=503,posts=[],mode='normal'
  await context.route('**/api/account/topups/checkout',async route=>{
   posts.push(route.request().postDataJSON())
   if(mode==='network')return route.abort('failed')
   await new Promise(resolve=>setTimeout(resolve,100))
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{checkout_url:'/fixture-checkout'}:{detail:{error_code:status===503?'PAYMENT_GATEWAY_UNAVAILABLE':'AUTHENTICATION_REQUIRED',message:'Fixture'}})})
  })
  const page=await context.newPage();page.on('pageerror',error=>{errors.push(error.message);console.log('PAGEERROR',error.message)})
  await page.goto(`http://127.0.0.1:5195/payment-check${nested?'?nested':''}`)
  await page.getByRole('button',{name:/Racik Bekalmu/}).click()
  await page.getByLabel('Jumlah kredit',{exact:true}).fill('750')
  const pay=page.getByRole('button',{name:'Bayar',exact:true})
  await pay.click();await page.getByRole('button',{name:'Menyiapkan pembayaran…'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Menyiapkan pembayaran…'}).isDisabled(),true)
  const dialog=page.getByRole('dialog',{name:'Pembayaran belum tersedia',exact:true})
  await dialog.waitFor()
  assert.equal(await dialog.getByRole('link',{name:'support@gennexbyte.com'}).getAttribute('href'),'mailto:support@gennexbyte.com')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await dialog.getByRole('button',{name:'Kembali ke pilihan bekal'}).focus();await page.keyboard.press('Tab')
  assert.equal(await dialog.getByRole('button',{name:'Back',exact:true}).evaluate(node=>node===document.activeElement),true)
  await page.screenshot({path:`${output}/${nested?'nested':'page'}-${width}.png`})
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog',{name:'Pembayaran belum tersedia'}).count(),0)
  assert.equal(await pay.evaluate(node=>node===document.activeElement),true)
  assert.equal(await page.getByLabel('Jumlah kredit',{exact:true}).inputValue(),'750')
  assert.equal(await page.getByRole('dialog').count(),nested?1:0)
  assert.equal(await page.evaluate(()=>document.body.style.overflow),nested?'hidden':'')
  for(const close of['Back','Tutup popup','Kembali ke pilihan bekal']){
   await pay.click();await dialog.waitFor();await dialog.getByRole('button',{name:close,exact:true}).click()
   assert.equal(await page.getByRole('dialog').count(),nested?1:0)
  }
  mode='network';await pay.click();await dialog.waitFor();await page.keyboard.press('Escape');mode='normal'
  status=401;await pay.click();await page.getByRole('status').filter({hasText:'Silakan sign in kembali'}).waitFor()
  assert.equal(await page.getByRole('dialog',{name:'Pembayaran belum tersedia'}).count(),0)
  await page.getByLabel('Jumlah kredit',{exact:true}).fill('1.5');assert.equal(await pay.isDisabled(),true)
  await page.getByLabel('Jumlah kredit',{exact:true}).fill('750')
  if(nested){await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>document.body.style.overflow),'');assert.equal(await page.locator('#root').evaluate(node=>node.inert),false);await page.goto('http://127.0.0.1:5195/payment-check?nested');await page.getByRole('button',{name:/Racik Bekalmu/}).click();await page.getByLabel('Jumlah kredit',{exact:true}).fill('750')}
  const requests=posts.length;status=200;await pay.click();await page.waitForURL('**/fixture-checkout')
  assert.equal(posts.length,requests+1);assert.deepEqual(posts.at(-1),{credits:750})
  checks.push(`${width}px ${nested?'nested':'standalone'}: unavailable, network, auth, loading, amount, focus, Back/Close/Escape, connected redirect, no overflow`)
  await context.close()
 }
 assert.deepEqual(errors,[])
 await writeFile(output+'/report.json',JSON.stringify({checks,errors,syntheticGateway:true,realPayments:0,productionWrites:0},null,2))
 console.log(`PASS ${checks.length} browser scenarios; 0 real payments / production writes`)
}finally{await browser.close();await vite.close()}
