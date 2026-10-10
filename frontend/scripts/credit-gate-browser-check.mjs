import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const {chromium}=await import(process.env.NXBOOTH_PLAYWRIGHT_MODULE || '/tmp/nxbooth-kiosk-browser-harness/node_modules/playwright-core/index.mjs')
const base=process.env.NXBOOTH_PREVIEW_URL || 'http://127.0.0.1:5193'
const server=process.env.NXBOOTH_PREVIEW_URL ? null : await createServer({root,configFile:false,plugins:[react()],server:{host:'127.0.0.1',port:5193,strictPort:true},logLevel:'silent'})
const output=process.env.NXBOOTH_CREDIT_OUTPUT || '/tmp/nxbooth-credit-check'
await mkdir(output,{recursive:true})
let browser,cases=0
try{
 await server?.listen()
 browser=await chromium.launch({executablePath:'/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']})
 for(const width of [1440,390])for(const mode of ['BASIC','ADVANCED'])for(const member of [false,true])for(const race of [false,true]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'})
  let authenticated=member,remaining=race?1:0,requests=0
  const identity={id:'fixture-account',email:'fixture@example.invalid',display_name:'Fixture'}
  const usage=()=>({authenticated,ai_remaining:remaining,ai_total:authenticated?5:2,ai_used:authenticated?5:2,ai_reserved:0,used_this_period:0})
  const saved={mode,uploadId:'saved-photo',templateId:'basic',experienceId:'world',frameStyleId:'natural',ornamentIds:[],stage:'review'}
  await context.addInitScript(flow=>sessionStorage.setItem('photobooth:active-customer-flow',JSON.stringify(flow)),saved)
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
   if(path==='/api/templates')return json({templates:[{id:'basic',name:'Fixture studio',preview_url:'/api/fixture.svg',basic_available:true,enabled:true}]})
   if(path==='/api/experiences')return json({experiences:[{id:'world',name:'Fixture world',thumbnail:'/api/fixture.svg',enabled:true,compatible_frame_style_ids:['natural'],max_ornaments:0}]})
   if(path==='/api/classic/layouts')return json([])
   if(path==='/api/advanced/frame-styles')return json([{id:'natural',name:'Natural',enabled:true}])
   if(path==='/api/advanced/ornaments')return json([])
   if(path==='/api/account/usage')return json(usage())
   if(path==='/api/account/me')return json(identity)
   if(path==='/api/account/center')return json({account:identity,usage:usage(),current_plan:{code:'free',name:'Free'},plans:[],creations:[],sessions:[],billing:{message:'Not connected'}})
   if(path==='/api/account/login'||path==='/api/account/signup'){authenticated=true;remaining=5;return json(identity)}
   if(path==='/api/uploads/saved-photo')return json({upload_id:'saved-photo',preview_url:'/api/fixture.svg'})
   if(path==='/api/generations'){requests++;remaining=0;return json({detail:{error_code:'AI_QUOTA_EXHAUSTED',message:'Credits exhausted'}},403)}
   if(path==='/api/fixture.svg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#456"/></svg>'})
   throw new Error('Unexpected API request: '+path)
  })
  const page=await context.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(base+'/create?mode='+mode.toLowerCase(),{waitUntil:'networkidle'})
  await page.locator('.review-stage').waitFor()
  const generate=page.locator('.review-create .customer-solid-button')
  if(race){
   assert.equal(await generate.isEnabled(),true)
   await generate.click()
  }else{
   assert.equal(await generate.isDisabled(),true)
   await page.getByRole('button',{name:member?'Upgrade plan':'Sign in / Create account',exact:true}).click()
  }
  if(member){
   await page.waitForURL('**/account?tab=plan')
   await page.getByRole('heading',{name:'Keep your creative rhythm.'}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Sign in / Create account',exact:true}).count(),0)
   await page.goBack()
   await page.locator('.review-stage').waitFor()
   assert.equal(await generate.isDisabled(),true)
  }else{
   await page.getByLabel('Email',{exact:true}).waitFor()
   assert.match(await page.locator('.customer-account-popover').innerText(),/Sign in|Create your account/)
   await page.keyboard.press('Escape')
   assert.equal(await generate.isDisabled(),true)
   await page.getByRole('button',{name:'Sign in / Create account',exact:true}).click()
   await page.getByLabel('Email',{exact:true}).fill('fixture@example.invalid')
   await page.getByLabel('Password',{exact:true}).fill('fixture-password-123')
   await page.locator('.customer-account-popover button[type=submit]').click()
   await page.waitForFunction(()=>document.querySelector('.review-create .customer-solid-button')?.disabled===false)
   assert.equal(await page.getByRole('button',{name:'Sign in / Create account',exact:true}).count(),0)
  }
  assert.equal(requests,race?1:0,'Never generate when known exhausted; exactly one mocked failed request in race')
  const flow=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('photobooth:active-customer-flow')))
  assert.equal(flow.uploadId,'saved-photo');assert.equal(flow.mode,mode);assert.equal(flow.stage,'review')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  assert.deepEqual(errors,[])
  await page.screenshot({path:output+'/'+width+'-'+mode+'-'+(member?'account':'guest')+'-'+(race?'race':'empty')+'.png',fullPage:true})
  console.log(JSON.stringify({width,mode,member,race,status:'PASS'}));cases++
  await context.close()
 }
 console.log(JSON.stringify({status:'PASS',cases,realGenerationRequests:0,output}))
}finally{await browser?.close();await server?.close()}

