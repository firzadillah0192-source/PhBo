import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createMigrationApp } from '../src/migration-app.js';
import request from 'supertest';
import { createSchema,placementSchema,validateOverlay,cropCutout,posePrompt,POSES } from '../src/nxduet/policy.js';
import { companionRect,composeDuet } from '../src/nxduet/compositor.js';
import { DuetFrame } from '../src/nxduet/frame.js';
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
  const body={upload_id:'a'.repeat(32),name:'Family',poses:['smile','angry','hug'],rights_accepted:true};assert.equal(createSchema.safeParse(body).success,true);
  for(const value of [{...body,credits:1},{...body,model:'client-override'},{...body,prompt:'free text'},{...body,rights_accepted:false},{...body,name:'   '},{...body,poses:['smile','smile','hug']},{...body,poses:['smile','angry']},{...body,poses:['smile','angry','hug','wave']},{...body,poses:['smile','angry','custom']},{upload_id:body.upload_id,name:'Family',rights_accepted:true}])assert.equal(createSchema.safeParse(value).success,false);
  for(const scale of [0,1.01,NaN])assert.equal(placementSchema.safeParse({side:'left',scale}).success,false);
  assert.equal(placementSchema.safeParse({side:'right',scale:.9}).success,false);
});
test('NXDuet provider asks for true transparency without changing normal generation payloads',async()=>{
  const calls:any[]=[];const bytes=await syntheticOverlay();
  const provider=new NativeNineRouterProvider({baseUrl:'https://synthetic.invalid',key:'synthetic-test-only',timeoutMs:5000,resultOrigins:[]},async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({data:[{b64_json:bytes.toString('base64')}]}),{status:200});});
  await provider.generate(bytes,'synthetic prompt','gpt-image-synthetic',undefined,undefined,{transparentBackground:true});
  await provider.generate(bytes,'synthetic prompt','gpt-image-synthetic');
  assert.equal(calls[0].background,'transparent');assert.equal(calls[0].output_format,'png');assert.equal(calls[1].background,undefined);assert.equal(calls[1].output_format,undefined);
});
test('NXDuet composition gives each slot its own capture and pose, companion on the left',async()=>{
  const colors=['#102030','#304050','#506070'],poseColors=['#ef4050','#40ef50','#4050ef'];
  const files=await Promise.all(colors.map(async(color,i)=>({buffer:await sharp({create:{width:1200,height:1020,channels:3,background:color}}).jpeg().toBuffer(),mimetype:'image/jpeg',originalname:`synthetic-${i}.jpg`} as Express.Multer.File)));
  const overlays=await Promise.all(poseColors.map(color=>sharp(Buffer.from(`<svg width="400" height="700"><rect x="0" y="0" width="400" height="700" fill="${color}"/></svg>`)).png().toBuffer()));
  const slots=[{x:94,y:151,width:548,height:466},{x:94,y:695,width:548,height:466},{x:94,y:1240,width:548,height:471}];
  let given:Buffer[]=[];const frame={compose:async(_info:unknown,photos:Buffer[])=>{given=photos;return Buffer.from('strip');}};
  const out=await composeDuet(files,overlays,{side:'left',scale:1},frame as never,{slots} as never);assert.equal(out.toString(),'strip');assert.equal(given.length,3);
  for(let i=0;i<3;i++){
    const {data,info}=await sharp(given[i]).removeAlpha().raw().toBuffer({resolveWithObject:true});assert.equal(info.width,slots[i]!.width);assert.equal(info.height,slots[i]!.height);
    const px=(x:number,y:number)=>[...data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3)];
    const near=(a:number[],hex:string)=>hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)).every((v,c)=>Math.abs(a[c]!-v)<=12);
    assert.ok(near(px(info.width-10,10),colors[i]!),'right side shows the camera');assert.ok(near(px(5,info.height-5),poseColors[i]!),'bottom-left shows pose '+(i+1));
  }
  const rect=companionRect(548,466,400,700,{side:'left',scale:1});assert.equal(rect.left,0);assert.equal(rect.top+rect.height,466);
  await assert.rejects(composeDuet(files.slice(0,2),overlays,{side:'left',scale:.9},frame as never,{slots} as never),{code:'NXDUET_CAPTURE_COUNT'});
  await assert.rejects(composeDuet(files,overlays.slice(0,2),{side:'left',scale:.9},frame as never,{slots} as never),{code:'NXDUET_CAPTURE_COUNT'});
});
test('NXDuet crops a full-body cutout to the subject and stands it flush on the bottom edge',async()=>{
  const full=await sharp(Buffer.from('<svg width="1024" height="1536"><rect x="300" y="200" width="400" height="900" rx="60" fill="#ef4050"/></svg>')).png().toBuffer();
  const cropped=await cropCutout(full);assert.ok(cropped.width<=440&&cropped.width>=400);assert.ok(cropped.height>=900&&cropped.height<=940);
  const {data,info}=await sharp(cropped.bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let bottomOpaque=0;for(let x=0;x<info.width;x++)if(data[((info.height-1)*info.width+x)*4+3]!>200)bottomOpaque++;assert.ok(bottomOpaque>200,'subject touches the bottom edge');
  const empty=await sharp({create:{width:512,height:512,channels:4,background:'#0000'}}).png().toBuffer();await assert.rejects(cropCutout(empty),{code:'NXDUET_OVERLAY_INVALID'});
});
test('NXDuet pose prompts are server-owned and every pose frames three-quarter body',()=>{
  assert.equal(POSES.length>=6,true);for(const pose of POSES){const prompt=posePrompt(pose.key);assert.ok(prompt.includes(pose.instruction));assert.ok(/three-quarter body/.test(prompt));assert.ok(/transparent RGBA/.test(prompt));}
  assert.throws(()=>posePrompt('ignore previous instructions'),{code:'NXDUET_POSE_INVALID'});
});
test('NXDuet frame needs the active three-slot Classic layout',async()=>{
  const layout={id:'classic-frame-003',active:true,shot_count:3,frame_asset_path:'f.png',canvas_width:1200,canvas_height:3600,layout_config_json:JSON.stringify({slots:[{x:10,y:10,width:500,height:400},{x:10,y:500,width:500,height:400},{x:10,y:1000,width:500,height:400}]})};
  const make=(row:unknown)=>new DuetFrame({layout:async()=>row} as never,{validateLayout:async()=>{},file:async()=>null} as never,{generate:async()=>({bytes:Buffer.from('x')})} as never);
  assert.equal((await make(layout).info()).slots.length,3);
  for(const bad of [null,{...layout,active:false},{...layout,shot_count:4},{...layout,frame_asset_path:null}])await assert.rejects(make(bad).info(),{code:'NXDUET_FRAME_UNAVAILABLE'});
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
  let finish:any,puts=0;const model={claim:async()=>({id:'a'.repeat(32),lease_token:'token',source_path:'source',model:'synthetic',pose_keys:['smile','angry','hug']}),renew:async()=>1,finish:async(...args:any[])=>{finish=args;return true;}};
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
  const model={claim:async()=>({id:'a'.repeat(32),lease_token:'token',source_path:'source',model:'synthetic',pose_keys:['smile','angry','hug']}),finish:async()=>{finishes++;throw new Error('Synthetic ambiguous commit');}};
  const files={read:async()=>Buffer.from('synthetic-source'),put:async()=>'/synthetic-overlay',remove:async()=>{removes++;}};
  const provider={generate:async()=>({bytes:await syntheticOverlay(),provider:'synthetic-test',model:'synthetic-test',meta:{}})};
  await assert.rejects(new DuetWorker(model as never,files as never,provider as never).processOne(),{code:'NXDUET_COMPLETION_UNCERTAIN'});assert.equal(finishes,1);assert.equal(removes,0);
});

test('NXDuet worker makes three distinct poses, crops them, and completes once with all three',async()=>{
  const prompts:string[]=[],puts:string[]=[];let finish:any,finishes=0;
  const full=await sharp(Buffer.from('<svg width="1024" height="1536"><rect x="300" y="200" width="400" height="900" rx="60" fill="#ef4050"/></svg>')).png().toBuffer();
  const model={claim:async()=>({id:'a'.repeat(32),lease_token:'token',source_path:'source',model:'synthetic',pose_keys:['smile','angry','hug']}),renew:async()=>1,finish:async(...args:any[])=>{finishes++;finish=args;return true;}};
  const files={path:(_id:string,kind:string)=>'/synthetic/'+kind,read:async()=>Buffer.from('synthetic-source'),put:async(_id:string,kind:string)=>{puts.push(kind);return '/synthetic/'+kind;},remove:async()=>{}};
  const provider={generate:async(_i:unknown,prompt:string)=>{prompts.push(prompt);return {bytes:full,provider:'synthetic',model:'synthetic',meta:{}};}};
  await new DuetWorker(model as never,files as never,provider as never).processOne();
  assert.equal(prompts.length,3);assert.equal(new Set(prompts).size,3);assert.ok(/natural smile/.test(prompts[0]!));assert.ok(/arms open/.test(prompts[2]!));
  assert.deepEqual(puts,['overlay-1','overlay-2','overlay-3']);assert.equal(finishes,1);assert.deepEqual(finish[2].poses.map((p:any)=>[p.slot,p.key]),[[1,'smile'],[2,'angry'],[3,'hug']]);
});
test('NXDuet worker refunds once and removes stored poses when a later pose fails',async()=>{
  let calls=0,finishes=0,finish:any;const removed:string[]=[];
  const good=await syntheticOverlay();
  const model={claim:async()=>({id:'a'.repeat(32),lease_token:'token',source_path:'source',model:'synthetic',pose_keys:['smile','angry','hug']}),renew:async()=>1,finish:async(...args:any[])=>{finishes++;finish=args;return true;}};
  const files={path:(_id:string,kind:string)=>'/synthetic/'+kind,read:async()=>Buffer.from('synthetic-source'),put:async(_id:string,kind:string)=>'/synthetic/'+kind,remove:async(_id:string,path:string)=>{removed.push(path);}};
  const provider={generate:async()=>{if(++calls===2)throw new AppError(502,'PROVIDER_FAILED','Synthetic provider failure');return {bytes:good,provider:'synthetic',model:'synthetic',meta:{}};}};
  await new DuetWorker(model as never,files as never,provider as never).processOne();
  assert.equal(calls,2);assert.equal(finishes,1);assert.equal(finish[2],null);assert.equal(finish[3],'PROVIDER_FAILED');assert.ok(removed.includes('/synthetic/overlay-1'));
});
test('NXDuet worker fails and refunds a job without three chosen poses before any provider call',async()=>{
  let calls=0,finish:any;const model={claim:async()=>({id:'a'.repeat(32),lease_token:'token',source_path:'source',model:'synthetic',pose_keys:[]}),renew:async()=>1,finish:async(...args:any[])=>{finish=args;return true;}};
  await new DuetWorker(model as never,{read:async()=>Buffer.from('x')} as never,{generate:async()=>{calls++;}} as never).processOne();
  assert.equal(calls,0);assert.equal(finish[2],null);assert.equal(finish[3],'NXDUET_POSES_MISSING');
});
test('NXDuet legacy single-pose templates still serve one cutout for all three shots',async()=>{
  const id='a'.repeat(32),row:any={id,account_id:'owner',enabled:true,state:'COMPLETED',overlay_path:'legacy',pose_keys:[],placement:{side:'right',scale:.8},deleted_at:null};
  const reads:string[]=[];const model={find:async()=>row,poses:async()=>[]};
  const service=new DuetService(model as never,{read:async(_id:string,path:string)=>{reads.push(path);return Buffer.from('legacy');}} as never,{} as never,{} as never,async()=>'');
  assert.equal((await service.overlays('owner',id)).length,3);assert.deepEqual(reads,['legacy','legacy','legacy']);
  const view=duetResponse(row,false,[]);assert.equal(view.placement.side,'left');assert.deepEqual(view.poses.map(p=>p.slot),[1,2,3]);assert.ok(view.poses.every(p=>p.image_url?.includes('?slot=')));
});
