import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ActivityLog,activityEvent} from '../shared/activity-log.mjs';
import {Bridge} from '../shared/bridge.mjs';
import {buildReport} from '../shared/diagnostics.mjs';

const root=()=>mkdtemp(join(tmpdir(),'nxbooth-activity-'));
test('activity whitelist excludes credentials, photos, paths, messages and non-scalar SDK details',()=>{
 const record=activityEvent({action:'camera.preview.frame',status:'error',code:'TIMEOUT',sdk:'DeviceBusy',exception:'TimeoutException',hresult:'0x80131505',bytes:0,ms:10000,token:'SECRET',url:'data:image/jpeg;base64,SECRET',params:{password:'SECRET'},message:'SECRET C:\\Users\\Alice',path:'/SECRET'},0);
 assert.deepEqual(record,{t:'1970-01-01T00:00:00.000Z',a:'camera.preview.frame',s:'error',c:'TIMEOUT',ms:10000,bytes:0,sdk:'DeviceBusy',ex:'TimeoutException',hr:'0x80131505'});
 assert.equal(activityEvent({action:'https://SECRET',status:'ok'}),null);
 assert.equal(activityEvent({action:'camera.preview',status:'ok'},NaN),null);
 assert.deepEqual(activityEvent({action:'camera.preview',status:'error',code:'Bearer SECRET',sdk:'data:image/jpeg;base64,SECRET'},0),{t:'1970-01-01T00:00:00.000Z',a:'camera.preview',s:'error'});
});
test('failed live delivery persists across restart, retries without losing new actions, respects cooldown and stays under server field cap',async()=>{
 const dir=await root();let now=100000,first=true,sent=[];let log;
 const send=async(text,note)=>{assert.ok(text.length<=1900);assert.match(note,/^activity\/v1 /);if(first){first=false;throw Error('NETWORK_FAILED');}sent.push(text);log.record({action:'ipc.print',status:'begin'});return {id:'stored'};};
 try{
  log=new ActivityLog({dir,send,now:()=>now});await log.init();log.record({action:'ipc.start',status:'ok'});await log.flush();assert.equal(log.status().queued,1);assert.equal(log.status().error,'NETWORK_FAILED');await log.stop();
  log=new ActivityLog({dir,send,now:()=>now});await log.init();assert.equal(log.status().queued,1);now+=16000;await log.flush();assert.equal(log.status().queued,1,'an action recorded during upload remains queued');assert.equal(JSON.parse(sent[0]).a,'ipc.start');
  await log.flush();assert.equal(sent.length,1);now+=13000;await log.flush();assert.equal(sent.length,2);
  const local=await readFile(join(dir,'activity.jsonl'),'utf8');assert.ok(local.includes('ipc.print'));await log.stop();
 }finally{await log?.stop();await rm(dir,{recursive:true,force:true});}
});
test('polling frames are aggregated but the first new SDK error is recorded immediately',async()=>{
 const dir=await root();let now=100000;const log=new ActivityLog({dir,send:async()=>({}),now:()=>now});
 try{
  await log.init();for(let i=0;i<500;i++)log.record({action:'camera.preview.frame',status:'empty',sdk:'ObjectNotReady',bytes:0});
  assert.equal(log.queue.length,1);log.record({action:'camera.preview.frame',status:'error',code:'TIMEOUT'});assert.equal(log.queue.length,2);
  now+=60001;log.summarize();assert.equal(log.queue[2].s,'summary');assert.equal(log.queue[2].count,499);
  const report=buildReport({version:'1.1.1',platform:'win32',osVersion:'10',startupLog:log.queue.map(e=>JSON.stringify(e)).join('\n'),note:'activity/v1 test'});assert.equal(report.note,'activity/v1 test');assert.ok(report.startup_log.length<=2000);
 }finally{await log.stop();await rm(dir,{recursive:true,force:true});}
});
test('native stderr and bridge results feed safe diagnostics; requests and image results never enter the trace',async()=>{
 const dir=await root();const log=new ActivityLog({dir,send:async()=>({})});await log.init();
 const fake=`const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const r=JSON.parse(line);console.error(JSON.stringify({kind:'camera-diagnostic',action:'camera.preview.frame',status:'empty',sdk:'DeviceBusy',token:'SECRET'}));console.log(JSON.stringify({version:1,id:r.id,ok:true,result:{url:'data:image/jpeg;base64,SECRET'}}));});`;
 const bridge=new Bridge(process.execPath,['-e',fake],{onDiagnostic:e=>log.record(e)});
 try{
  const result=await bridge.call('camera.frame',{token:'SECRET'});assert.ok(result.url);await log.stop();
  const text=await readFile(join(dir,'activity.jsonl'),'utf8');assert.ok(text.includes('DeviceBusy'));assert.ok(text.includes('adapter.camera.frame'));assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('data:image'));
 }finally{bridge.close();await log.stop();await rm(dir,{recursive:true,force:true});}
});
test('background sender delivers without staff action and backs off without an upload loop',async()=>{
 const dir=await root();let calls=0;const log=new ActivityLog({dir,intervalMs:10,minSendMs:50,send:async()=>{calls++;throw Error('RATE_LIMITED');}});
 try{await log.init();log.start();log.record({action:'camera.preview',status:'error',code:'CAMERA_PREVIEW_EMPTY'});await new Promise(r=>setTimeout(r,90));assert.equal(calls,1);assert.equal(log.queue.length,1);assert.equal(log.status().error,'RATE_LIMITED');}
 finally{await log.stop();await rm(dir,{recursive:true,force:true});}
});

test('automatic daily budget survives restart and resumes on the next day',async()=>{
 const dir=await root();let now=Date.parse('2026-10-17T12:00:00Z'),calls=0,log;
 const options={dir,now:()=>now,maxDailyBytes:1000,minSendMs:0,send:async()=>{calls++;return {};}};
 try{
  log=new ActivityLog(options);await log.init();log.record({action:'ipc.start',status:'ok'});await log.flush();assert.equal(calls,1);await log.stop();
  log=new ActivityLog(options);await log.init();log.record({action:'camera.preview',status:'error',code:'CAMERA_PREVIEW_EMPTY'});await log.flush();assert.equal(calls,1);assert.equal(log.status().error,'ACTIVITY_DAILY_LIMIT');assert.equal(log.queue.length,1);
  now+=86400000;await log.flush();assert.equal(calls,2);assert.equal(log.queue.length,0);
 }finally{await log?.stop();await rm(dir,{recursive:true,force:true});}
});

test('network diagnostics report operation/status and never URL IDs, cookies or credentials',async()=>{
 const {createServer}=await import('node:http');
 const {ControlClient,origins,observeNetwork}=await import('../shared/clients.mjs');
 let status=503;const events=[];const server=createServer((req,res)=>{res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(status===503?{error:{code:'TEMPORARY_FAILURE'}}:{data:{ok:true}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const url='http://127.0.0.1:'+server.address().port;const config=origins({control:url,media:url,storage:url,web:url},true);const client=new ControlClient(config,{token:'PRIVATE_TOKEN'},'PRIVATE_COOKIE');
  observeNetwork(e=>events.push(e));await assert.rejects(client.request('/api/v1/generations/PRIVATE_ID'),/TEMPORARY_FAILURE/);
  assert.ok(events.some(e=>e.action==='network.generation.poll'&&e.http===503));assert.ok(!JSON.stringify(events).includes('PRIVATE_'));
  status=200;observeNetwork(()=>{throw Error('observer broke');});assert.deepEqual(await client.request('/api/v1/generations/PRIVATE_ID'),{ok:true});
 }finally{observeNetwork(null);server.closeAllConnections();server.close();}
});
