// Isolated UI fixtures + Chromium fake camera. No production API or AI calls.
import { chromium } from '../../frontend-enhanced/node_modules/playwright/index.mjs'
import sharp from '../../backend-express/node_modules/sharp/lib/index.js'
import http from 'node:http'
import assert from 'node:assert/strict'
import { readFile,mkdir } from 'node:fs/promises'
import { resolve,extname } from 'node:path'

const root=resolve(process.env.NXDUET_TEST_DIST||resolve(import.meta.dirname,'../dist')),artifacts='/tmp/nxduet-browser-check'
await mkdir(artifacts,{recursive:true})
const server=http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://local').pathname;let file=resolve(root,'.'+path);if(!file.startsWith(root+'/'))throw new Error();let bytes;try{bytes=await readFile(file)}catch{file=resolve(root,'index.html');bytes=await readFile(file)}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(bytes)}catch{res.writeHead(404);res.end()}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`
const browser=await chromium.launch({executablePath:process.env.NXBOOTH_BROWSER_EXECUTABLE||'/home/mahez/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']})
const source=await sharp({create:{width:512,height:512,channels:3,background:'#456789'}}).png().toBuffer()
const poseFills=['#ef4050','#30c050','#4050ef'],overlays=await Promise.all(poseFills.map(fill=>sharp(Buffer.from(`<svg width="512" height="512"><rect x="100" y="80" width="310" height="430" rx="40" fill="${fill}"/></svg>`)).png().toBuffer()))
const POSES=[['smile','Tersenyum'],['angry','Marah'],['hug','Peluk'],['wave','Melambai']],posesFor=(keys,id,ready)=>keys.map((key,i)=>({slot:i+1,key,label:POSES.find(p=>p[0]===key)[1],image_url:ready?`/api/nxduet/templates/${id}/image?slot=${i+1}`:null}))
const strip=await sharp({create:{width:1200,height:3600,channels:3,background:'#181422'}}).png().toBuffer()
let saved=null,createCalls=0,prepareCalls=0,statusReads=0,composeCalls=0,credits=1000
const requestKeys=[],errors=[]
async function session(viewport,denyCamera=false){
  const context=await browser.newContext({viewport,permissions:['camera'],acceptDownloads:true})
  await context.addInitScript(()=>{localStorage.setItem('phbo-language','id');window.__duetTracks=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await original(constraints);window.__duetTracks.push(...stream.getTracks());return stream}})
  if(denyCamera)await context.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Synthetic denial','NotAllowedError')}})
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue()
    const path=url.pathname.slice(4),method=req.method(),json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
    if(path==='/nxduet/capabilities')return json({enabled:true,preparation_credits:100,pose_count:3,poses:POSES.map(([key,label])=>({key,label})),frame:{ready:true,slot_width:548,slot_height:466}})
    if(path==='/account/usage')return json({authenticated:true,ai_remaining:credits,subscription:{plan:{premium:true},ai:{remaining:credits},classic:{remaining:500}}})
    if(path==='/account/me')return json({authenticated:true,analytics_id:'phbo-account:'+'a'.repeat(32),email:'synthetic@example.invalid',display_name:'Synthetic test account',avatar_url:null,provider:'password',created_at:'2026-10-24T00:00:00Z'})
    if(path==='/uploads'&&method==='POST')return json({upload_id:'c'.repeat(32)},201)
    if(path==='/nxduet/templates'&&method==='GET')return json({templates:saved?[saved]:[],preparation_credits:100})
    if(path==='/nxduet/templates'&&method==='POST'){
      createCalls++;requestKeys.push(req.headers()['idempotency-key']);const body=req.postDataJSON();assert.equal(body.rights_accepted,true);assert.equal(body.upload_id,'c'.repeat(32));assert.deepEqual(body.poses,['smile','hug','wave'])
      if(!saved){prepareCalls++;credits-=100;saved={id:'d'.repeat(32),name:body.name,state:'QUEUED',enabled:true,placement:{side:'left',scale:.9},poses:posesFor(body.poses,'d'.repeat(32),false),credits:100,charge_status:'RESERVED',image_url:null};return route.abort('connectionfailed')}
      return json(saved,202)
    }
    if(saved&&path===`/nxduet/templates/${saved.id}`){
      if(method==='PATCH'){saved={...saved,...req.postDataJSON()};return json(saved)}
      if(saved.state!=='COMPLETED'){statusReads++;saved={...saved,state:statusReads>=2?'COMPLETED':'PROCESSING',charge_status:statusReads>=2?'CONSUMED':'RESERVED',image_url:statusReads>=2?`/api/nxduet/templates/${saved.id}/image?slot=1`:null,poses:posesFor(saved.poses.map(p=>p.key),saved.id,statusReads>=2)}}
      return json(saved)
    }
    if(saved&&path===`/nxduet/templates/${saved.id}/image`)return route.fulfill({contentType:'image/png',body:overlays[Math.min(2,Math.max(0,Number(url.searchParams.get('slot')||1)-1))]})
    if(saved&&path===`/nxduet/templates/${saved.id}/compose`){composeCalls++;const data=req.postDataBuffer().toString('latin1');assert.equal((data.match(/filename="capture-[123]\.jpg"/g)||[]).length,3);assert.equal((data.match(/Content-Type: image\/jpeg/g)||[]).length,3);return route.fulfill({contentType:'image/png',body:strip})}
    throw new Error('Unexpected fixture API: '+method+' '+path)
  })
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));return {context,page}
}
try{
  const {context,page}=await session({width:1440,height:1000})
  await page.goto(origin+'/nxduet');await page.getByRole('heading',{name:'Belum punya teman foto?'}).waitFor()
  await page.getByRole('button',{name:'Panduan NXDuet'}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Mengerti'}).click()
  await page.getByRole('button',{name:'Buat template baru · 100 kredit',exact:true}).click()
  await page.getByLabel('Nama template',{exact:true}).fill('Synthetic companion')
  const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:/Pilih atau tarik foto/}).click();await (await chooser).setFiles({name:'synthetic.png',mimeType:'image/png',buffer:source})
  await page.getByText('synthetic.png',{exact:true}).waitFor()
  const poseOptions=await page.getByRole('combobox',{name:'Pose foto 1',exact:true}).locator('option').allTextContents();assert.deepEqual(poseOptions,['Tersenyum','Marah','Peluk','Melambai'])
  assert.equal(await page.getByRole('combobox',{name:'Pose foto 2',exact:true}).locator('option',{hasText:'Tersenyum'}).evaluate(option=>option.disabled),true,'A pose cannot be chosen twice')
  await page.getByRole('combobox',{name:'Pose foto 2',exact:true}).selectOption('hug');await page.getByRole('combobox',{name:'Pose foto 3',exact:true}).selectOption('wave')
  await page.screenshot({path:artifacts+'/create-desktop.png'})
  assert.equal(await page.getByRole('button',{name:'Siapkan template · 100 kredit',exact:true}).isDisabled(),true)
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Siapkan template · 100 kredit',exact:true}).click()
  await page.getByRole('button',{name:'Periksa / lanjutkan permintaan',exact:true}).waitFor();await page.getByRole('button',{name:'Periksa / lanjutkan permintaan',exact:true}).click()
  await page.getByText('✓ Template tersimpan di akunmu',{exact:true}).waitFor();assert.equal(createCalls,2);assert.equal(prepareCalls,1);assert.equal(new Set(requestKeys).size,1);assert.equal(credits,900)
  await page.reload();await page.getByRole('heading',{name:'Synthetic companion',exact:true}).waitFor();await page.getByRole('button',{name:'Buka template',exact:true}).click();await page.getByRole('button',{name:'Mulai foto',exact:true}).click()
  await page.getByRole('button',{name:'Ambil foto 1',exact:true}).waitFor();await page.waitForFunction(()=>{const button=[...document.querySelectorAll('button')].find(v=>v.textContent==='Ambil foto 1');return button&&!button.disabled})
  await page.screenshot({path:artifacts+'/camera-desktop.png'})
  const dims=await page.locator('canvas').evaluate(canvas=>[canvas.width,canvas.height]);assert.deepEqual(dims,[1200,1020],'Preview follows the Classic slot aspect')
  const at=()=>page.locator('canvas').evaluate(canvas=>[...canvas.getContext('2d').getImageData(250,800,1,1).data])
  let pixel=await at();assert.ok(pixel[0]>180&&pixel[1]<120,'Pose 1 must be drawn on the left of the live preview')
  assert.deepEqual(await page.locator('canvas').evaluate(canvas=>[...canvas.getContext('2d').getImageData(1000,800,1,1).data].slice(0,3).every(v=>v<=255)),true)
  for(let i=1;i<=3;i++){await page.getByRole('button',{name:`Ambil foto ${i}`,exact:true}).click();await page.getByText(new RegExp(`^${i} dari 3 foto diambil`)).waitFor();if(i===1){await page.waitForTimeout(150);const next=await at();assert.ok(next[1]>150&&next[0]<120,'Shot 2 previews pose 2')}}
  assert.equal(await page.getByRole('slider',{name:'Ukuran teman foto',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('combobox',{name:'Sisi teman foto'}).count(),0,'Companion side is fixed to the left')
  await page.getByRole('button',{name:'Ulang foto terakhir',exact:true}).click();await page.getByText(/^2 dari 3 foto diambil/).waitFor();await page.getByRole('button',{name:'Ambil foto 3',exact:true}).click();await page.getByText(/^3 dari 3 foto diambil/).waitFor()
  await page.getByRole('button',{name:'Susun photo strip',exact:true}).click();await page.getByRole('heading',{name:'Momen kalian sudah siap.'}).waitFor();assert.equal(composeCalls,1);assert.equal(prepareCalls,1)
  const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Unduh photo strip'}).click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'nxduet-photo-strip.png');await download.saveAs(artifacts+'/synthetic-strip.png')
  assert.ok(await page.evaluate(()=>window.__duetTracks.every(track=>track.readyState==='ended')));await context.close()
  const mobile=await session({width:390,height:844});await mobile.page.goto(origin+'/nxduet');await mobile.page.getByRole('heading',{name:'Synthetic companion',exact:true}).waitFor();assert.ok(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(await mobile.page.evaluate(()=>document.querySelector('.duet-heading').getBoundingClientRect().top>=document.querySelector('.customer-nav').getBoundingClientRect().bottom),'Mobile content must not overlap navigation');await mobile.page.screenshot({path:artifacts+'/library-mobile.png'});await mobile.context.close()
  const denied=await session({width:390,height:844},true);await denied.page.goto(origin+'/nxduet');await denied.page.getByRole('button',{name:'Buka template',exact:true}).click();await denied.page.getByRole('button',{name:'Mulai foto',exact:true}).click();await denied.page.getByRole('alert').filter({hasText:'Akses kamera ditolak.'}).waitFor();assert.equal(await denied.page.getByRole('button',{name:'Ambil foto 1',exact:true}).isDisabled(),true);await denied.context.close()
  assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',coverage:'fixture API + fake camera; not real provider/physical camera',createCalls,prepareCalls,composeCalls,artifacts}))
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
