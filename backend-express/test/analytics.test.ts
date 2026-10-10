import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {installAnalytics,safeAnalyticsEvent} from '../src/services/analytics.service.js';
test('server generation events share browser identity and exclude request data',async()=>{
 const events:any[]=[];const app=express();app.use(express.json());
 installAnalytics(app,{capture:(e:any)=>events.push(e),captureException:()=>{}} as any);
 app.post('/api/generations',(_req,res)=>res.status(202).json({job_id:'job-test',state:'QUEUED'}));
 await request(app).post('/api/generations').set('X-POSTHOG-DISTINCT-ID','browser-test').set('X-POSTHOG-SESSION-ID','session-test').send({email:'secret@example.invalid',image:'secret-photo'}).expect(202);
 assert.equal(events.length,2);assert.equal(events[1].distinctId,'browser-test');assert.equal(events[1].properties.$session_id,'session-test');assert.doesNotMatch(JSON.stringify(events),/secret/);
});
test('analytics exceptions cannot turn successful request into failure',async()=>{
 const app=express();installAnalytics(app,{capture:()=>{throw Error('offline')},captureException:()=>{}} as any);
 app.post('/api/uploads',(_req,res)=>res.status(201).json({upload_id:'upload-test'}));
 await request(app).post('/api/uploads').set('X-POSTHOG-DISTINCT-ID','browser-test').expect(201);
});
for(const base of ['/api','/api/kiosk/web'])test(`mounted ${base} routes capture acceptance and terminal polling once`,async()=>{
 const events:any[]=[];const app=express();app.use(express.json());
 installAnalytics(app,{capture:(e:any)=>events.push(e),captureException:()=>{}} as any);
 const router=express.Router();
 router.post('/generations',(_req,res)=>res.status(202).json({job_id:`mounted-${base}`,state:'QUEUED'}));
 router.get('/generations/:id',(_req,res)=>res.json({job_id:`mounted-${base}`,state:'COMPLETED'}));
 app.use(base,router);
 await request(app).post(base+'/generations?private=secret').set('X-POSTHOG-DISTINCT-ID','browser-mounted').send({image:'secret-photo'}).expect(202);
 await request(app).get(base+'/generations/job?_request=secret').set('X-POSTHOG-DISTINCT-ID','browser-mounted').expect(200);
 await request(app).get(base+'/generations/job?_request=secret').set('X-POSTHOG-DISTINCT-ID','browser-mounted').expect(200);
 const queued=events.filter(e=>e.event==='phbo_generation_queued');
 const completed=events.filter(e=>e.event==='phbo_generation_status_completed');
 assert.equal(queued.length,1);assert.equal(completed.length,1);
 assert.equal(queued[0].properties.surface,base.includes('kiosk')?'kiosk':'web');
 assert.equal(queued[0].properties.route,base+'/generations');
 assert.equal(completed[0].properties.route,base+'/generations/:id');
 assert.equal(completed[0].distinctId,'browser-mounted');
 assert.doesNotMatch(JSON.stringify(events),/secret/);
});
test('server exception sanitizer removes sensitive message and locals',()=>{
 const event=safeAnalyticsEvent({properties:{$exception_list:[{type:'Error',value:'private-photo',stacktrace:{frames:[{filename:'app.js?token=private',lineno:8,vars:{email:'private'}}]}}],email:'private'}});
 assert.equal(event.properties.$exception_list[0].stacktrace.frames[0].lineno,8);assert.doesNotMatch(JSON.stringify(event),/private|vars/);
});

import {createServer} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {backendAnalytics,shutdownAnalytics} from '../src/services/analytics.service.js';
test('real Node SDK delivers safe events and exception frames to collector',async()=>{
 const messages:any[]=[];
 const collector=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks);const payload=JSON.parse(body[0]===31?gunzipSync(body).toString():body.toString());messages.push(...payload.batch);res.writeHead(200,{'Content-Type':'application/json'});res.end('{"status":1}');});
 await new Promise<void>(resolve=>collector.listen(0,'127.0.0.1',resolve));
 const port=(collector.address() as any).port;
 process.env.POSTHOG_PROJECT_TOKEN='synthetic-test-token';process.env.POSTHOG_HOST='http://127.0.0.1:'+port;
 try{
  const sdk=backendAnalytics()!;
  sdk.capture({distinctId:'browser-test',event:'phbo_test_event',properties:{is_test:true,route:'/r/private-claim?secret=private',email:'private@example.invalid'}});
  sdk.captureException(new Error('private-photo-url'),'browser-test',{is_test:true});
  await shutdownAnalytics();
  assert.ok(messages.some(m=>m.event==='phbo_test_event'));
  assert.ok(messages.some(m=>m.event==='$exception'));
  assert.doesNotMatch(JSON.stringify(messages),/private|secret/);
 }finally{collector.close();delete process.env.POSTHOG_PROJECT_TOKEN;delete process.env.POSTHOG_HOST;}
});
