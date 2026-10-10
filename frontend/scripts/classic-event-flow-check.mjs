// Exercise the actual App callback, not a hand-written generation callback.
import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {chromium} from '/srv/photobooth/tmp/frame-preview-browser/node_modules/playwright-core/index.mjs'
const base=process.env.CLASSIC_FLOW_BASE||'http://127.0.0.1:5198'
const output='/srv/photobooth/tmp/classic-event-flow-browser';await mkdir(output,{recursive:true})
const layouts=await (await fetch('http://127.0.0.1:3000/api/classic/layouts')).json()
const image=await readFile('../backend/app/data/classic-personalized-v3/classic-frame-001/preview.png')
const browser=await chromium.launch({executablePath:'/home/mahez/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']})
const checks=[]
try{
 for(const [width,id,camera] of [[1440,'classic-floral-event-001',false],[390,'classic-wedding-jawa-001',true],[320,'classic-birthday-001',false]]){
  const context=await browser.newContext({viewport:{width,height:width<500?844:1000}});let uploads=0,posted=null;const errors=[]
  await context.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;let body={},status=200
   if(path==='/api/classic/layouts')body=layouts.filter(row=>row.id===id)
   else if(path==='/api/templates')body={templates:[]}
   else if(path==='/api/experiences')body={experiences:[]}
   else if(path==='/api/advanced/frame-styles'||path==='/api/advanced/ornaments')body=[]
   else if(path==='/api/account/usage')body={ai_remaining:50,authenticated:false}
   else if(path==='/api/account/me'){status=401;body={detail:{error_code:'AUTHENTICATION_REQUIRED'}}}
   else if(path==='/api/uploads'){uploads++;body={upload_id:'capture-'+uploads,preview_url:'/api/uploads/fixture/preview'}}
   else if(path==='/api/generations'){
    posted=route.request().postDataJSON();assert.equal(posted.event_name,'Pernikahan Sarah & Arif');assert.equal(posted.layout_id,id);assert.equal(posted.mode,'CLASSIC');assert.deepEqual(posted.capture_upload_ids,['capture-1','capture-2','capture-3']);assert.ok(Number.isFinite(Date.parse(posted.captured_at)));assert.ok(route.request().headers()['idempotency-key']);status=202;body={job_id:'fixture-job',state:'QUEUED',mode:'CLASSIC'}
   }else if(path==='/api/generations/fixture-job')body={job_id:'fixture-job',state:'QUEUED',mode:'CLASSIC'}
   else if(path.endsWith('/preview')){await route.fulfill({contentType:'image/png',body:image});return}
   else if(path.startsWith('/api/uploads/'))body={upload_id:path.split('/')[3],preview_url:'/api/uploads/fixture/preview'}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
  })
  const page=await context.newPage();if(camera)await page.clock.install();page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+'/create?mode=classic');await page.locator('.studio-picker-card').first().click()
  const next=page.getByRole('button',{name:'Lanjut ambil foto →'});await next.waitFor();assert.equal(await next.isDisabled(),true);assert.equal(await page.locator('video,.camera-stage,input[type=file]').count(),0)
  await page.getByLabel('Nama event',{exact:true}).fill('Pernikahan Sarah & Arif');await page.reload();await page.getByLabel('Nama event',{exact:true}).waitFor();assert.equal(await page.getByLabel('Nama event',{exact:true}).inputValue(),'Pernikahan Sarah & Arif');assert.equal(await next.isDisabled(),false)
  assert.equal(await next.evaluate(button=>button.getBoundingClientRect().bottom<=innerHeight),true);await page.screenshot({path:output+'/'+width+'-event.png',fullPage:true});await next.click();assert.equal(await page.locator('.classic-selected-frame,#classic-event-name').count(),0);assert.equal(await page.evaluate(()=>scrollY),0)
  await page.getByRole('button',{name:'Ubah nama event'}).click();await page.getByLabel('Nama event',{exact:true}).waitFor();await next.click()
  if(camera){
   await page.getByRole('button',{name:'Open camera',exact:true}).click();await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0)
   await page.getByRole('button',{name:'Start photo 1 countdown',exact:true}).click()
   for(let pose=1;pose<=3;pose++){
    await page.clock.runFor(3500);await page.getByRole('heading',{name:`Photo ${pose} of 3`,exact:true}).waitFor()
    await page.getByRole('button',{name:pose===3?/Next · Create photo strip/:/Next photo/}).click()
    if(pose<3)await page.clock.runFor(800)
   }
  }else await page.locator('input[type=file]').setInputFiles([1,2,3].map(n=>({name:'synthetic-'+n+'.png',mimeType:'image/png',buffer:image})))
  await page.waitForURL('**/generate/fixture-job');assert.equal(uploads,3);assert.ok(posted);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  checks.push({width,id,camera,requiredName:true,persistedName:true,stepTransition:true,requestMetadata:true,uploads:3,backend:'HTTP fixtures; no production writes'});await context.close()
 }
 await writeFile(output+'/report.json',JSON.stringify({status:'PASS',checks},null,2));console.log(JSON.stringify({status:'PASS',checks}))
}finally{await browser.close()}
