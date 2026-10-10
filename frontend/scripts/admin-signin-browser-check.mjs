import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {chromium,request} from '/tmp/nxbooth-kiosk-browser-harness/node_modules/playwright-core/index.mjs'
const base=process.env.ADMIN_UI_BASE||'http://127.0.0.1:5194',output='/opt/photobooth/test/output/admin-signin'
assert.ok(new URL(base).hostname==='127.0.0.1'||new URL(base).hostname==='localhost'||process.env.ADMIN_TEST_API_BASE==='http://127.0.0.1:5196','Live UI writes must be routed to the disposable test API')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({executablePath:'/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']}),checks=[],errors=[]
const password='Synthetic-admin-fixture-123'
async function pageFor(width){const context=await browser.newContext({viewport:{width,height:1000}});if(process.env.ADMIN_TEST_API_BASE){const api=await request.newContext({baseURL:process.env.ADMIN_TEST_API_BASE});await context.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());const r=await api.fetch(url.pathname+url.search,{method:req.method(),...(req.postData()?{data:req.postData(),headers:{'Content-Type':req.headers()['content-type']||'application/json'}}:{})});await route.fulfill({response:r})});context.on('close',()=>api.dispose())}await context.addInitScript(()=>{let callback;window.google={accounts:{id:{initialize(options){callback=options.callback},renderButton(container){const button=document.createElement('button');button.textContent='Sign in with Google';button.onclick=()=>callback({credential:'synthetic-google-verified'});container.append(button)},disableAutoSelect(){}}}}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return{context,page}}
async function signIn(page,email){await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in to admin',exact:true}).click();await page.locator('.admin-shell').waitFor()}
async function choose(page,label,width){if(width<=900)await page.getByRole('button',{name:'Open admin navigation',exact:true}).click();await page.locator('.admin-sidebar nav').getByRole('button',{name:label,exact:true}).click();await page.waitForTimeout(100);await page.waitForLoadState('networkidle');await page.locator('.admin-loading').first().waitFor({state:'hidden'})}
try{
 for(const width of [1440,390,320]){
  const{context,page}=await pageFor(width);await page.goto(base+'/admin',{waitUntil:'networkidle'})
  await page.getByRole('button',{name:'Sign in to admin',exact:true}).waitFor();assert.equal(await page.getByLabel('Admin token').count(),0)
  await page.getByLabel('Email',{exact:true}).fill('owner@example.invalid');await page.getByLabel('Password',{exact:true}).fill('wrong-password')
  await page.getByRole('button',{name:'Show password',exact:true}).click();assert.equal(await page.getByLabel('Password',{exact:true}).getAttribute('type'),'text')
  await page.getByRole('button',{name:'Hide password',exact:true}).click()
  await page.getByRole('button',{name:'Sign in to admin',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.locator('.admin-sidebar').count(),0)
  await signIn(page,'owner@example.invalid');await choose(page,'Admin Users',width);assert.equal(await page.locator('.admin-error').count(),0)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('Synthetic-admin-fixture')),false)
  await page.screenshot({path:output+'/'+width+'-admin-users.png',fullPage:true})
  if(width<=900)await page.getByRole('button',{name:'Open admin navigation',exact:true}).click()
  await page.getByRole('button',{name:/Sign out/}).click();await page.getByRole('button',{name:'Sign in to admin',exact:true}).waitFor()
  await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Sign in to admin',exact:true}).waitFor()
  checks.push({width,label:'Email login, error, password toggle, role management, logout',status:'PASS'});await context.close()
 }
 for(const [email,visible,hidden] of [['operator@example.invalid','Users','Admin Users'],['content@example.invalid','Advanced Experiences','Users']]){
  const{context,page}=await pageFor(1440);await page.goto(base+'/admin',{waitUntil:'networkidle'});await signIn(page,email)
  assert.equal(await page.locator('.admin-sidebar nav').getByRole('button',{name:visible,exact:true}).count(),1);assert.equal(await page.locator('.admin-sidebar nav').getByRole('button',{name:hidden,exact:true}).count(),0)
  await page.getByRole('button',{name:/Sign out/}).click();checks.push({label:email+' role-aware navigation',status:'PASS'});await context.close()
 }
 const{context,page}=await pageFor(1440);await page.goto(base+'/admin',{waitUntil:'networkidle'})
 await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();await page.locator('.admin-shell').waitFor()
 await page.getByRole('button',{name:/Sign out/}).click();await page.getByRole('button',{name:'Continue to admin',exact:true}).waitFor();await page.getByRole('button',{name:'Continue to admin',exact:true}).click();await page.locator('.admin-shell').waitFor()
 checks.push({label:'Google verified identity and continue with existing NXBooth session',status:'PASS'})
 await choose(page,'Admin Users',1440)
 await page.getByLabel('ID',{exact:true}).fill('browser-extra');await page.getByLabel('Name',{exact:true}).fill('Fixture extra admin');await page.getByLabel('Email',{exact:true}).fill('customer@example.invalid');await page.getByRole('button',{name:'Save admin',exact:true}).click();await page.waitForLoadState('networkidle');await page.getByText('Fixture extra admin',{exact:false}).last().waitFor()
 await choose(page,'Subscriptions',1440)
 for(const[label,value]of[['ID','browser-tier'],['Code','browser_tier'],['Name','Browser fixture tier'],['AI credits','20']])await page.getByLabel(label,{exact:true}).fill(value)
 await page.getByRole('button',{name:'Save plan',exact:true}).click();await page.waitForLoadState('networkidle');await page.getByText('Browser fixture tier',{exact:true}).waitFor()
 await choose(page,'Users',1440);await page.locator('tr.clickable').filter({hasText:'customer@example.invalid'}).click();await page.locator('.admin-detail').waitFor()
 await page.locator('.admin-subtabs').getByRole('button',{name:'Subscription',exact:true}).click();await page.getByLabel('Plan',{exact:true}).selectOption('browser-tier');await page.getByRole('button',{name:'Assign / change',exact:true}).click();await page.getByText('Subscription assigned.',{exact:true}).waitFor()
 assert.equal(await page.locator('.admin-error').count(),0);await page.getByRole('button',{name:'← Users',exact:true}).click()
 checks.push({label:'Create extra admin and assign user tier through real Express (test DB only)',status:'PASS'})
 await context.close();assert.deepEqual(errors,[]);await writeFile(output+'/report.json',JSON.stringify({base,testApi:process.env.ADMIN_TEST_API_BASE||'local proxy',checks,errors,productionWrites:0},null,2));console.log(JSON.stringify({base,status:'PASS',checks:checks.length,productionWrites:0,errors}))
}finally{await browser.close()}
