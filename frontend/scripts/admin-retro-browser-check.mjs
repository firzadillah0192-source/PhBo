import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium, request } from '/tmp/nxbooth-kiosk-browser-harness/node_modules/playwright-core/index.mjs'
const base=process.env.ADMIN_UI_BASE || 'http://127.0.0.1:5194'
const output=process.env.ADMIN_CHECK_OUTPUT || '/tmp/nxbooth-admin-retro'
await mkdir(output,{recursive:true})
const env=await readFile('/opt/photobooth/.env','utf8')
const token=env.match(/^ADMIN_TOKEN=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'')
assert.ok(token,'Configured credential available')
const api=await request.newContext({baseURL:'https://nxbooth.gennexbyte.com'})
const login=await api.post('/api/admin/login',{data:{token}})
assert.equal(login.status(),200,'Read-only audit session login')
const browser=await chromium.launch({executablePath:'/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']})
const labels=['Overview','Users','Credits','Subscriptions','Generations','Provider Ops / Routing','Classic Layouts','Advanced Experiences','Advanced Styles','Basic Templates','Admin Users','Audit Log','Settings']
const checks=[],errors=[],blockedWrites=[]
let fixture=false,failPath='',plans=[],mutations=[]
async function routeApi(route){
 const req=route.request(),url=new URL(req.url()),method=req.method(),path=url.pathname
 if(method!=='GET'){
  if(fixture&&path.startsWith('/api/admin/plans')){
   const body=req.postDataJSON();mutations.push({method,path,body})
   if(method==='POST')plans.push({...body,created_at:'2026-10-07',updated_at:'2026-10-07'});else plans=plans.map(p=>p.id===decodeURIComponent(path.split('/').at(-1))?{...p,...body}:p)
   return route.fulfill({status:200,json:body})
  }
  blockedWrites.push({method,path});return route.fulfill({status:405,json:{detail:{message:'Business mutations blocked by audit'}}})
 }
 if(path===failPath)return route.fulfill({status:503,json:{detail:{message:'Audit: service temporarily unavailable'}}})
 if(fixture&&path==='/api/admin/plans')return route.fulfill({status:200,json:plans})
 const r=await api.get(path+url.search)
 await route.fulfill({status:r.status(),body:await r.body(),headers:{'content-type':r.headers()['content-type']||'application/json','cache-control':'no-store'}})
}
async function choose(page,label,width){
 if(width<=900)await page.getByRole('button',{name:'Open admin navigation',exact:true}).click()
 await page.locator('.admin-sidebar nav').getByRole('button',{name:label,exact:true}).click()
 await page.waitForTimeout(100)
 await page.waitForLoadState('networkidle')
 await page.locator('.admin-loading').first().waitFor({state:'hidden'})
 if(['Classic Layouts','Advanced Experiences'].includes(label))await page.locator('.admin-content-card').first().waitFor()
 if(label==='Basic Templates')await page.locator('.admin-template-admin-card').first().waitFor()
 assert.equal(await page.locator('.admin-sidebar').count(),1,'Shell survives navigation')
 assert.equal(await page.locator('.admin-error-boundary').count(),0,'No section render error')
 assert.equal(await page.locator('.admin-sidebar nav [aria-current="page"]').innerText(),label)
}
try{
 for(const width of [1440,820,390,320]){
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage()
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',routeApi)
  await page.goto(base+'/admin',{waitUntil:'networkidle'});await page.locator('.admin-sidebar').waitFor({state:'attached'})
  if(width<=900){
   await page.getByRole('button',{name:'Open admin navigation',exact:true}).click()
   await page.keyboard.press('Escape')
   assert.equal(await page.getByRole('button',{name:'Open admin navigation',exact:true}).getAttribute('aria-expanded'),'false')
   assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Open admin navigation')
  }
  for(const label of labels){
   await choose(page,label,width)
   assert.equal(await page.locator('.admin-error').count(),0,`${label} uses actual Express response`)
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)
   assert.equal(overflow,false,`${label} no document overflow at ${width}`)
   checks.push({width,label,status:'PASS'})
   await page.screenshot({path:output+'/'+width+'-'+label.toLowerCase().replace(/[^a-z]+/g,'-')+'.png',fullPage:true})
   if(label==='Generations'&&width===1440&&await page.locator('tr.clickable').count()){
    await page.locator('tr.clickable').first().click();await page.waitForLoadState('networkidle')
    await page.locator('.admin-run-detail').waitFor();assert.equal(await page.locator('.admin-error').count(),0)
    checks.push({label:'Express generation detail, result and timeline',status:'PASS'})
   }
  }
  await context.close()
 }
 const context=await browser.newContext({viewport:{width:1440,height:950}}),page=await context.newPage()
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',routeApi)
 await page.goto(base+'/admin',{waitUntil:'networkidle'})
 for(const [label,path] of [['Credits','/api/admin/credits/ledger'],['Audit Log','/api/admin/audit'],['Settings','/api/admin/settings'],['Subscriptions','/api/admin/subscriptions']]){
  failPath=path;await choose(page,label,1440);await page.locator('.admin-error').waitFor()
  assert.match(await page.locator('.admin-error').innerText(),/temporarily unavailable/)
  failPath='';await page.getByRole('button',{name:/Refresh data/}).click();await page.waitForLoadState('networkidle')
  assert.equal(await page.locator('.admin-error').count(),0,'Refresh recovers failed reads')
  checks.push({label:label+' API failure and retry',status:'PASS'})
 }
 fixture=true;await choose(page,'Overview',1440);await page.getByRole('button',{name:/Refresh data/}).click()
 await choose(page,'Subscriptions',1440)
 for(const [label,value] of [['ID','audit-fixture-plan'],['Code','audit-fixture'],['Name','Audit fixture'],['AI credits','20']])await page.getByLabel(label,{exact:true}).fill(value)
 await page.getByRole('button',{name:'Save plan',exact:true}).click();await page.waitForLoadState('networkidle')
 assert.equal(mutations.length,1);assert.equal(mutations[0].method,'POST');assert.equal(mutations[0].body.monthly_ai_credits,20)
 await page.locator('.admin-table').getByRole('button',{name:'Edit',exact:true}).click()
 assert.equal(await page.getByLabel('ID',{exact:true}).isDisabled(),true)
 await page.getByLabel('Name',{exact:true}).fill('Audit fixture edited')
 await page.getByRole('button',{name:'Save plan',exact:true}).click();await page.waitForLoadState('networkidle')
 assert.equal(mutations.length,2);assert.equal(mutations[1].method,'PATCH');assert.equal(mutations[1].path,'/api/admin/plans/audit-fixture-plan')
 assert.deepEqual(Object.keys(mutations[1].body).sort(),['name','description','monthly_ai_credits','billing_period','price_amount','currency','is_active'].sort())
 checks.push({label:'Plan POST create / PATCH edit (mock only)',status:'PASS'})
 await context.close()
 assert.deepEqual(errors,[],'No browser runtime errors');assert.deepEqual(blockedWrites,[],'No business writes attempted against production')
 await writeFile(output+'/report.json',JSON.stringify({base,checks,errors,businessWritesToProduction:0},null,2))
 console.log(JSON.stringify({base,checks:checks.length,status:'PASS',errors,businessWritesToProduction:0}))
}finally{await api.post('/api/admin/logout');await api.dispose();await browser.close()}
