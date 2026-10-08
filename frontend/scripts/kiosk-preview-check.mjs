import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.KIOSK_BASE || 'http://127.0.0.1:5197'
const output = process.env.KIOSK_OUTPUT || '/srv/photobooth/cache/kiosk-preview-check'
await mkdir(output,{recursive:true})
const browser = await chromium.launch({...(process.env.PLAYWRIGHT_CHROMIUM ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM}:{}),args:['--no-sandbox']})
const errors=[], checks=[]
const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
try {
 for(const width of [1440,1024,390,320]) {
  const context=await browser.newContext({viewport:{width,height:1000}}), page=await context.newPage(),requests=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push(r.url())})
  await page.goto(base+'/kiosk',{waitUntil:'networkidle'})
  await page.getByRole('heading',{name:/A little pose/}).waitFor()
  assert.equal(await page.getByRole('button',{pressed:true}).count(),1)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1),true)
  await page.screenshot({path:`${output}/${width}-choose.png`,fullPage:true})
  await page.getByRole('button',{name:'Operator',exact:false}).click();await page.getByRole('dialog',{name:'Panel operator preview'}).waitFor();await page.getByRole('button',{name:'Tutup panel operator'}).click()
  await page.getByRole('button',{name:/Basic Your photo/}).click();await page.getByRole('button',{name:'Mulai Basic'}).click()
  await page.getByRole('heading',{name:'Ready for your close-up?'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Review foto →'}).isDisabled(),true)
  await page.getByLabel('Pilih foto preview').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('not an image')})
  await page.getByRole('alert').filter({hasText:'Foto tidak dapat dibaca'}).waitFor()
  await page.getByLabel('Pilih foto preview').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:photo})
  await page.getByRole('button',{name:'Review foto →'}).click();await page.getByRole('heading',{name:'Looking good.'}).waitFor()
  await page.waitForFunction(()=>document.querySelector('.kv-review-grid img')?.naturalWidth>0)
  assert.equal(await page.getByRole('button',{name:'Proses foto',exact:true}).isDisabled(),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1),true)
  await page.screenshot({path:`${output}/${width}-review.png`,fullPage:true})
  await page.getByRole('button',{name:'Ganti foto 1'}).click();await page.getByRole('heading',{name:'Ready for your close-up?'}).waitFor()
  assert.equal(await page.locator('.kv-photo-slots img').count(),0)
  await page.getByRole('button',{name:'Ganti mode',exact:false}).click();await page.getByRole('button',{name:/Classic Pose/}).click();await page.getByRole('button',{name:'Mulai Classic'}).click()
  await page.getByLabel('Pilih foto preview').setInputFiles([0,1,2].map(i=>({name:`pose-${i}.png`,mimeType:'image/png',buffer:photo})))
  await page.getByRole('button',{name:'Review foto →'}).click();assert.equal(await page.locator('.kv-review-grid img').count(),3)
  await page.getByRole('button',{name:'Sesi baru',exact:true}).click();await page.getByRole('heading',{name:/A little pose/}).waitFor()
  assert.deepEqual(requests,[],'Preview must not create sessions/uploads/generations or call account APIs')
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('blob:')),false)
  checks.push({width,status:'PASS',checks:'Mode selection, invalid photo, capture/review, retake, Classic 3 poses, reset, no API calls, no overflow'})
  await context.close()
 }
 assert.deepEqual(errors,[])
 await writeFile(output+'/report.json',JSON.stringify({base,checks,errors,status:'PASS'},null,2));console.log(JSON.stringify({base,status:'PASS',viewports:checks.length,errors}))
}finally{await browser.close()}
