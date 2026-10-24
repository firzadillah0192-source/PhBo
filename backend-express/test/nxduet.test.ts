import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createMigrationApp } from '../src/migration-app.js';
import request from 'supertest';
import { createSchema,placementSchema,validateOverlay } from '../src/nxduet/policy.js';
import { companionRect,composeDuet } from '../src/nxduet/compositor.js';
import { DuetService,duetResponse } from '../src/nxduet/service.js';
import { DuetFiles } from '../src/nxduet/files.js';
import { DuetWorker } from '../src/nxduet/worker.js';
import { NativeNineRouterProvider } from '../src/services/native-provider.service.js';
import { duetAdminRoutes } from '../src/nxduet/routes.js';
import express from 'express';
import { AppError } from '../src/lib/errors.js';
import { NativeObjectStorage } from '../src/services/native-object-storage.service.js';
import { Readable } from 'node:stream';

export async function syntheticOverlay(){return sharp(Buffer.from('<svg width="512" height="512"><rect x="100" y="80" width="310" height="430" rx="40" fill="#ef4050"/></svg>')).png().toBuffer();}
test('NXDuet accepts real transparent pixels and rejects opaque, empty, corrupt and tiny assets',async()=>{
  const fixture=await syntheticOverlay();assert.deepEqual(await validateOverlay(fixture),{width:512,height:512});
  const opaque=await sharp({create:{width:512,height:512,channels:4,background:'#fff'}}).png().toBuffer();
  const empty=await sharp({create:{width:512,height:512,channels:4,background:'#0000'}}).png().toBuffer();
  const tiny=await sharp(fixture).resize(128,128).png().toBuffer();
  for(const bytes of [opaque,empty,tiny,Buffer.from('invalid')])await assert.rejects(validateOverlay(bytes),{code:'NXDUET_OVERLAY_INVALID'});
});
test('NXDuet rejects client cost/model overrides and invalid placement',()=>{
  const body={upload_id:'a'.repeat(32),name:'Family',rights_accepted:true};assert.equal(createSchema.safeParse(body).success,true);
  for(const value of [{...body,credits:1},{...body,model:'client-override'},{...body,rights_accepted:false},{...body,name:'   '}])assert.equal(createSchema.safeParse(value).success,false);
  for(const scale of [0,1.01,NaN])assert.equal(placementSchema.safeParse({side:'right',scale}).success,false);
});
test('NXDuet provider asks for true transparency without changing normal generation payloads',async()=>{
  const calls:any[]=[];const bytes=await syntheticOverlay();
  const provider=new NativeNineRouterProvider({baseUrl:'https://synthetic.invalid',key:'synthetic-test-only',timeoutMs:5000,resultOrigins:[]},async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({data:[{b64_json:bytes.toString('base64')}]}),{status:200});});
  await provider.generate(bytes,'synthetic prompt','gpt-image-synthetic',undefined,undefined,{transparentBackground:true});
  await provider.generate(bytes,'synthetic prompt','gpt-image-synthetic');
  assert.equal(calls[0].background,'transparent');assert.equal(calls[0].output_format,'png');assert.equal(calls[1].background,undefined);assert.equal(calls[1].output_format,undefined);
});
test('NXDuet composition uses three distinct camera fixtures and fixed overlay placement',async()=>{
  const colors=['#102030','#304050','#506070'];
  const files=await Promise.all(colors.map(async(color,i)=>({buffer:await sharp({create:{width:1200,height:900,channels:3,background:color}}).jpeg().toBuffer(),mimetype:'image/jpeg',originalname:`synthetic-${i}.jpg`} as Express.Multer.File)));
  const output=await composeDuet(files,await syntheticOverlay(),{side:'right',scale:.9});
  const {data,info}=await sharp(output).removeAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,1300);assert.equal(info.height,3000);
  for(let i=0;i<3;i++){const offset=((110+i*930+450)*info.width+150)*info.channels;const expected=colors[i]!.slice(1).match(/../g)!.map(v=>parseInt(v,16));expected.forEach((v,c)=>assert.ok(Math.abs(data[offset+c]!-v)<=3));}
  const rect=companionRect(1200,900,512,512,{side:'right',scale:.9});assert.deepEqual(rect,{width:540,height:540,left:660,top:360});
  await assert.rejects(composeDuet(files.slice(0,2),await syntheticOverlay(),{side:'left',scale:.9}),{code:'NXDUET_CAPTURE_COUNT'});
});
test('NXDuet private responses never expose source paths, prompts, model or provider metadata',()=>{
  const row={id:'a'.repeat(32),name:'Private',state:'COMPLETED',enabled:true,overlay_path:'private-storage',source_path:'source-secret-path',model:'private-model',provider_meta:{key:'private'},placement:{side:'right',scale:.9},charge_status:'CONSUMED',credits:100} as never;
  const publicRow=JSON.stringify(duetResponse(row));for(const value of ['private-model','source-secret-path','private-storage','provider_meta'])assert.ok(!publicRow.includes(value));
});
test('NXDuet account isolation denies asset reads before loading bytes',async()=>{
  let reads=0;const id='a'.repeat(32),model={find:async()=>({id,account_id:'owner',enabled:true,state:'COMPLETED',overlay_path:'private'})};
  const service=new DuetService(model as never,{read:async()=>{reads++;}} as never,{} as never,{} as never,async()=>'');
  await assert.rejects(service.image('intruder',id),{code:'NXDUET_NOT_FOUND'});assert.equal(reads,0);
  model.find=async()=>({id,account_id:'owner',enabled:false,state:'COMPLETED',overlay_path:'private'});
  await assert.rejects(service.image('owner',id),{code:'NXDUET_UNAVAILABLE'});assert.equal(reads,0);
});
test('NXDuet worker refunds unusable provider output and never fabricates a completed asset',async()=>{
  let finish:any,puts=0;const model={claim:async()=>({id:'a'.repeat(32),lease_token:'token',source_path:'source',model:'synthetic'}),renew:async()=>1,finish:async(...args:any[])=>{finish=args;return true;}};
  const provider={generate:async()=>({bytes:await sharp({create:{width:512,height:512,channels:4,background:'#fff'}}).png().toBuffer()})};
  await new DuetWorker(model as never,{read:async()=>Buffer.from('synthetic-source'),put:async()=>{puts++;}} as never,provider as never).processOne();
  assert.equal(puts,0);assert.equal(finish[2],null);assert.equal(finish[3],'NXDUET_OVERLAY_INVALID');
});
test('NXDuet feature is unavailable by default and admin routes deny content manager before reads',async()=>{
  const app=createMigrationApp({} as never,{corsOrigins:[]});assert.equal((await request(app).get('/api/nxduet/capabilities')).body.enabled,false);assert.equal((await request(app).get('/api/nxduet/templates')).status,404);
  let reads=0;const auth={resolve:async()=>({role:'content_manager'}),requireRole:()=>{throw new AppError(403,'ADMIN_FORBIDDEN','Denied');}};
  const admin=express();admin.use(duetAdminRoutes({adminList:async()=>{reads++;}} as never,auth as never));admin.use((e:AppError,_q:express.Request,r:express.Response,_n:express.NextFunction)=>{r.sendStatus(e.status);});
  assert.equal((await request(admin).get('/templates')).status,403);assert.equal(reads,0);
});
test('NXDuet rejects references outside its dedicated namespace',async()=>{
  const files=new DuetFiles('/tmp/synthetic-nxduet-not-created');await assert.rejects(files.read('a'.repeat(32),'/etc/passwd','source'));assert.throws(()=>files.path('../escape','overlay'));
});
test('NXDuet private object namespace supports storage and blocks traversal or signed/public delivery',async()=>{
  const stored=new Map<string,Buffer>();
  const client={putObject:async(_bucket:string,key:string,bytes:Buffer)=>{stored.set(key,bytes);},getObject:async(_bucket:string,key:string)=>Readable.from([stored.get(key)!]),removeObject:async(_bucket:string,key:string)=>{stored.delete(key);}};
  const objects=new NativeObjectStorage(client as never,'synthetic-test-bucket'),files=new DuetFiles('/unused',objects),id='b'.repeat(32),bytes=await syntheticOverlay();
  const path=await files.put(id,'overlay',bytes);assert.equal(path,`minio://results/nxduet/${id}/overlay.png`);assert.deepEqual(await files.read(id,path,'overlay'),bytes);
  await assert.rejects(files.read('c'.repeat(32),path,'overlay'));await assert.rejects(objects.read(`minio://results/nxduet/${id}/../source.jpg`));await assert.rejects(objects.signedUrl(path));
  await files.remove(id,path,'overlay');assert.equal(stored.size,0);
});
test('NXDuet ambiguous completion retains the stored asset and avoids a contradictory refund',async()=>{
  let finishes=0,removes=0;
  const model={claim:async()=>({id:'a'.repeat(32),lease_token:'token',source_path:'source',model:'synthetic'}),finish:async()=>{finishes++;throw new Error('Synthetic ambiguous commit');}};
  const files={read:async()=>Buffer.from('synthetic-source'),put:async()=>'/synthetic-overlay',remove:async()=>{removes++;}};
  const provider={generate:async()=>({bytes:await syntheticOverlay(),provider:'synthetic-test',model:'synthetic-test',meta:{}})};
  await assert.rejects(new DuetWorker(model as never,files as never,provider as never).processOne(),{code:'NXDUET_COMPLETION_UNCERTAIN'});assert.equal(finishes,1);assert.equal(removes,0);
});
