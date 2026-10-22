import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const claimToken='c'.repeat(40);const log=[];let origin='';
const server=createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
 log.push({method:req.method,url:req.url,cookie:req.headers.cookie,body:body.length});
 const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data}));};
 if(req.url==='/api/v1/frames')return json([{id:'frame-1',name:'Frame Uji',shot_count:2,requires_event_name:true}]);
 if(req.url==='/api/v1/templates')return json([{id:'tpl-1',name:'Tema Uji'}]);
 if(req.url==='/api/v1/experiences')return json([]);
 if(req.url==='/api/v1/kiosk/sessions')return json({code:'CODE123',uploadPath:'/api/v1/kiosk/session/CODE123/upload'});
 if(req.url.endsWith('/upload'))return json({photos:[{id:'a'.repeat(32)},{id:'b'.repeat(32)}]});
 if(req.url.endsWith('/claim')&&req.url.includes('photo-sessions')){res.setHeader('Set-Cookie','photo_session='+'a'.repeat(43)+'; HttpOnly; Path=/api/v1');return json({claimed:true});}
 if(req.url==='/api/v1/generations')return json({id:'job-1',status:'QUEUED'});
 if(req.url==='/api/v1/generations/job-1')return json({id:'job-1',status:'COMPLETED',resultId:'result-1'});
 if(req.url==='/api/v1/results/result-1/url')return json({url:origin+'/api/v1/results/result-1/image'});
 if(req.url==='/api/v1/results/result-1/claim')return json({claim_url:origin+'/r/'+claimToken,qr_payload:origin+'/r/'+claimToken,expires_at:new Date(Date.now()+864e5).toISOString()});
 if(req.url==='/api/v1/results/result-1/image'){res.setHeader('Content-Type','image/png');return res.end(png);}
 res.statusCode=404;res.end();
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
const root=await mkdtemp('/srv/photobooth/tmp/event-ui-');let app;
try{
 app=await electron.launch({timeout:30000,args:[resolve('electron/main.mjs'),'--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],
  env:{...process.env,PHBO_DESKTOP_TEST:'1',PHBO_DEVICE_MODE:'hardware',PHBO_TEST_DATA:root,PHBO_KIOSK_API_KEY:'k'.repeat(32),PHBO_TEST_ORIGINS:JSON.stringify({control:origin,media:origin,storage:origin,web:origin}),PHBO_TEST_EVENT_TIMING:JSON.stringify({countdown:1,retake:1,reset:8})}});
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('heading',{name:'Cek perangkat'}).waitFor();
 // Staff sets the event up through the real IPC (operator-only), one template.
 assert.equal((await page.evaluate(()=>window.nxbooth.eventSave({name:'X',date:'2026-10-24',templates:[{mode:'CLASSIC',id:'frame-1'}],active:true}))).error.code,'OPERATOR_REQUIRED');
 assert.equal((await page.evaluate(()=>window.nxbooth.openStaff())).ok,true);
 const bad=await page.evaluate(()=>window.nxbooth.eventSave({name:'X',date:'2026-02-31',templates:[{mode:'CLASSIC',id:'frame-1'}],active:true}));assert.equal(bad.ok,false);
 assert.equal((await page.evaluate(()=>window.nxbooth.eventSave({name:'X',date:'2026-10-24',templates:[{mode:'CLASSIC',id:'nope'}],active:true}))).error.code,'EVENT_TEMPLATE_UNKNOWN');
 // Configure the real staff form, including catalog checkbox selection.
 await page.getByRole('button',{name:'Menu staf',exact:true}).click();
 await page.getByRole('button',{name:'Buka menu staf',exact:true}).click();
 const form=page.getByRole('form',{name:'Pengaturan mode event'});
 await form.getByLabel('Nama event',{exact:true}).fill('Pernikahan Sarah & Arif');
 await form.getByLabel('Tanggal event').fill('2026-10-24');
 await form.getByRole('checkbox',{name:/Frame Uji/}).check();
 await form.getByRole('checkbox',{name:/Tema Uji/}).check();
 await form.getByRole('checkbox',{name:/Tema Uji/}).uncheck();
 await form.getByRole('checkbox',{name:'Aktifkan mode event di kiosk ini'}).check();
 await form.getByRole('button',{name:'Simpan mode event'}).click();
 await page.waitForFunction(async()=>(await window.nxbooth.state()).data.event?.active===true);
 const configured=(await page.evaluate(()=>window.nxbooth.state())).data.event;
 assert.equal(configured.name,'Pernikahan Sarah & Arif');assert.deepEqual(configured.templates,[{mode:'CLASSIC',id:'frame-1'}]);
 await page.reload();
 await page.getByRole('heading',{name:'Pernikahan Sarah & Arif'}).waitFor();
 await page.getByText(/24 Oktober 2026/).first().waitFor();
 assert.equal(await page.getByRole('button',{name:'Ambil foto'}).count(),0,'no manual capture button in event mode');
 // One template: Start goes straight to shooting, no template picker. Shots are automatic; retake the first one once.
 await page.getByRole('button',{name:'Mulai',exact:true}).click();
 await page.getByRole('status',{name:/Hitung mundur/}).waitFor();
 await page.getByRole('button',{name:'Ulangi foto ini'}).waitFor();
 assert.equal((await page.evaluate(()=>window.nxbooth.state())).data.session.captures.length,1);
 await page.getByRole('button',{name:'Ulangi foto ini'}).click();
 await page.waitForFunction(async()=>(await window.nxbooth.state()).data.session.captures.length===0);
 // ...then everything runs on its own: shot, shot, process, print, QR.
 await page.getByRole('heading',{name:'Fotomu sudah jadi!'}).waitFor({timeout:60000});
 await page.locator('.qr-panel svg').waitFor();
 await page.getByText('Printer di luar jangkauan.',{exact:false}).waitFor();
 const final=(await page.evaluate(()=>window.nxbooth.state())).data.session;assert.equal(final.phase,'RESULT_READY');assert.equal(final.captures.length,2);
 const claim=log.find(l=>l.url==='/api/v1/results/result-1/claim');assert.ok(claim?.cookie?.startsWith('photo_session='),'QR claim uses the guest session cookie');
 assert.equal(log.filter(l=>l.url.endsWith('/upload')).length,1);
 await page.getByRole('button',{name:'Coba cetak lagi'}).waitFor();
 // Restart returns to the welcome screen with no session; guests need no staff PIN.
 await page.getByRole('button',{name:'Mulai ulang',exact:true}).click();
 await page.getByRole('button',{name:'Mulai',exact:true}).waitFor();
 assert.equal((await page.evaluate(()=>window.nxbooth.state())).data.session,null);
 // A second guest can finish and leave: result timeout resets without any staff action.
 await page.getByRole('button',{name:'Mulai',exact:true}).click();
 await page.getByRole('heading',{name:'Fotomu sudah jadi!'}).waitFor({timeout:30000});
 await page.locator('.qr-panel svg').waitFor();
 await page.getByRole('button',{name:'Mulai',exact:true}).waitFor({timeout:20000});
 assert.equal((await page.evaluate(()=>window.nxbooth.state())).data.session,null);
 // Two templates (Classic + AI): the guest chooses; Cancel returns to the start.
 const two=await page.evaluate(()=>window.nxbooth.eventSave({name:'Pernikahan Sarah & Arif',date:'2026-10-24',templates:[{mode:'CLASSIC',id:'frame-1'},{mode:'BASIC',id:'tpl-1'}],active:true}));assert.equal(two.ok,true);
 await page.reload();await page.getByRole('button',{name:'Mulai',exact:true}).click();
 await page.getByRole('heading',{name:'Pilih template'}).waitFor();
 await page.getByRole('listitem').filter({hasText:'Tema Uji'}).click();
 await page.getByRole('button',{name:'Batal'}).waitFor();
 assert.equal((await page.evaluate(()=>window.nxbooth.state())).data.session.mode,'BASIC');
 await page.getByRole('button',{name:'Batal'}).click();await page.getByRole('button',{name:'Mulai',exact:true}).waitFor();
 // Event mode off: the manual kiosk is back.
 const off=await page.evaluate(()=>window.nxbooth.eventSave({name:'Pernikahan Sarah & Arif',date:'2026-10-24',templates:[{mode:'CLASSIC',id:'frame-1'}],active:false}));assert.equal(off.ok,true);
 assert.equal((await page.evaluate(()=>window.nxbooth.eventReset())).error.code,'EVENT_MODE_OFF');
 await page.reload();await page.getByRole('heading',{name:'Cek perangkat'}).waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: event mode (staff form, operator checks, auto shots with retake, auto process, auto print notice, QR, manual + automatic restart, template picker, off switch).');
}catch(e){if(app){for(const w of app.windows())console.error(await w.locator('body').innerText().catch(()=>''));}throw e;}
finally{await app?.close();server.close();await rm(root,{recursive:true,force:true})}
