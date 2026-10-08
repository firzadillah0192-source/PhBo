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
