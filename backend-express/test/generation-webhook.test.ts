import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {webhookUrl,webhookPublicAddress,WebhookVault,webhookSignature,verifyWebhook,sendWebhook} from '../src/services/webhook-security.js';
import {GenerationWebhookService} from '../src/services/generation-webhook.service.js';
import {generationWebhookRoutes} from '../src/routes/generation-webhook.routes.js';
import {AppError} from '../src/lib/errors.js';
import {ZodError} from 'zod';
const vault=()=>new WebhookVault('v1',JSON.stringify({v1:randomBytes(32).toString('hex')}));
test('webhook URL rejects credentials, IPs, internal hosts, query, fragment and non HTTPS ports',()=>{
 for(const url of ['http://example.com','https://user:pw@example.com','https://127.0.0.1/x','https://[::1]/','https://example.com:8080','https://host.local','https://localhost','https://example.com/?token=secret','https://example.com/#fragment'])assert.throws(()=>webhookUrl(url));
 assert.equal(webhookUrl('https://example.com/hook'),'https://example.com/hook');
});
test('public destination allowlist blocks reserved IPv4, transition/mapped IPv6 and non-IP',()=>{
 for(const ip of ['0.0.0.0','10.1.2.3','127.1.2.3','169.254.169.254','100.64.0.1','172.16.0.1','192.168.1.1','192.0.2.1','198.18.1.1','198.51.100.1','203.0.113.1','224.0.0.1','240.0.0.1','::','::1','::ffff:8.8.8.8','::ffff:7f00:1','64:ff9b::7f00:1','2001:0000::1','2001:2::1','2001:db8::1','2002:7f00:1::1','fd00::1','fe80::1','ff00::1','3ffe::1','3fff::1','not-ip'])assert.equal(webhookPublicAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(webhookPublicAddress(ip),true,ip);
});
test('secret vault authenticates endpoint context and supports retained key versions',()=>{
 const first=randomBytes(32).toString('hex'),second=randomBytes(32).toString('hex'),old=new WebhookVault('v1',JSON.stringify({v1:first})),next=new WebhookVault('v2',JSON.stringify({v1:first,v2:second}));const blob=old.encrypt('synthetic-secret','endpoint-a');assert.ok(!blob.includes('synthetic-secret'));assert.equal(next.decrypt(blob,'endpoint-a'),'synthetic-secret');assert.throws(()=>next.decrypt(blob,'endpoint-b'));assert.throws(()=>next.decrypt(blob+'x','endpoint-a'));assert.throws(()=>new WebhookVault('v1','{}'));
});
test('signature validates raw bytes and rejects replay timestamps, tampering, malformed headers',()=>{
 const now=Date.now(),ts=String(Math.floor(now/1000)),body='{"id":"synthetic"}',s=webhookSignature('fixture',ts,body);assert.ok(verifyWebhook('fixture',ts,body,s,now));assert.ok(!verifyWebhook('fixture',ts,body+' ',s,now));assert.ok(!verifyWebhook('fixture',ts,body,s,now+301000));assert.ok(!verifyWebhook('fixture',ts,body,'v1=x',now));assert.ok(!verifyWebhook('fixture','NaN',body,s,now));
});
test('blocked transport returns a safe error without connecting to a private destination',async()=>{assert.deepEqual(await sendWebhook('https://127.0.0.1/','{}',{}),{status:null,error:'DESTINATION_BLOCKED'});});
test('dispatcher signs immutable event and records success, stale endpoint cancels before send',async()=>{
 const v=vault(),delivery={id:'e'.repeat(32),endpoint_id:'endpoint',target_url:'https://example.com/hook',payload:'{"id":"fixture"}'},endpoint={id:'endpoint',encrypted_secret:v.encrypt('fixture-secret','endpoint')};let credential:unknown=endpoint,sends=0,finished:unknown[]=[];const model={claim:async()=>delivery,credential:async()=>credential,cancel:async()=>finished.push('cancelled'),finish:async(...args:unknown[])=>finished.push(args)};
 const service=new GenerationWebhookService(model as never,v,async(url,body,headers)=>{sends++;assert.equal(url,delivery.target_url);assert.equal(body,delivery.payload);assert.ok(verifyWebhook('fixture-secret',headers['X-NXBooth-Timestamp']!,body,headers['X-NXBooth-Signature']!));assert.equal(headers['X-NXBooth-Event-Id'],delivery.id);return {status:204,error:null};});await service.dispatchOne();assert.equal(sends,1);assert.equal((finished[0] as unknown[])[1],204);credential=null;await service.dispatchOne();assert.equal(sends,1);assert.equal(finished[1],'cancelled');
});
test('webhook routes are cookie-owner only, return no-store and validate account/key/body selectors',async()=>{
 const observed:string[]=[],endpoint={id:'e'.repeat(32),key_id:'a'.repeat(16),account_id:'owner',url:'https://example.com/hook',enabled:true,events:['generation.failed'],encrypted_secret:'NEVER_EXPOSE',version:1};const model={endpoint:async(account:string)=>{observed.push(account);return endpoint;},save:async()=>({created:false,endpoint})};const service=new GenerationWebhookService(model as never,vault());const app=express();app.use(express.json());app.use(cookieParser());app.use('/keys',generationWebhookRoutes(service,{resolve:async(c:Record<string,string>)=>({account:c.owner?{id:c.owner}:null})} as never));app.use((e:unknown,_q:express.Request,r:express.Response,_n:express.NextFunction)=>r.status(e instanceof AppError?e.status:e instanceof ZodError?422:500).json({error:true}));const path='/keys/'+'a'.repeat(16)+'/webhook';await request(app).get(path).set('Authorization','Bearer fixture').expect(401);const r=await request(app).get(path).set('Cookie','owner=owner').expect(200);assert.match(r.headers['cache-control'],/no-store/);assert.ok(!JSON.stringify(r.body).includes('NEVER_EXPOSE'));assert.deepEqual(observed,['owner']);await request(app).put(path).set('Cookie','owner=owner').send({url:'http://private',enabled:true,events:['generation.failed']}).expect(422);await request(app).put(path).set('Cookie','owner=owner').send({url:'https://example.com',enabled:true,events:['generation.failed'],account_id:'foreign'}).expect(422);await request(app).get('/keys/notvalid/webhook').set('Cookie','owner=owner').expect(422);
});

test('transport pins validated DNS, rejects mixed/private answers on every retry and never follows redirect',async()=>{
 const {EventEmitter}=await import('node:events');let calls=0,resolutions=0;
 const request=((url:URL,options:Record<string,unknown>,cb:(res:unknown)=>void)=>{calls++;assert.equal(url.hostname,'example.com');assert.equal(options.agent,false);const lookup=options.lookup as (host:string,opts:object,cb:(e:unknown,ip:string,family:number)=>void)=>void;lookup('example.com',{},(error,ip,family)=>{assert.equal(error,null);assert.equal(ip,'8.8.8.8');assert.equal(family,4)});const req=new EventEmitter() as import('node:events').EventEmitter&{destroy:()=>void;end:()=>void};req.destroy=()=>{};req.end=()=>queueMicrotask(()=>cb({statusCode:302,headers:{location:'http://127.0.0.1/private'},destroy:()=>{}}));return req;}) as never;
 const resolve=async()=>{resolutions++;return resolutions===1?[{address:'8.8.8.8',family:4}]:[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}];};
 assert.deepEqual(await sendWebhook('https://example.com/hook','{}',{}, {resolve,request}),{status:302,error:'HTTP_ERROR'});assert.deepEqual(await sendWebhook('https://example.com/hook','{}',{}, {resolve,request}),{status:null,error:'DESTINATION_BLOCKED'});assert.equal(calls,1);assert.equal(resolutions,2);
});
test('transport bounds stalled requests without recording arbitrary error messages or bodies',async()=>{
 const {EventEmitter}=await import('node:events');let destroyed=false;const request=(()=>{const req=new EventEmitter() as import('node:events').EventEmitter&{destroy:()=>void;end:()=>void};req.destroy=()=>{destroyed=true;req.emit('error',Error('do not expose request secrets'));};req.end=()=>{};return req;}) as never;
 assert.deepEqual(await sendWebhook('https://example.com/hook','{}',{}, {resolve:async()=>[{address:'8.8.8.8',family:4}],request,timeoutMs:5}),{status:null,error:'TIMEOUT'});assert.ok(destroyed);
});
