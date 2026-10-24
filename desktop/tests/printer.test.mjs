import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Journal} from '../shared/journal.mjs';
import {Bridge} from '../shared/bridge.mjs';
import {PrinterService,startPrinterServer,WEB_KIOSK_ORIGIN} from '../shared/printer-service.mjs';
import {Runtime} from '../shared/runtime.mjs';
import {request as httpRequest} from 'node:http';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function fixture(fn){const root=await mkdtemp('/srv/photobooth/tmp/printer-test-');const journal=await Journal.open(join(root,'j.sqlite'));const assets=join(root,'assets');await mkdir(assets);try{return await fn({root,journal,assets})}finally{journal.close();await rm(root,{recursive:true,force:true})}}
test('web and desktop share durable print deduplication; accepted is not printed',()=>fixture(async({journal,assets,root})=>{
 let calls=0;
 const bridge={call:async(method,p)=>{if(method==='devices.status')return {printing:{printer:'READY',printerName:'EPSON L8050 Series'},simulated:false};calls++;assert.equal(p.profile,'classic-two-strips-4r');assert.deepEqual(await readFile(p.path),png);return {status:'ACCEPTED',printerName:'EPSON L8050 Series'}}};
 const printer=new PrinterService({bridge,journal,assets});
 assert.equal((await printer.status()).printer,'READY');
 await printer.submit({resultId:'result-1',profile:'classic-two-strips-4r',base64:png.toString('base64')});
 assert.equal(printer.job('result-1').status,'ACCEPTED');
 await assert.rejects(printer.submit({resultId:'result-1',profile:'classic-two-strips-4r',base64:png.toString('base64')}),/PRINT_ALREADY_SUBMITTED/);
 const info=(await import('../shared/image.mjs')).inspectImage(png);await writeFile(join(assets,'result.png'),png);
 const runtime=new Runtime({journal,bridge,assets,printer,secrets:{persistent:false}});
 runtime.session={id:'desktop-session',phase:'RESULT_READY',mode:'CLASSIC',captures:[],resultId:'result-1',resultFile:'result.png',resultHash:info.sha256};
 await assert.rejects(runtime.print(),/PRINT_ALREADY_SUBMITTED/);assert.equal(calls,1);
 assert.equal((await runtime.state()).session.prints[0].status,'ACCEPTED');
 const reopened=await Journal.open(join(root,'j.sqlite'));assert.equal(reopened.prints('web:result-1')[0].status,'ACCEPTED');reopened.close();
}));
test('ambiguous submission is locked, known preflight failure can retry safely',()=>fixture(async({journal,assets})=>{
 let outcome='PRINT_ENABLE_4R_BORDERLESS',calls=0;
 const printer=new PrinterService({journal,assets,bridge:{call:async()=>{calls++;throw new Error(outcome)}}});
 const input={resultId:'r1',profile:'photo-4r',base64:png.toString('base64')};
 await assert.rejects(printer.submit(input),/PRINT_ENABLE_4R_BORDERLESS/);assert.equal(printer.job('r1').status,'REJECTED');
 outcome='PRINT_OUTCOME_UNKNOWN';await assert.rejects(printer.submit(input),/PRINT_OUTCOME_UNKNOWN/);assert.equal(printer.job('r1').status,'UNKNOWN');
 await assert.rejects(printer.submit(input),/PRINT_ALREADY_SUBMITTED/);assert.equal(calls,2);
}));
test('invalid image/profile/id never reaches printer or journal',()=>fixture(async({journal,assets})=>{
 const printer=new PrinterService({journal,assets,bridge:{call:()=>assert.fail('no device call')}});
 for(const input of [{resultId:'../escape',profile:'photo-4r',base64:png.toString('base64')},{resultId:'r1',profile:'arbitrary',base64:png.toString('base64')},{resultId:'r1',profile:'photo-4r',base64:'bad'},{resultId:'r1',profile:'photo-4r',base64:Buffer.from('<html>').toString('base64')}])await assert.rejects(printer.submit(input));
 assert.deepEqual(journal.prints('web:r1'),[]);
}));
test('loopback API requires exact origin, Host and private pairing; rejects extra fields',()=>fixture(async({journal,assets})=>{
 const printer=new PrinterService({journal,assets,bridge:{call:async()=>({simulated:true,printer:'SIMULATED'})}});
 const local=await startPrinterServer(printer,{port:0});const base=`http://127.0.0.1:${local.port}`;
 const headers={Origin:WEB_KIOSK_ORIGIN,Authorization:'Bearer '+local.token};
 try{
  assert.equal((await fetch(base+'/v1/status')).status,403);
  assert.equal((await fetch(base+'/v1/status',{headers:{...headers,Origin:'https://evil.example'}})).status,403);
  const hostStatus=await new Promise((resolve,reject)=>{const req=httpRequest(base+'/v1/status',{headers:{...headers,Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end()});assert.equal(hostStatus,403);
  assert.equal((await fetch(base+'/v1/status',{headers:{Origin:WEB_KIOSK_ORIGIN}})).status,401);
  const options=await fetch(base+'/v1/status',{method:'OPTIONS',headers:{Origin:WEB_KIOSK_ORIGIN,'Access-Control-Request-Private-Network':'true'}});assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-private-network'),'true');
  const r=await fetch(base+'/v1/status',{headers});assert.equal((await r.json()).data.printer,'SIMULATED');assert.equal(r.headers.get('access-control-allow-origin'),WEB_KIOSK_ORIGIN);
  const bad=await fetch(base+'/v1/print',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({path:'C:/secret',resultId:'r1',profile:'photo-4r',base64:png.toString('base64')})});assert.equal(bad.status,400);assert.equal((await bad.json()).error.code,'PRINT_REQUEST_INVALID');
 }finally{await local.close()}
}));
test('real .NET print planner lays two 2x6 strips onto one 4x6 sheet and fits full AI image',()=>fixture(async({assets})=>{
 const bridge=new Bridge(process.env.PHBO_DOTNET||'dotnet',[resolve('native/KioskBridge/bin/Release/net10.0/KioskBridge.dll'),'--root',assets,'--simulated']);
 try{
  const p=await bridge.call('printer.plan',{profile:'classic-two-strips-4r',width:1200,height:3600});assert.deepEqual(p.rectangles,[[0,0,200,600],[200,0,200,600]]);
  await assert.rejects(bridge.call('printer.plan',{profile:'classic-two-strips-4r',width:1000,height:3600}),/PRINT_CLASSIC_SIZE_INVALID/);
  const photo=await bridge.call('printer.plan',{profile:'photo-4r',width:1800,height:1200});assert.equal(photo.rectangles[0][0],0);assert.equal(photo.rectangles[0][2],400);assert.ok(Math.abs(photo.rectangles[0][1]-166.666667)<.001);assert.ok(Math.abs(photo.rectangles[0][3]-266.666667)<.001);
  await assert.rejects(bridge.call('printer.plan',{profile:'photo-4r',width:25001,height:1000}),/PRINT_IMAGE_INVALID/);
 }finally{bridge.close()}
}));
test('desktop webcam capture persists actual bytes and forbids captures after final pose',()=>fixture(async({journal,assets})=>{
 const runtime=new Runtime({journal,bridge:{},assets,secrets:{persistent:false}});await runtime.start('BASIC');
 await runtime.captureBytes(png);assert.equal(runtime.session.phase,'REVIEWING');assert.equal(runtime.session.captures[0].simulated,false);assert.equal(runtime.session.captures[0].source,'browser-webcam');
 assert.deepEqual(await readFile(join(assets,runtime.session.captures[0].file)),png);
 await assert.rejects(runtime.captureBytes(png),/CAPTURE_NOT_ALLOWED/);
}));
