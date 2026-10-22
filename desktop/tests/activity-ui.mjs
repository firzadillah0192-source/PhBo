import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const received=[];
const server=createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();
 res.setHeader('Content-Type','application/json');
 if(req.url==='/api/v1/desktop/diagnostics'){received.push(JSON.parse(body));res.statusCode=201;res.end(JSON.stringify({data:{id:'test-live',stored:true}}));return;}
 res.end(JSON.stringify({data:[]}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,root=await mkdtemp('/tmp/nxbooth-activity-ui-');let app;
try{
 app=await electron.launch({timeout:30000,args:[resolve('electron/main.mjs'),'--no-sandbox'],env:{...process.env,PHBO_DESKTOP_TEST:'1',PHBO_DEVICE_MODE:'hardware',PHBO_TEST_DATA:root,PHBO_KIOSK_API_KEY:'k'.repeat(32),PHBO_OPERATOR_PIN:'123456',PHBO_TEST_ORIGINS:JSON.stringify({control:origin,media:origin,storage:origin,web:origin})}});
 const page=await app.firstWindow();await page.getByRole('heading',{name:'Cek perangkat'}).waitFor();
 assert.equal((await page.evaluate(()=>window.nxbooth.activityEvent({action:'camera.preview',status:'error',code:'CAMERA_PREVIEW_EMPTY',token:'MUST_NOT_LEAK'}))).ok,false,'IPC rejects unknown diagnostic properties');
 assert.equal((await page.evaluate(()=>window.nxbooth.activityEvent({action:'camera.preview',status:'error',code:'CAMERA_PREVIEW_EMPTY'}))).ok,true);
 assert.equal((await page.evaluate(()=>window.nxbooth.cameraOpen())).error.code,'CAMERA_MODE_INVALID');
 await page.evaluate(()=>window.nxbooth.unlock('MUST_NOT_LEAK'));
 await page.getByRole('button',{name:'Lanjutkan',exact:true}).click();
 for(let i=0;i<250&&!received.length;i++)await new Promise(r=>setTimeout(r,100));
 assert.ok(received.length,'background sender posts without pressing Kirim log');
 const events=received.flatMap(r=>{assert.match(r.note,/^activity\/v1 /);assert.ok(r.startup_log.length<=2000);return r.startup_log.trim().split('\n').map(JSON.parse);});
 assert.ok(events.some(e=>e.a==='camera.preview'&&e.c==='CAMERA_PREVIEW_EMPTY'));
 assert.ok(events.some(e=>e.a==='ipc.cameraOpen'&&e.c==='CAMERA_MODE_INVALID'));
 assert.ok(!JSON.stringify(received).includes('MUST_NOT_LEAK'));
 assert.ok(!JSON.stringify(received).includes('data:image'));
 assert.ok((await readFile(join(root,'activity.jsonl'),'utf8')).includes('ui.click'));
 console.log('PASS: real Electron/preload activity IPC, privacy validation, automatic HTTP delivery of preview/IPC errors and local activity persistence. No staff send action or physical camera used.');
}finally{await app?.close();server.closeAllConnections();server.close();await rm(root,{recursive:true,force:true});}
