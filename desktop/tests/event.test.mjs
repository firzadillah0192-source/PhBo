import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventStore,DEFAULT_TIMING} from '../shared/event.mjs';
import {ControlClient,origins} from '../shared/clients.mjs';

test('Event settings validate dates, deduplicate choices and survive restart; corrupt settings disable event mode',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nxbooth-event-')),file=join(root,'event.json');
 const input={name:'  Acara bersama  ',date:'2028-02-29',templates:[{mode:'CLASSIC',id:'frame-1'},{mode:'CLASSIC',id:'frame-1'},{mode:'BASIC',id:'theme-1'}],active:true};
 try{
  const store=new EventStore(file);assert.equal(await store.load(),null);
  const saved=await store.save(input);assert.equal(saved.name,'Acara bersama');assert.equal(saved.templates.length,2);
  assert.deepEqual(await new EventStore(file).load(),saved);
  for(const value of [{...input,date:'2026-02-29'},{...input,name:'X\nY'},{...input,templates:[]},{...input,templates:[{mode:'CLASSIC',id:'../escape'}]}])await assert.rejects(store.save(value));
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),saved,'invalid saves preserve current settings');
  await writeFile(file,'broken');assert.equal(await new EventStore(file).load(),null);
  assert.deepEqual(DEFAULT_TIMING,{countdown:5,retake:4,reset:120});
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Result claim posts refresh=false and rejects QR links outside our web origin or with mismatched payloads',async()=>{
 const client=new ControlClient(origins());let response;
 client.request=async(path,body)=>{assert.equal(path,'/api/v1/results/result-1/claim');assert.deepEqual(body,{refresh:false});return response;};
 const url=client.config.web+'/r/'+'a'.repeat(43);
 response={claim_url:url,qr_payload:url,expires_at:'2026-10-18T00:00:00Z'};
 assert.deepEqual(await client.claimResult('result-1'),{url,expires_at:response.expires_at});
 for(const bad of ['https://other.example/r/'+'a'.repeat(43),url+'?token=abc',url+'#abc',client.config.web+'/wrong']){
  response={claim_url:bad,qr_payload:bad};await assert.rejects(client.claimResult('result-1'),/CLAIM_INVALID/);
 }
 response={claim_url:url,qr_payload:'another QR'};await assert.rejects(client.claimResult('result-1'),/CLAIM_INVALID/);
 await assert.rejects(client.claimResult('../escape'),/INVALID_ID/);
});
