import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {Journal,newId} from '../shared/journal.mjs';
import {Secrets} from '../shared/secrets.mjs';
import {Bridge} from '../shared/bridge.mjs';
import {Runtime} from '../shared/runtime.mjs';
import {ControlClient,MediaClient,origins} from '../shared/clients.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
test('Personalized desktop sessions validate and persist event names before capture',async()=>{
 const root=await mkdtemp('/srv/photobooth/tmp/desktop-event-');let saved=[];
 const journal={all:()=>saved,save:async s=>{saved=[structuredClone(s)]},prints:()=>[]};
 const device={call:async(_method,{captureId})=>{const path=join(root,captureId+'.png');await writeFile(path,png);return {path,simulated:true}}};
 const runtime=new Runtime({journal,bridge:device,assets:root,apiKey:'fixture',secrets:{persistent:false}});
 runtime.catalog.CLASSIC=[{id:'classic-birthday-001',shots:3,requiresEventName:true}];
 try{
  for(const name of [undefined,'','A\nB','x'.repeat(81)])await assert.rejects(runtime.start('CLASSIC','classic-birthday-001',name),/EVENT_NAME_REQUIRED/);
  await runtime.start('CLASSIC','classic-birthday-001','  Ulang Tahun Naya  ');
  assert.equal(runtime.session.eventName,'Ulang Tahun Naya');assert.equal(saved[0].eventName,'Ulang Tahun Naya');
  await runtime.capture();assert.ok(Number.isFinite(Date.parse(runtime.session.captures[0].capturedAt)));
  await runtime.retake();await runtime.capture();assert.equal(runtime.session.captures.length,1);
  const restored=new Runtime({journal,bridge:device,assets:root,secrets:{persistent:false}});
  assert.equal(restored.session.eventName,'Ulang Tahun Naya');assert.equal(restored.session.captures[0].capturedAt,runtime.session.captures[0].capturedAt);
 }finally{await rm(root,{recursive:true,force:true})}
});
const temp=()=>mkdtemp(join(tmpdir(),'nxbooth-test-'));
const dll=resolve('native/KioskBridge/bin/Release/net10.0/KioskBridge.dll');
const bridge=(root,sim=true)=>new Bridge(process.env.PHBO_DOTNET||'dotnet',[dll,'--root',root,...sim?['--simulated']:[]]);
test('SQLite persists metadata and recovers interrupted generation/ambiguous print',async()=>{
 const root=await temp();try{const file=join(root,'journal.sqlite');let j=await Journal.open(file);const id=newId();await j.save({id,phase:'PROCESSING',captures:[],keys:{generate:'same-key'}});await j.print(newId(),id,'SUBMITTING');j.close();j=await Journal.open(file);assert.equal(j.get(id).phase,'RECOVERY_REQUIRED');assert.equal(j.get(id).keys.generate,'same-key');assert.equal(j.prints(id)[0].status,'UNKNOWN');j.close();}finally{await rm(root,{recursive:true,force:true});}
});
test('real .NET adapter copies fixture, validates IDs/path, labels simulated printing; real mode fails explicitly',async()=>{
 const root=await temp();const assets=join(root,'assets');await mkdir(assets);const fixture=join(root,'fixture.png');await writeFile(fixture,png);const b=bridge(assets);
 try{assert.equal((await b.call('devices.status')).camera,'FIXTURE_REQUIRED');await assert.rejects(b.call('camera.capture',{captureId:newId()}),/FIXTURE_REQUIRED/);await b.call('camera.setFixture',{path:fixture});
 await assert.rejects(b.call('camera.capture',{captureId:'../../escape'}),/INVALID_ID/);const c=await b.call('camera.capture',{captureId:newId()});assert.deepEqual(await readFile(c.path),png);assert.equal(c.simulated,true);
 await assert.rejects(b.call('printer.submit',{jobId:newId(),path:fixture}),/PATH_FORBIDDEN/);
 const id=newId();assert.equal((await b.call('printer.submit',{jobId:id,path:c.path})).status,'SIMULATED');await assert.rejects(b.call('printer.submit',{jobId:id,path:c.path}),/PRINT_ALREADY_SUBMITTED/);
 await assert.rejects(b.call('unknown'),/METHOD_UNSUPPORTED/);
 }finally{b.close();}
 const real=bridge(assets,false);try{await assert.rejects(real.call('camera.capture',{captureId:newId()}),/CAMERA_NOT_CONNECTED/);await assert.rejects(real.call('printer.submit',{jobId:newId(),path:fixture}),/PRINTER_NOT_CONNECTED/);}finally{real.close();await rm(root,{recursive:true,force:true});}
});
test('origin controls forbid plaintext remote services, binary gateway payload and media paths',async()=>{
 assert.throws(()=>origins({control:'http://example.com'}),/INVALID_ORIGIN/);assert.throws(()=>origins({storage:'https://user:pass@example.com'}),/INVALID_ORIGIN/);
 const c=new ControlClient(origins());await assert.rejects(c.request('/api/v1/photos/id'),/CONTROL_ROUTE_FORBIDDEN/);await assert.rejects(c.reserve({claimToken:'x',bytes:Buffer.from('x')},'key'),/CONTROL_JSON_ONLY/);
 const m=new MediaClient(origins());await assert.rejects(m.download('https://evil.example/image.png'),/MEDIA_ORIGIN_FORBIDDEN/);await assert.rejects(m.upload('https://evil.example',[],null,null),/MEDIA_ROUTE_FORBIDDEN/);
});
async function server(handler){const s=createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));return {origin:`http://127.0.0.1:${s.address().port}`,close:()=>new Promise(r=>{s.closeAllConnections();s.close(r);})};}
test('full fixture flow sends only JSON to gateway and bytes to media/storage, journals result and prevents duplicate print',async()=>{
 const requests=[];let failed=false;const cookie='photo_session='+'a'.repeat(43);
 const storage=await server((req,res)=>{requests.push({server:'storage',path:req.url,cookie:req.headers.cookie});res.setHeader('Content-Type','image/png');res.end(png);});
 const media=await server(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);requests.push({server:'media',path:req.url,type:req.headers['content-type'],body:Buffer.concat(chunks)});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{photos:[{id:'a'.repeat(32)}]}}));});
 const control=await server(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);const body=Buffer.concat(chunks).toString();requests.push({server:'control',path:req.url,type:req.headers['content-type'],body,key:req.headers['idempotency-key']});res.setHeader('Content-Type','application/json');let data;
 if(req.url==='/api/v1/frames')data=[{id:'frame-1',name:'Frame',shot_count:1}];else if(['/api/v1/templates','/api/v1/experiences'].includes(req.url))data=[];
 else if(req.url==='/api/v1/kiosk/sessions')data={code:'CODE123',uploadPath:'/api/v1/kiosk/session/CODE123/upload'};
 else if(req.url.endsWith('/claim')){res.setHeader('Set-Cookie',cookie+'; HttpOnly; Path=/api/v1');data={claimed:true};}
 else if(req.url==='/api/v1/generations')data={id:'job-1',status:'QUEUED'};
 else if(req.url==='/api/v1/generations/job-1')data={id:'job-1',status:failed?'FAILED':'COMPLETED',resultId:failed?null:'result-1'};
 else if(req.url==='/api/v1/results/result-1/url')data={url:storage.origin+'/private/result.png?signature=test'};
 else{res.statusCode=404;data=null;}res.end(JSON.stringify({data}));
 });
 const root=await temp();const assets=join(root,'assets');await mkdir(assets);const fixture=join(root,'fixture.png');await writeFile(fixture,png);const b=bridge(assets);const journal=await Journal.open(join(root,'journal.sqlite'));
 const secrets=new Secrets(join(root,'secrets'),null);
 try{
 const rt=new Runtime({journal,bridge:b,assets,secrets,apiKey:'fixture-key',origins:origins({control:control.origin,media:media.origin,storage:storage.origin},true)});await rt.initialize();await rt.setFixture(fixture);await rt.start('CLASSIC','frame-1');await rt.capture();assert.equal(rt.session.phase,'REVIEWING');
 await rt.process();assert.equal(rt.session.phase,'RESULT_READY');assert.ok((await rt.state()).session.result.startsWith('data:image/png'));
 await rt.print();assert.equal(journal.prints(rt.session.id)[0].status,'SIMULATED');await assert.rejects(rt.print(),/PRINT_ALREADY_SUBMITTED/);
 assert.equal(requests.filter(r=>r.server==='media').length,1);assert.ok(requests.find(r=>r.server==='media').body.includes(png));
 for(const r of requests.filter(r=>r.server==='control'&&r.body)){assert.equal(r.type,'application/json');assert.doesNotThrow(()=>JSON.parse(r.body));assert.ok(!r.body.includes('base64'));}
 assert.equal(requests.find(r=>r.server==='storage').cookie,undefined);assert.equal((await secrets.get(rt.session.id)).cookie,cookie);
 const db=await readFile(join(root,'journal.sqlite'));assert.ok(!db.includes(Buffer.from(cookie)));assert.ok(!JSON.stringify(await rt.state()).includes('signature=test'));
 await rt.finish();failed=true;await rt.start('CLASSIC','frame-1');await rt.capture();await assert.rejects(rt.process(),/GENERATION_FAILED/);assert.equal(rt.session.phase,'FAILED');assert.equal((await rt.state()).session.result,null);
 }finally{b.close();journal.close();await Promise.all([control.close(),media.close(),storage.close()]);await rm(root,{recursive:true,force:true});}
});
test('offline capture and retake work; backend absence never fabricates a result',async()=>{
 const root=await temp(),assets=join(root,'assets');await mkdir(assets);const fixture=join(root,'fixture.png');await writeFile(fixture,png);const b=bridge(assets),j=await Journal.open(join(root,'j.sqlite'));
 try{const rt=new Runtime({journal:j,bridge:b,assets,secrets:new Secrets(root,null),origins:origins()});await rt.initialize();await rt.setFixture(fixture);await rt.start('BASIC');await rt.capture();const old=rt.session.captures[0].id;await rt.retake();await rt.capture();assert.notEqual(rt.session.captures[0].id,old);await assert.rejects(rt.process(),/BACKEND_NOT_CONFIGURED/);assert.equal((await rt.state()).session.result,null);assert.equal(rt.session.phase,'REVIEWING');}finally{b.close();j.close();await rm(root,{recursive:true,force:true});}
});
test('media client refuses redirects and non-image result bytes',async()=>{
 const destination=await server((_req,res)=>res.end(png));let kind='redirect';
 const storage=await server((_req,res)=>{if(kind==='redirect'){res.writeHead(302,{Location:destination.origin+'/photo'});res.end();}else{res.setHeader('Content-Type','text/html');res.end('<html>not a photo</html>');}});
 try{const client=new MediaClient(origins({storage:storage.origin},true));await assert.rejects(client.download(storage.origin+'/result'));kind='html';await assert.rejects(client.download(storage.origin+'/result'),/INVALID_IMAGE/);}finally{await Promise.all([storage.close(),destination.close()]);}
});
test('restart recovery without secret does not send any request or fabricate output',async()=>{
 const root=await temp();const assets=join(root,'assets');await mkdir(assets);const journal=await Journal.open(join(root,'j.sqlite'));
 const s={id:newId(),phase:'RECOVERY_REQUIRED',mode:'CLASSIC',selectionId:'frame-1',shots:1,captures:[],remote:{code:'session1'},keys:{reserve:newId(),upload:newId(),generate:newId()}};await journal.save(s);
 try{const rt=new Runtime({journal,bridge:{},assets,secrets:new Secrets(root,null),apiKey:'fixture-key',origins:origins()});await assert.rejects(rt.process(),/CREDENTIAL_RECOVERY_REQUIRED/);assert.equal(rt.session.phase,'RECOVERY_REQUIRED');assert.equal((await rt.state()).session.result,null);}finally{journal.close();await rm(root,{recursive:true,force:true});}
});

import {hashPin,checkPin,validPin} from '../shared/operator.mjs';
import {Updater} from '../shared/updater.mjs';
import {UpdateClient} from '../shared/clients.mjs';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {stat} from 'node:fs/promises';

test('Operator PIN is stored as a salted hash and compared exactly',()=>{
 const record=hashPin('4321');
 assert.ok(!JSON.stringify(record).includes('4321'));
 assert.equal(checkPin('4321',record),true);
 for(const bad of ['4322','','432','43210',undefined,null])assert.equal(checkPin(bad,record),false);
 assert.notEqual(hashPin('4321').hash,record.hash);
 assert.equal(validPin('abc'),false);assert.throws(()=>hashPin('abc'),/PIN_INVALID/);
});

const SIGNER='A'.repeat(40);
function updateFixture(overrides={}){
 const calls=[],progress=[];const dir='/srv/photobooth/tmp/desktop-update-'+newId();
 const info={update_available:true,version:'1.1.0',size:3,sha256:'a'.repeat(64),notes:''};
 const u=new Updater({
  client:{check:async v=>{calls.push('check:'+v);return overrides.info||info;},download:async(_i,file,onProgress)=>{calls.push('download');onProgress(0,3);await writeFile(file,'abc');onProgress(3,3);}},
  bridge:{call:async(method,params)=>{calls.push(method);assert.ok(params.path.startsWith(dir));return overrides.signature||{status:'Valid',thumbprint:SIGNER.toLowerCase()};}},
  dir,version:'1.0.0',signer:overrides.signer??SIGNER,sessionActive:overrides.sessionActive||(()=>false),onProgress:p=>progress.push(p),launch:overrides.launch|| (async file=>{calls.push('launch:'+file);})});
 return {u,calls,dir,progress};
}
test('Updater installs only after download and a Valid pinned signature',async()=>{
 const {u,calls,dir,progress}=updateFixture();
 try{
  assert.deepEqual(await u.check(),{available:true,version:'1.1.0',notes:'',size:3});
  const r=await u.install();assert.equal(r.launched,true);
  assert.deepEqual(calls.filter(c=>!c.startsWith('check')),['download','update.verify','launch:'+join(dir,'NXBooth-Setup-1.1.0.exe')]);
  assert.deepEqual(progress.map(p=>p.stage),['checking','downloading','downloading','verifying','installing']);
  assert.deepEqual(progress.filter(p=>p.stage==='downloading').map(p=>p.percent),[0,100]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Updater without a pinned signer still verifies size/hash (client) and installs without a signature check',async()=>{
 const {u,calls,dir}=updateFixture({signer:'',signature:{status:'NotSigned',thumbprint:null}});
 try{
  assert.equal((await u.install()).launched,true);
  assert.ok(!calls.includes('update.verify'));assert.ok(calls.includes('download'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Updater rejects overlapping installs and allows retry after installer launch failure',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let attempts=0;
 const {u,dir}=updateFixture({launch:async()=>{attempts++;await gate;throw new Error('UPDATE_LAUNCH_FAILED');}});
 try{
  const first=assert.rejects(u.install(),/UPDATE_LAUNCH_FAILED/);
  await assert.rejects(u.install(),/UPDATE_IN_PROGRESS/);
  release();await first;assert.equal(attempts,1);
  await assert.rejects(u.install(),/UPDATE_LAUNCH_FAILED/);assert.equal(attempts,2);
 }finally{release();await rm(dir,{recursive:true,force:true});}
});
test('Updater refuses wrong signer, untrusted signature, active session and missing pin, and deletes the download',async()=>{
 for(const [name,overrides,error] of [
  ['wrong signer',{signature:{status:'Valid',thumbprint:'B'.repeat(40)}},/UPDATE_SIGNATURE_INVALID/],
  ['not trusted',{signature:{status:'UnknownError',thumbprint:SIGNER}},/UPDATE_SIGNATURE_INVALID/],
  ['unsigned',{signature:{status:'NotSigned',thumbprint:null}},/UPDATE_SIGNATURE_INVALID/],
  ['session active',{sessionActive:()=>true},/UPDATE_SESSION_ACTIVE/],
  ['malformed pinned signer',{signer:'xyz'},/UPDATE_SIGNER_NOT_CONFIGURED/],
  ['nothing newer',{info:{update_available:false}},/UPDATE_NOT_AVAILABLE/]]){
  const {u,calls,dir}=updateFixture(overrides);
  try{
   await assert.rejects(u.install(),error,name);
   assert.ok(!calls.some(c=>c.startsWith('launch')),name+' must not launch');
   assert.ok(!existsSync(join(dir,'NXBooth-Setup-1.1.0.exe')),name+' must not leave the installer');
  }finally{await rm(dir,{recursive:true,force:true});}
 }
});
test('UpdateClient verifies size and hash and leaves no partial file',async()=>{
 const body=Buffer.from('synthetic installer');const sha=createHash('sha256').update(body).digest('hex');let mode='ok';
 const server=createServer((req,res)=>{
  assert.equal(req.headers['x-api-key'],'k'.repeat(32));
  if(req.url.startsWith('/api/v1/desktop/update?'))return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:{update_available:true,version:'1.1.0',size:body.length,sha256:sha}}));
  const bytes=mode==='tampered'?Buffer.from('tampered installer!'.slice(0,body.length)):body;
  res.writeHead(200,{'content-length':bytes.length});res.write(bytes.subarray(0,4));setTimeout(()=>mode==='interrupted'?res.destroy():res.end(bytes.subarray(4)),30);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const dir=await mkdtemp('/srv/photobooth/tmp/desktop-update-client-');
 try{
  const client=new UpdateClient(origins({control:base,media:base,storage:base,web:base},true),'k'.repeat(32));
  const info=await client.check('1.0.0');assert.equal(info.version,'1.1.0');
  const progress=[];
  await client.download(info,join(dir,'ok.exe'),(bytes,total)=>progress.push({bytes,total}));assert.equal((await stat(join(dir,'ok.exe'))).size,body.length);
  assert.deepEqual(progress[0],{bytes:0,total:body.length});
  assert.deepEqual(progress.at(-1),{bytes:body.length,total:body.length});
  assert.ok(progress.some(p=>p.bytes>0&&p.bytes<body.length),'reports partial download before completion');
  assert.ok(progress.every((p,i)=>p.bytes<=body.length&&(!i||p.bytes>=progress[i-1].bytes)));
  mode='tampered';await assert.rejects(client.download(info,join(dir,'bad.exe')),/UPDATE_HASH_MISMATCH/);
  assert.ok(!existsSync(join(dir,'bad.exe')));
  mode='interrupted';const partial=[];
  await assert.rejects(client.download(info,join(dir,'partial.exe'),bytes=>partial.push(bytes)));
  assert.ok(!existsSync(join(dir,'partial.exe')));assert.ok(partial.at(-1)<body.length);
  mode='ok';
  await assert.rejects(client.download({...info,size:999},join(dir,'size.exe')),/UPDATE_SIZE_MISMATCH/);
  await assert.rejects(client.download({...info,sha256:'xyz'},join(dir,'m.exe')),/UPDATE_MANIFEST_INVALID/);
  await assert.rejects(new UpdateClient(origins({control:base,media:base,storage:base,web:base},true),'').check('1.0.0'),/BACKEND_NOT_CONFIGURED/);
 }finally{server.close();await rm(dir,{recursive:true,force:true});}
});

import {DeviceLogin} from '../shared/login.mjs';
import {authHeaders,DeviceClient} from '../shared/clients.mjs';
test('Kiosk credential header: device token is Bearer, legacy key is X-API-Key, none is empty',()=>{
 assert.deepEqual(authHeaders({token:'abc'}),{Authorization:'Bearer abc'});
 assert.deepEqual(authHeaders('k'.repeat(32)),{'X-API-Key':'k'.repeat(32)});
 assert.deepEqual(authHeaders(''),{});assert.deepEqual(authHeaders(undefined),{});
});
function loginFixture(polls){
 const saved=[];let t=0;const states=[];
 const client={start:async()=>({device_code:'d'.repeat(43),user_code:'ABCD-2345',verification_url:'https://x.example/activate',expires_in:10,interval:1}),
  poll:async()=>{const next=polls.shift();if(next instanceof Error)throw next;return next;}};
 const login=new DeviceLogin({client,name:'PC',now:()=>t,sleep:async ms=>{t+=ms;await new Promise(r=>setImmediate(r));},onChange:()=>states.push(login.state.status),onApproved:async r=>{saved.push(r.token);}});
 return {login,saved,states};
}
const settle=async login=>{for(let i=0;i<50&&login.state.status==='pending';i++)await new Promise(r=>setImmediate(r));};
test('Device login keeps polling through transient errors and stores the token once approved',async()=>{
 const {login,saved,states}=loginFixture([{status:'pending'},new Error('ADAPTER_TIMEOUT'),{status:'approved',token:'tok',staff:{name:'A'}}]);
 await login.start();assert.equal(login.state.userCode,'ABCD-2345');
 await settle(login);assert.equal(login.state.status,'approved');assert.deepEqual(saved,['tok']);assert.deepEqual(states,['pending','approved']);
});
test('Device login expires, reports server expiry, and can be cancelled without storing anything',async()=>{
 let f=loginFixture(Array.from({length:30},()=>({status:'pending'})));await f.login.start();await settle(f.login);assert.equal(f.login.state.status,'expired');assert.deepEqual(f.saved,[]);
 f=loginFixture([Object.assign(new Error('DEVICE_CODE_EXPIRED'))]);await f.login.start();await settle(f.login);assert.equal(f.login.state.status,'expired');
 f=loginFixture([{status:'pending'},{status:'approved',token:'late'}]);await f.login.start();f.login.cancel();await settle(f.login);await new Promise(r=>setTimeout(r,20));assert.equal(f.login.state.status,'idle');assert.deepEqual(f.saved,[]);
 const failing=new DeviceLogin({client:{start:async()=>{throw new Error('DEVICE_CODES_BUSY');}},name:'PC',onApproved:async()=>{}});await failing.start();assert.deepEqual(failing.state,{status:'error',error:'DEVICE_CODES_BUSY'});
});
test('DeviceClient posts JSON to the control origin and surfaces server error codes',async()=>{
 const seen=[];const server=createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{seen.push({url:req.url,type:req.headers['content-type'],auth:req.headers.authorization,body:JSON.parse(body)});
  if(req.url.endsWith('/token'))return res.writeHead(410,{'content-type':'application/json'}).end(JSON.stringify({error:{code:'DEVICE_CODE_EXPIRED'}}));
  res.writeHead(201,{'content-type':'application/json'}).end(JSON.stringify({data:{device_code:'x'}}));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{const c=new DeviceClient(origins({control:base,media:base,storage:base,web:base},true));
  assert.equal((await c.start('PC 1')).device_code,'x');
  await assert.rejects(c.poll('d'.repeat(43)),/DEVICE_CODE_EXPIRED/);
  assert.deepEqual(seen.map(s=>[s.url,s.type,s.auth,s.body]),[['/api/v1/desktop/device/code','application/json',undefined,{device_name:'PC 1'}],['/api/v1/desktop/device/token','application/json',undefined,{device_code:'d'.repeat(43)}]]);
 }finally{server.close();}
});
