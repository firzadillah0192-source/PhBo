import { NativeImageEngineService } from '../src/services/native-image-engine.service.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import sharp from 'sharp';
import { NativeNineRouterProvider, NativeNullProvider, responseOperationalMeta } from '../src/services/native-provider.service.js';
import { GoogleIdentityService } from '../src/services/google-identity.service.js';
import { NativeWorkerLoop } from '../src/services/native-worker-loop.service.js';
import { NativeRateLimitService } from '../src/services/native-rate-limit.service.js';
import { estimateImagePrice } from '../src/services/image-pricing.service.js';
import type { NxProviderRun } from '@prisma/client';
import express from 'express';
import request from 'supertest';

const config={baseUrl:'https://router.test/v1',key:'test-only-secret',timeoutMs:1000,resultOrigins:['https://images.test']};
test('Basic sends template first and identity second, with template canvas and no duplicate image', async () => {
  const template = await sharp({create:{width:1024,height:1536,channels:3,background:'gold'}}).png().toBuffer();
  const identity = await sharp({create:{width:640,height:480,channels:3,background:'blue'}}).jpeg().toBuffer();
  let calls = 0;
  const provider = new NativeNineRouterProvider(config, async (_url, options) => {
    calls++;
    const body = JSON.parse(String(options?.body));
    assert.equal(body.image, undefined);
    assert.deepEqual(body.images, [`data:image/png;base64,${template.toString('base64')}`, `data:image/jpeg;base64,${identity.toString('base64')}`]);
    assert.equal(body.size, '1024x1536'); assert.equal(body.model, 'unchanged-model');
    return new Response(JSON.stringify({data:[{b64_json:template.toString('base64')}]}));
  });
  await provider.generate(identity, 'Only edit Image 1 face using Image 2 identity', 'unchanged-model', {bytes:template,width:1024,height:1536});
  assert.equal(calls, 1);
  await assert.rejects(provider.generate(null, 'prompt', 'unchanged-model', {bytes:template,width:1024,height:1536}), {code:'BASIC_INPUT_INVALID'});
  assert.equal(calls, 1);
});
test('native provider preserves configured model, one call, normalized photo and composed prompt',async()=>{
  const bytes=await sharp({create:{width:64,height:96,channels:3,background:'blue'}}).png().toBuffer();
  const photo=await sharp(bytes).jpeg().toBuffer();let calls=0;
  const provider=new NativeNineRouterProvider(config,async(url,options)=>{calls++;assert.equal(url,'https://router.test/v1/images/generations');assert.equal(new Headers(options?.headers).get('authorization'),'Bearer test-only-secret');const body=JSON.parse(String(options?.body));assert.deepEqual(body,{model:'experience-model',prompt:'Experience + frame + composition + branding',size:'1024x1024',n:1,response_format:'b64_json',image:`data:image/jpeg;base64,${photo.toString('base64')}`});return new Response(JSON.stringify({data:[{b64_json:bytes.toString('base64')}],model:'untrusted-body-model',usage:{total_tokens:999}}),{headers:{'content-type':'application/json','x-9router-model':'reported-model','x-9router-request-id':'router-request','x-9router-input-tokens':'120','x-9router-output-tokens':'80','x-9router-attempt-count':'1'}});});
  const result=await provider.generate(photo,'Experience + frame + composition + branding','experience-model');assert.equal(calls,1);assert.deepEqual(result.bytes,bytes);assert.equal(result.model,'reported-model');assert.equal(result.meta.router_request_id,'router-request');assert.deepEqual(result.meta.usage,{input_tokens:120,output_tokens:80});assert.equal(result.meta.total_tokens,undefined);
});
test('native provider accepts JSON, SSE and trusted URL results without stretching',async()=>{
  const jpeg=await sharp({create:{width:120,height:80,channels:3,background:'red'}}).jpeg().toBuffer();
  for(const kind of ['json','sse','url']){let calls=0;const provider=new NativeNineRouterProvider(config,async()=>{calls++;if(kind==='url'&&calls===2)return new Response(new Uint8Array(jpeg));const payload=JSON.stringify({data:[kind==='url'?{url:'https://images.test/result.jpg'}:{b64_json:jpeg.toString('base64')}]});return new Response(kind==='sse'?`data: ${payload}\n\ndata: [DONE]\n`:payload,{headers:{'content-type':kind==='sse'?'text/event-stream':'application/json'}});});const result=await provider.generate(null,'Prompt','model');const info=await sharp(result.bytes).metadata();assert.deepEqual([info.width,info.height,info.format],[120,80,'png']);assert.equal(result.model,'model');assert.equal(result.meta.usage,undefined);assert.equal(calls,kind==='url'?2:1);}
});
test('native provider rejects unavailable, malformed, empty, HTTP failure and untrusted URLs',async()=>{
  await assert.rejects(new NativeNullProvider().generate(),{code:'AI_PROVIDER_NOT_CONNECTED'});
  for(const [body,status] of [['{}',200],['invalid',200],[JSON.stringify({data:[{b64_json:'broken!'}]}),200],[JSON.stringify({data:[{url:'http://127.0.0.1/secrets'}]}),200],['secret provider detail',500]] as const){const provider=new NativeNineRouterProvider(config,async()=>new Response(body,{status}));await assert.rejects(provider.generate(null,'Prompt','model'),error=>{assert.ok(error instanceof Error);assert.ok(!error.message.includes('secret provider detail'));return true;});}
  const offline=new NativeNineRouterProvider(config,async()=>{throw new Error('authorization secret');});await assert.rejects(offline.generate(null,'Prompt','model'),{code:'AI_PROVIDER_ERROR'});
});
test('provider evidence excludes negative/fractional counters and preserves zero usage',()=>{
  const meta=responseOperationalMeta(new Headers({'x-9router-input-tokens':'0','x-9router-attempt-count':'-1','x-9router-retry-count':'1.5','x-9router-reported-cost':'NaN','x-9router-total-tokens':'999999999999999999999'}));assert.deepEqual(meta,{input_tokens:0,usage:{input_tokens:0}});
});
test('Google verifier validates real RSA signatures, audience, expiry and verified email',async()=>{
  const keys=generateKeyPairSync('rsa',{modulusLength:2048});const cert=keys.publicKey.export({format:'pem',type:'spki'}).toString();const client=new OAuth2Client();
  // Substitute certificate retrieval only; Google library performs the actual
  // JWT signature/audience/time validation. No live OAuth tokens are used.
  client.getFederatedSignonCertsAsync=async()=>({certs:{test:cert},format:'PEM'} as Awaited<ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>>);
  const verifier=new GoogleIdentityService('candidate-client',client);const now=Math.floor(Date.now()/1000);
  const token=(overrides:object={},badSignature=false)=>{const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');const payload=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',sub:'synthetic-google-user',aud:'candidate-client',iat:now-60,exp:now+600,email:' Demo@Example.COM ',email_verified:true,name:'Demo',...overrides})).toString('base64url');const input=`${header}.${payload}`;return `${input}.${sign('RSA-SHA256',Buffer.from(input),keys.privateKey).toString('base64url')}${badSignature?'broken':''}`;};
  assert.deepEqual(await verifier.verify(token()),{subject:'synthetic-google-user',email:'demo@example.com',name:'Demo',avatar_url:null});
  for(const value of [token({aud:'wrong'}),token({exp:now-900,iat:now-1800}),token({email_verified:false}),token({iss:'https://malicious.test'}),token({},true)])await assert.rejects(verifier.verify(value),{code:'GOOGLE_TOKEN_INVALID'});
});
test('native worker loop maintains durable jobs, ignores invalid queue IDs and stops gracefully',async()=>{
  const processed:string[]=[];let maintained=0;const ids=['bad-id','a'.repeat(32)];let loop:NativeWorkerLoop;
  loop=new NativeWorkerLoop({async dequeue(){const id=ids.shift()??null;if(!id)loop.stop();return id;},async close(){}},async id=>{processed.push(id);},async()=>{maintained++;});await loop.run();assert.deepEqual(processed,['a'.repeat(32)]);assert.equal(maintained,1);
});
test('distributed result limits share counters and fall back safely when Redis fails',async()=>{
  const counters=new Map<string,number>();let fail=false;const store={async window(key:string){if(fail)throw new Error();const count=(counters.get(key)||0)+1;counters.set(key,count);return count;}};
  const app=express();app.get('/one',new NativeRateLimitService(store).middleware('claim',2),(_req,res)=>res.sendStatus(200));app.get('/two',new NativeRateLimitService(store).middleware('claim',2),(_req,res)=>res.sendStatus(200));
  await request(app).get('/one').expect(200);await request(app).get('/two').expect(200);await request(app).get('/one').expect(429);fail=true;await request(app).get('/one').expect(200);await request(app).get('/one').expect(200);await request(app).get('/one').expect(429);
});
test('pricing comparison preserves unavailable and simulation distinction',()=>{
  const run={provider_reported_model:'cx/gpt-image-2.5',requested_model:null,provider_model:null,input_tokens:100,output_tokens:50,input_text_tokens:null,input_image_tokens:null,output_image_tokens:null} as NxProviderRun;
  assert.equal(estimateImagePrice(run).status,'simulation');assert.equal(estimateImagePrice(run).low_usd,0.002);assert.equal(estimateImagePrice(run).high_usd,0.0023);assert.equal(estimateImagePrice({...run,provider_reported_model:'unknown'}).status,'unavailable');assert.equal(estimateImagePrice({...run,input_text_tokens:80,input_image_tokens:20,output_image_tokens:50}).status,'image_token_estimate');
});


test('template and generated face failures preserve their stage without blaming the uploaded photo', async () => {
  for (const code of ['BASIC_TEMPLATE_FACE_NOT_FOUND','BASIC_EDIT_FACE_NOT_FOUND']) {
    const engine=new NativeImageEngineService('https://helper.test','test-key',async()=>new Response(JSON.stringify({detail:{error_code:code}}),{status:422}));
    await assert.rejects(engine.basicTemplate(Buffer.from('fixture')),error=>{
      assert.equal((error as {code:string}).code,code);
      assert.ok(error instanceof Error);assert.doesNotMatch(error.message,/another photo/i);
      return true;
    });
  }
});
