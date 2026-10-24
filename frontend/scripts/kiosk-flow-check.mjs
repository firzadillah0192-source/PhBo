import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {readFile} from 'node:fs/promises'
const personalized=process.env.KIOSK_PERSONALIZED==='1'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const base=process.env.KIOSK_BASE||'http://127.0.0.1:5198',output=process.env.KIOSK_OUTPUT||'/srv/photobooth/cache/kiosk-flow-check';await mkdir(output,{recursive:true})
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}),errors=[]
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:1000}});let allowed=false,failed=false,submitFails=false,revoked=false,polls=0,posts=0,uploads=0,claims=0,claimFail=false;const payloads=[],claimPayloads=[]
  await context.addInitScript(()=>{window.google={accounts:{id:{initialize(o){window.googleCallback=o.callback},renderButton(el){const b=document.createElement('button');b.textContent='Sign in with Google';b.onclick=()=>window.googleCallback({credential:'synthetic-verified-google'});el.append(b)},disableAutoSelect(){}}}}})
  await context.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;let status=200,body={};
   if(path==='/api/kiosk/login/google'){if(req.postDataJSON().id_token!=='synthetic-verified-google'){status=403;body={detail:{error_code:'KIOSK_FORBIDDEN'}}}else{allowed=true;body={allowed:true}}}
   else if(path==='/api/kiosk/logout'){allowed=false;body={authenticated:false}}
   else if(path==='/api/account/login'){allowed=false;body={authenticated:true}}
   else if(path==='/api/kiosk/access'){status=allowed?200:401;body=allowed?{allowed:true}:{detail:{error_code:'AUTHENTICATION_REQUIRED'}}}
   else if(!allowed){status=403;body={detail:{error_code:'KIOSK_FORBIDDEN'}}}
   else if(path.endsWith('/templates'))body={templates:[{id:'template-1',name:'Space Commander',basic_available:true}]}
   else if(path.endsWith('/classic/layouts'))body=[personalized?{id:'frame-1',name:'Three poses',shot_count:3,requires_event_name:true,preview_url:base+'/fixture-frame.png'}:{id:'frame-1',name:'Two poses',shot_count:2}]
   else if(path.endsWith('/experiences'))body={experiences:[{id:'exp-1',name:'World One'}]}
   else if(path.endsWith('/advanced/frame-styles'))body=[{id:'natural',name:'Natural'}]
   else if(path.endsWith('/account/usage'))body={ai_remaining:100}
   else if(path.endsWith('/kiosk/session'))body={}
   else if(path.endsWith('/uploads')){const bytes=req.postDataBuffer();assert.ok(bytes.includes(Buffer.from('image/jpeg')));assert.ok(bytes.includes(Buffer.from([0xff,0xd8,0xff])));uploads++;body={upload_id:'upload-'+uploads}}
   else if(path.endsWith('/generations')){posts++;if(submitFails){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:{error_code:'SERVICE_UNAVAILABLE'}})});return}polls=0;payloads.push(req.postDataJSON());assert.ok(req.headers()['idempotency-key']);body={job_id:'job-1',state:'QUEUED'}}
   else if(path.endsWith('/generations/job-1')){polls++;if(revoked){allowed=false;status=401;body={detail:{error_code:'AUTHENTICATION_REQUIRED'}}}else body={job_id:'job-1',state:failed?'FAILED':polls>1?'COMPLETED':'PROCESSING',result_id:failed?null:polls>1?'result-1':null}}
   else if(path.endsWith('/results/result-1/claim')){claims++;claimPayloads.push(req.postDataJSON());assert.equal(req.postDataJSON().kiosk,true);if(claimFail){status=503;body={detail:{error_code:'SERVICE_UNAVAILABLE'}}}else{const url=base+'/r/'+('q'.repeat(43));body={claim_url:url,qr_payload:url,expires_at:new Date(await req.frame().evaluate(()=>Date.now())+86400000).toISOString()}}}
   else if(path.endsWith('/results/result-1'))body={result_id:'result-1'}
   else if(path.endsWith('/results/result-1/image')){await route.fulfill({status:200,contentType:'image/png',body:png});return}
   else{status=404;body={}}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
  })
  if(personalized)await context.route('**/fixture-frame.png',async route=>route.fulfill({contentType:'image/png',body:await readFile('../backend/app/data/classic-personalized-v3/classic-wedding-jawa-001/preview.png')}))
  const page=await context.newPage();await page.clock.install();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/kiosk',{waitUntil:'networkidle'})
  await page.getByRole('button',{name:'Ganti akun / keluar'}).waitFor();assert.equal(await page.locator('.kv-mode-grid').count(),0)
  await page.evaluate(()=>window.googleCallback({credential:'synthetic-denied-google-token'}));await page.getByRole('alert').waitFor()
  await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();await page.getByRole('heading',{name:/A little pose/}).waitFor()
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.kv-app')).backgroundColor),'rgb(255, 244, 221)')
  await page.screenshot({path:`${output}/${width}-retro-home.png`,fullPage:true})
  for(const mode of ['Basic','Classic','Advanced']){
   const beforePosts=posts,beforeUploads=uploads,beforeClaims=claims;claimFail=mode==='Advanced';await page.getByRole('button',{name:new RegExp('^'+mode+' ')}).click();await page.getByRole('dialog',{name:'Which world is yours?'}).waitFor();assert.equal(context.pages().length,1);assert.equal(new URL(page.url()).pathname,'/kiosk')
   if(mode==='Basic')await page.screenshot({path:`${output}/${width}-design-modal.png`,fullPage:true})
   await page.getByRole('button',{name:mode==='Basic'?'Space Commander 1 pose':mode==='Classic'?(personalized?'Three poses 3 pose':'Two poses 2 pose'):'World One 1 pose'}).click()
   if(mode==='Classic'&&personalized){
    await page.getByRole('heading',{name:'Nama event kamu.'}).waitFor();assert.equal(await page.locator('video').count(),0)
    const start=page.getByRole('button',{name:'Mulai foto →',exact:true});assert.equal(await start.isDisabled(),true)
    await page.getByLabel('Nama event').fill('Pernikahan Sarah & Arif');await page.waitForFunction(()=>document.querySelector('.kv-event-details img')?.naturalWidth===1200)
    const frame=await page.locator('.kv-event-details img').evaluate(img=>({fit:getComputedStyle(img).objectFit,height:img.naturalHeight,width:img.naturalWidth}));assert.deepEqual(frame,{fit:'contain',height:3600,width:1200})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:`${output}/${width}-event-details.png`,fullPage:true});await start.click()
   }
   const count=mode==='Classic'?(personalized?3:2):1;assert.equal(await page.locator('input[type=file]').count(),0);assert.equal(await page.getByRole('button',{name:/Ambil foto|Review foto|Proses foto/}).count(),0)
   for(let i=0;i<count;i++){
    await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0&&document.querySelector('.kv-capture-countdown'))
    const preview=await page.evaluate(()=>{const v=document.querySelector('video'),style=getComputedStyle(v),box=v.getBoundingClientRect(),parent=v.parentElement.getBoundingClientRect();return{fit:style.objectFit,transform:style.transform,resizeMode:v.srcObject.getVideoTracks()[0].getSettings().resizeMode,inside:box.left>=parent.left-1&&box.right<=parent.right+1&&box.top>=parent.top-1&&box.bottom<=parent.bottom+1}})
    assert.equal(preview.fit,'contain');assert.equal(preview.transform,'none');assert.equal(preview.resizeMode,'none');assert.equal(preview.inside,true)
    if(i===0&&mode==='Classic')await page.screenshot({path:`${output}/${width}-live-preview.png`,fullPage:true})
    await page.evaluate(()=>window.testCameraTrack=document.querySelector('video').srcObject.getVideoTracks()[0])
    await page.clock.fastForward(5000)
    await page.getByRole('dialog',{name:'How does it look?'}).waitFor()
    await page.waitForFunction(()=>document.querySelector('.kv-pose-review-body img')?.naturalWidth>0)
    assert.equal(await page.evaluate(()=>window.testCameraTrack.readyState),'ended')
    await page.getByRole('button',{name:'Retake (3)',exact:true}).waitFor()
    if(mode==='Basic'){
     for(let remaining=2;remaining>=0;remaining--){
      await page.getByRole('button',{name:`Retake (${remaining+1})`,exact:true}).click()
      await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0&&document.querySelector('.kv-capture-countdown'))
      await page.clock.fastForward(5000);await page.getByRole('dialog',{name:'How does it look?'}).waitFor();await page.getByRole('button',{name:`Retake (${remaining})`,exact:true}).waitFor()
     }
     assert.equal(await page.getByRole('button',{name:'Retake (0)',exact:true}).isDisabled(),true)
     await page.screenshot({path:`${output}/${width}-pose-review.png`,fullPage:true})
     await page.getByRole('button',{name:/^Next /}).click()
    }else await page.clock.fastForward(10000)
   }
   await page.getByRole('heading',{name:/Your moment/}).waitFor({timeout:15000})
   await page.waitForFunction(()=>document.querySelector('.kv-result-body img')?.naturalWidth>0)
   if(claimFail){await page.getByText('QR belum dapat dibuat. Periksa koneksi dan coba lagi.',{exact:true}).waitFor();assert.equal(await page.locator('.kv-result-qr svg').count(),0);claimFail=false;await page.getByRole('button',{name:'Coba QR lagi',exact:true}).click()}
   await page.getByRole('img',{name:'QR hasil foto',exact:true}).waitFor()
   const claimUrl=await page.getByRole('link',{name:'Buka link foto ↗'}).getAttribute('href');assert.equal(claimUrl,base+'/r/'+('q'.repeat(43)));assert.equal(claims-beforeClaims,mode==='Advanced'?2:1)
   await page.locator('.kv-result-qr svg').screenshot({path:`${output}/${width}-${mode}-qr.png`})
   if(mode==='Classic'){
    const phone=await browser.newContext({viewport:{width:390,height:844}})
    await phone.route('**/api/public/results/**',async route=>{assert.equal(route.request().headers().cookie,undefined);await route.fulfill({status:200,contentType:'image/png',body:png})})
    const phonePage=await phone.newPage();await phonePage.goto(claimUrl,{waitUntil:'networkidle'});await phonePage.waitForFunction(()=>document.querySelector('main img')?.naturalWidth>0);assert.equal(await phonePage.locator('.kv-login-window').count(),0);await phone.close()
   }
   if(mode==='Classic'){
    const beforeReloadPosts=posts;await page.reload();await page.getByRole('button',{name:'Lanjutkan ke kiosk'}).click();await page.getByRole('img',{name:'QR hasil foto',exact:true}).waitFor();assert.equal(posts,beforeReloadPosts);assert.equal(claimPayloads.at(-1).reuse_token,'q'.repeat(43));assert.equal(claimPayloads.at(-1).refresh,false)
   }
   if(mode==='Advanced'){
    await page.clock.fastForward(86400000);await page.getByText('Link QR sudah kedaluwarsa.',{exact:true}).waitFor();assert.equal(await page.locator('.kv-result-qr svg').count(),0);await page.getByRole('button',{name:'Buat QR baru',exact:true}).click();await page.getByRole('img',{name:'QR hasil foto',exact:true}).waitFor();assert.equal(claimPayloads.at(-1).refresh,true)
   }
   assert.equal(posts-beforePosts,1);assert.equal(uploads-beforeUploads,count);assert.equal(payloads.at(-1).mode,mode.toUpperCase());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
   if(mode==='Classic'){assert.equal(payloads.at(-1).capture_upload_ids.length,count);if(personalized){assert.equal(payloads.at(-1).event_name,'Pernikahan Sarah & Arif');assert.ok(Number.isFinite(Date.parse(payloads.at(-1).captured_at)))}}
   await page.screenshot({path:`${output}/${width}-${mode}-result.png`,fullPage:true});await page.getByRole('button',{name:'Sesi baru',exact:true}).click()
  }
  submitFails=true;await page.getByRole('button',{name:/^Basic /}).click();await page.getByRole('button',{name:'Space Commander 1 pose'}).click();await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0&&document.querySelector('.kv-capture-countdown'));await page.clock.fastForward(5000);await page.getByRole('dialog',{name:'How does it look?'}).waitFor();await page.clock.fastForward(10000);await page.getByRole('heading',{name:'Foto belum dapat diproses.'}).waitFor();const rejectedPosts=posts;await page.clock.fastForward(30000);assert.equal(posts,rejectedPosts,'Submission failure must not auto-loop generation requests');await page.getByRole('button',{name:'Sesi baru',exact:true}).click();submitFails=false;
  failed=true;await page.getByRole('button',{name:/^Basic /}).click();await page.getByRole('button',{name:'Space Commander 1 pose'}).click();await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0&&document.querySelector('.kv-capture-countdown'));await page.clock.fastForward(5000);await page.getByRole('dialog',{name:'How does it look?'}).waitFor();await page.getByRole('button',{name:/^Next /}).dblclick();await page.getByRole('heading',{name:'Proses terhenti.'}).waitFor();assert.equal(await page.locator('.kv-result-body').count(),0)
  const before=posts;await page.reload();await page.getByRole('button',{name:'Lanjutkan ke kiosk'}).click();await page.getByRole('heading',{name:'Proses terhenti.'}).waitFor();assert.equal(posts,before,'Reload resumes job without new generation')
  revoked=true;await page.getByRole('button',{name:'Periksa status lagi'}).click();await page.getByRole('button',{name:'Ganti akun / keluar'}).waitFor();assert.equal(await page.locator('.kv-mode-grid').count(),0)
  revoked=false;await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();await page.getByRole('heading',{name:'Proses terhenti.'}).waitFor();await page.getByRole('button',{name:'Sesi baru',exact:true}).click();await page.getByRole('heading',{name:/A little pose/}).waitFor();await page.getByRole('button',{name:'Operator',exact:true}).click();await page.getByRole('button',{name:'Logout operator'}).click();await page.getByRole('button',{name:'Ganti akun / keluar'}).waitFor();
  await page.goto(base+'/kiosk/create?mode=basic',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Ganti akun / keluar'}).waitFor();assert.equal(await page.locator('.kv-mode-grid').count(),0);
  console.log('PASS viewport',width,'login/Google fixture, modal, 3 modes, processing/result, failed, reload, revocation, automatic 5s capture / 10s next, per-pose retake limit, QR claim/retry, phone without operator login, duplicate guard');await context.close()
 }
 assert.deepEqual(errors,[]);await writeFile(output+'/report.json',JSON.stringify({base,status:'PASS',viewports:3,errors,backend:'intercepted HTTP fixture; not real AI'},null,2))
}finally{await browser.close()}
