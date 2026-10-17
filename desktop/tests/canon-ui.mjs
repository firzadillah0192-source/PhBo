import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const dist=resolve('dist');
const server=createServer(async(req,res)=>{try{const path=resolve(dist,'.'+(req.url==='/'?'/index.html':req.url));if(!path.startsWith(dist+'/'))throw Error();res.setHeader('Content-Type',extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'text/html');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.PHBO_BROWSER||'/home/mahez/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  window.calls={open:0,frame:0,close:0,capture:0,webcam:0,disconnected:false,events:[]};
  const event=localStorage.getItem('event')==='1';
  const state={version:'1.1.0',cameraBackend:'canon-sdk',device:{simulated:false,camera:'CANON_SDK',printer:'PRINTER_NOT_CONNECTED'},catalogLoaded:true,configured:true,busy:false,session:null,catalog:{CLASSIC:[{id:'frame',name:'Frame',shots:2}],BASIC:[{id:'basic',name:'Basic Test'}],ADVANCED:[]},event:event?{active:true,name:'USB Event',date:'2026-10-17',templates:[{mode:'CLASSIC',id:'frame'}],timing:{countdown:1,retake:1,reset:15}}:null};
  const ok=data=>Promise.resolve({ok:true,data:structuredClone(data)}),bad=code=>Promise.resolve({ok:false,error:{code}});
  navigator.mediaDevices.getUserMedia=()=>{window.calls.webcam++;throw Error('Webcam must not be opened');};
  window.nxbooth={activityEvent:event=>{window.calls.events.push(event);return Promise.resolve({ok:true});},state:()=>ok(state),refresh:()=>ok(state),thumbnail:()=>ok(image),onChange:()=>()=>{},onUpdateProgress:()=>()=>{},
   start:mode=>{state.session={id:'session',phase:'CAPTURING',mode,shots:mode==='CLASSIC'?2:1,captures:[],prints:[]};return ok(state);},
   cameraOpen:()=>{window.calls.open++;return ok({source:'canon-sdk'});},cameraFrame:()=>{window.calls.frame++;return window.calls.disconnected?bad('CAMERA_DISCONNECTED'):ok({url:image});},cameraClose:()=>{window.calls.close++;return ok({closed:true});},
   capture:()=>{window.calls.capture++;const s=state.session;s.captures.push({id:String(window.calls.capture),url:image,source:'canon-sdk'});if(s.captures.length===s.shots)s.phase='REVIEWING';return ok(state);},captureWebcam:()=>{window.calls.webcam++;return bad('CAMERA_MODE_INVALID');},
   retake:()=>{state.session.captures.pop();state.session.phase='CAPTURING';return ok(state);},process:()=>{state.session.phase='RESULT_READY';state.session.result=image;return ok(state);},print:()=>bad('PRINTER_NOT_CONNECTED'),resultClaim:()=>ok({url:'https://example.com/r/test'}),eventReset:()=>{state.session=null;return ok(state);},finish:()=>{state.session=null;return ok(state);}};
 });
 await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('Canon USB · Canon terdeteksi').waitFor();
 await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();await page.getByRole('button',{name:'Basic',exact:false}).click();await page.getByRole('radio').click();await page.getByRole('button',{name:'Mulai sesi'}).click();
 await page.locator('.sdk-preview').waitFor();assert.equal(await page.locator('video').count(),0);
 await page.getByRole('button',{name:'Ambil foto',exact:true}).click();await page.getByRole('heading',{name:'Periksa foto kamu.'}).waitFor();
 await page.getByRole('button',{name:'Ulangi foto terakhir'}).click();await page.locator('.sdk-preview').waitFor();
 await page.evaluate(()=>{window.calls.disconnected=true;});await page.getByText(/Koneksi kamera terputus/).first().waitFor();assert.equal(await page.getByRole('button',{name:'Ambil foto',exact:true}).isDisabled(),true);
 let calls=await page.evaluate(()=>window.calls);assert.equal(calls.capture,1);assert.equal(calls.webcam,0);assert.ok(calls.open>=2);assert.ok(calls.close>=1);assert.ok(calls.events.some(e=>e.action==='camera.preview'&&e.code==='CAMERA_DISCONNECTED'));
 await page.evaluate(()=>{window.calls.disconnected=false;});await page.getByRole('button',{name:'Sambungkan ulang kamera'}).click();await page.getByRole('button',{name:'Ambil foto',exact:true}).waitFor();
 await page.getByRole('button',{name:'Ambil foto',exact:true}).click();await page.getByRole('heading',{name:'Periksa foto kamu.'}).waitFor();
 calls=await page.evaluate(()=>window.calls);assert.equal(calls.capture,2);assert.equal(calls.webcam,0);assert.ok(calls.open>=3);

 await page.evaluate(()=>localStorage.setItem('event','1'));await page.reload();await page.getByRole('button',{name:'Mulai',exact:true}).click();await page.getByRole('heading',{name:'Fotomu sudah jadi!'}).waitFor({timeout:20000});
 calls=await page.evaluate(()=>window.calls);assert.equal(calls.capture,2);assert.equal(calls.webcam,0);assert.ok(calls.frame>0);assert.deepEqual(errors,[]);
 console.log('PASS: SDK-only manual + event capture, preview, retake, disconnect disables shutter, no webcam fallback (mocked SDK IPC; no physical hardware).');
}finally{await browser.close();server.close();}
