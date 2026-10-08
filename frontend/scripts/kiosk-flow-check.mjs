import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright')
const base=process.env.KIOSK_BASE||'http://127.0.0.1:5198',output=process.env.KIOSK_OUTPUT||'/srv/photobooth/cache/kiosk-flow-check';await mkdir(output,{recursive:true})
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']}),errors=[]
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:1000}});let allowed=false,failed=false,revoked=false,polls=0,posts=0,uploads=0;const payloads=[]
  await context.addInitScript(()=>{window.google={accounts:{id:{initialize(o){window.googleCallback=o.callback},renderButton(el){const b=document.createElement('button');b.textContent='Sign in with Google';b.onclick=()=>window.googleCallback({credential:'synthetic-verified-google'});el.append(b)},disableAutoSelect(){}}}}})
  await context.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;let status=200,body={};
   if(path==='/api/kiosk/login/google'){if(req.postDataJSON().id_token!=='synthetic-verified-google'){status=403;body={detail:{error_code:'KIOSK_FORBIDDEN'}}}else{allowed=true;body={allowed:true}}}
   else if(path==='/api/kiosk/logout'){allowed=false;body={authenticated:false}}
   else if(path==='/api/account/login'){allowed=false;body={authenticated:true}}
   else if(path==='/api/kiosk/access'){status=allowed?200:401;body=allowed?{allowed:true}:{detail:{error_code:'AUTHENTICATION_REQUIRED'}}}
   else if(!allowed){status=403;body={detail:{error_code:'KIOSK_FORBIDDEN'}}}
   else if(path.endsWith('/templates'))body={templates:[{id:'template-1',name:'Space Commander',basic_available:true}]}
   else if(path.endsWith('/classic/layouts'))body=[{id:'frame-1',name:'Two poses',shot_count:2}]
   else if(path.endsWith('/experiences'))body={experiences:[{id:'exp-1',name:'World One'}]}
   else if(path.endsWith('/advanced/frame-styles'))body=[{id:'natural',name:'Natural'}]
   else if(path.endsWith('/account/usage'))body={ai_remaining:100}
   else if(path.endsWith('/kiosk/session'))body={}
   else if(path.endsWith('/uploads')){const bytes=req.postDataBuffer();assert.ok(bytes.includes(Buffer.from('image/jpeg')));assert.ok(bytes.includes(Buffer.from([0xff,0xd8,0xff])));uploads++;body={upload_id:'upload-'+uploads}}
   else if(path.endsWith('/generations')){posts++;polls=0;payloads.push(req.postDataJSON());assert.ok(req.headers()['idempotency-key']);body={job_id:'job-1',state:'QUEUED'}}
   else if(path.endsWith('/generations/job-1')){polls++;if(revoked){allowed=false;status=401;body={detail:{error_code:'AUTHENTICATION_REQUIRED'}}}else body={job_id:'job-1',state:failed?'FAILED':polls>1?'COMPLETED':'PROCESSING',result_id:failed?null:polls>1?'result-1':null}}
   else if(path.endsWith('/results/result-1'))body={result_id:'result-1'}
   else if(path.endsWith('/results/result-1/image')){await route.fulfill({status:200,contentType:'image/png',body:png});return}
   else{status=404;body={}}
   await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)})
  })
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/kiosk',{waitUntil:'networkidle'})
  await page.getByRole('button',{name:'Ganti akun / keluar'}).waitFor();assert.equal(await page.locator('.kv-mode-grid').count(),0)
  await page.evaluate(()=>window.googleCallback({credential:'synthetic-denied-google-token'}));await page.getByRole('alert').waitFor()
  await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();await page.getByRole('heading',{name:/A little pose/}).waitFor()
  assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.kv-app')).backgroundColor),'rgb(255, 244, 221)')
  await page.screenshot({path:`${output}/${width}-retro-home.png`,fullPage:true})
  for(const mode of ['Basic','Classic','Advanced']){
   const beforePosts=posts,beforeUploads=uploads;await page.getByRole('button',{name:new RegExp('^'+mode+' ')}).click();await page.getByRole('dialog',{name:'Which world is yours?'}).waitFor();assert.equal(context.pages().length,1);assert.equal(new URL(page.url()).pathname,'/kiosk')
   if(mode==='Basic')await page.screenshot({path:`${output}/${width}-design-modal.png`,fullPage:true})
   await page.getByRole('button',{name:mode==='Basic'?'Space Commander 1 pose':mode==='Classic'?'Two poses 2 pose':'World One 1 pose'}).click()
   const count=mode==='Classic'?2:1;assert.equal(await page.locator('input[type=file]').count(),0);await page.waitForFunction(()=>document.querySelector('video')?.videoWidth>0);for(let i=0;i<count;i++){await page.getByRole('button',{name:'Ambil foto ●'}).click();await page.getByText(`${i+1} dari ${count} foto`,{exact:true}).waitFor()}await page.waitForFunction(()=>Array.from(document.querySelectorAll('.kv-photo-slots img')).every(img=>img.naturalWidth>0))
   await page.evaluate(()=>window.testCameraTrack=document.querySelector('video').srcObject.getVideoTracks()[0]);await page.getByRole('button',{name:'Review foto →'}).click();assert.equal(await page.evaluate(()=>window.testCameraTrack.readyState),'ended');await page.getByRole('button',{name:'Proses foto →'}).dblclick();await page.getByRole('heading',{name:/Your moment/}).waitFor({timeout:15000})
   await page.waitForFunction(()=>document.querySelector('.kv-result-body img')?.naturalWidth>0)
   assert.equal(posts-beforePosts,1);assert.equal(uploads-beforeUploads,count);assert.equal(payloads.at(-1).mode,mode.toUpperCase());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
   if(mode==='Classic')assert.equal(payloads.at(-1).capture_upload_ids.length,2)
   await page.screenshot({path:`${output}/${width}-${mode}-result.png`,fullPage:true});await page.getByRole('button',{name:'Sesi baru',exact:true}).click()
  }
  failed=true;await page.getByRole('button',{name:/^Basic /}).click();await page.getByRole('button',{name:'Space Commander 1 pose'}).click();await page.getByRole('button',{name:'Ambil foto ●'}).click();await page.getByText('1 dari 1 foto',{exact:true}).waitFor();await page.getByRole('button',{name:'Review foto →'}).click();await page.getByRole('button',{name:'Proses foto →'}).click();await page.getByRole('heading',{name:'Proses terhenti.'}).waitFor();assert.equal(await page.locator('.kv-result-body').count(),0)
  const before=posts;await page.reload();await page.getByRole('button',{name:'Lanjutkan ke kiosk'}).click();await page.getByRole('heading',{name:'Proses terhenti.'}).waitFor();assert.equal(posts,before,'Reload resumes job without new generation')
  revoked=true;await page.getByRole('button',{name:'Periksa status lagi'}).click();await page.getByRole('button',{name:'Ganti akun / keluar'}).waitFor();assert.equal(await page.locator('.kv-mode-grid').count(),0)
  revoked=false;await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();await page.getByRole('heading',{name:'Proses terhenti.'}).waitFor();await page.getByRole('button',{name:'Sesi baru',exact:true}).click();await page.getByRole('heading',{name:/A little pose/}).waitFor();await page.getByRole('button',{name:'Operator',exact:true}).click();await page.getByRole('button',{name:'Logout operator'}).click();await page.getByRole('button',{name:'Ganti akun / keluar'}).waitFor();
  await page.goto(base+'/kiosk/create?mode=basic',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Ganti akun / keluar'}).waitFor();assert.equal(await page.locator('.kv-mode-grid').count(),0);
  console.log('PASS viewport',width,'login/Google fixture, modal, 3 modes, processing/result, failed, reload, revocation, duplicate guard');await context.close()
 }
 assert.deepEqual(errors,[]);await writeFile(output+'/report.json',JSON.stringify({base,status:'PASS',viewports:3,errors,backend:'intercepted HTTP fixture; not real AI'},null,2))
}finally{await browser.close()}
