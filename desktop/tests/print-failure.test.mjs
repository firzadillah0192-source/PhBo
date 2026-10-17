import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {Journal} from '../shared/journal.mjs';
import {Secrets} from '../shared/secrets.mjs';
import {Bridge} from '../shared/bridge.mjs';
import {Runtime} from '../shared/runtime.mjs';
import {PrinterService} from '../shared/printer-service.mjs';
import {origins} from '../shared/clients.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const dll=resolve('native/KioskBridge/bin/Release/net10.0/KioskBridge.dll');
async function server(handler){const s=createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));return {origin:`http://127.0.0.1:${s.address().port}`,close:()=>new Promise(r=>{s.closeAllConnections();s.close(r);})};}
// Real (non-simulated) bridge on Linux: printer.submit fails with PRINTER_NOT_CONNECTED, as on a PC with no printer attached.
async function resultReady(withPrinterService){
  const storage=await server((req,res)=>{res.setHeader('Content-Type','image/png');res.end(png);});
  const media=await server(async(req,res)=>{for await(const _ of req);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{photos:[{id:'a'.repeat(32)}]}}));});
  const control=await server(async(req,res)=>{for await(const _ of req);res.setHeader('Content-Type','application/json');let data;
    if(req.url==='/api/v1/frames')data=[{id:'frame-1',name:'Frame',shot_count:1}];else if(['/api/v1/templates','/api/v1/experiences'].includes(req.url))data=[];
    else if(req.url==='/api/v1/kiosk/sessions')data={code:'CODE123',uploadPath:'/api/v1/kiosk/session/CODE123/upload'};
    else if(req.url.endsWith('/claim')){res.setHeader('Set-Cookie','photo_session='+'a'.repeat(43)+'; HttpOnly; Path=/api/v1');data={claimed:true};}
    else if(req.url==='/api/v1/generations')data={id:'job-1',status:'QUEUED'};
    else if(req.url==='/api/v1/generations/job-1')data={id:'job-1',status:'COMPLETED',resultId:'result-1'};
    else if(req.url==='/api/v1/results/result-1/url')data={url:storage.origin+'/private/result.png?signature=test'};
    else{res.statusCode=404;data=null;}res.end(JSON.stringify({data}));});
  const root=await mkdtemp(join(tmpdir(),'nxbooth-print-'));const assets=join(root,'assets');await mkdir(assets);
  const bridge=new Bridge(process.env.PHBO_DOTNET||'dotnet',[dll,'--root',assets]);const journal=await Journal.open(join(root,'journal.sqlite'));
  const printer=withPrinterService?new PrinterService({bridge,journal,assets}):undefined;
  const rt=new Runtime({journal,bridge,assets,secrets:new Secrets(join(root,'secrets'),null),apiKey:'fixture-key',printer,origins:origins({control:control.origin,media:media.origin,storage:storage.origin},true)});
  await rt.initialize();await rt.start('CLASSIC','frame-1');await rt.captureBytes(png);await rt.process();
  assert.equal(rt.session.phase,'RESULT_READY');
  return {rt,journal,cleanup:async()=>{bridge.close();journal.close();await Promise.all([storage,media,control].map(s=>s.close()));await rm(root,{recursive:true,force:true});}};
}
for(const [name,withService] of [['direct bridge path',false],['printer service path',true]])test(`printing with no printer connected can be retried and the session can be finished (${name})`,async()=>{
  const f=await resultReady(withService);
  try{
    await assert.rejects(f.rt.print(),/PRINTER_NOT_CONNECTED/);
    const state=await f.rt.state();assert.equal(state.session.phase,'RESULT_READY','session stays open');
    assert.ok(state.session.prints.every(p=>p.status==='REJECTED'),'nothing was sent to a printer, so the job is REJECTED (retryable): '+JSON.stringify(state.session.prints));
    await assert.rejects(f.rt.print(),/PRINTER_NOT_CONNECTED/,'second attempt reaches the printer again instead of PRINT_ALREADY_SUBMITTED');
    await f.rt.finish();assert.equal(f.rt.session,null);
  }finally{await f.cleanup();}
});
