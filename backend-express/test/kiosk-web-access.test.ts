import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {kioskAccessCookie,kioskProof} from '../src/routes/kiosk-web.routes.js';
import {AppError} from '../src/lib/errors.js';
import {createMigrationApp} from '../src/migration-app.js';
import {CustomerCookieSigner,accountCookie} from '../src/services/customer-credentials.service.js';
import type {CustomerAccountService} from '../src/services/customer-account.service.js';
import type {CustomerCatalogService} from '../src/services/customer-catalog.service.js';
import type {CustomerGenerationService} from '../src/services/customer-generation.service.js';
import type {CustomerUploadService} from '../src/services/customer-upload.service.js';
import type {CustomerResultService} from '../src/services/customer-result.service.js';
const signer=new CustomerCookieSigner('synthetic-kiosk-test-signing-key');
const accounts={signer,config:{cookieSecure:true,sessionDays:1},async google(token:string){if(token==='synthetic-invalid-google-token')throw new AppError(401,'GOOGLE_AUTH_INVALID','Invalid identity');const owner=token==='synthetic-verified-google-token';return {account:{email:owner?'firzadillah0192@gmail.com':'other@example.invalid'},cookie:signer.sign(owner?'owner':'other')}},async resolve(cookies:Record<string,unknown>){const raw=signer.unsign(cookies[accountCookie]);return {account:raw==='owner'?{id:'owner',email:'firzadillah0192@gmail.com'}:raw==='other'?{id:'other',email:'other@example.invalid'}:null,guest:null}}} as unknown as CustomerAccountService;
const cookie=(id:string)=>{const value=signer.sign(id);return `${accountCookie}=${value}; ${kioskAccessCookie}=${signer.sign(kioskProof(value))}`;};
const catalog={async templates(){return{templates:[{id:'t',name:'Template'}]}},async layouts(){return[]},async experiences(){return{experiences:[]}},async styles(){return[]}} as unknown as CustomerCatalogService;
const generationFixture={async create(body:unknown,identity:{account:{id:string}},key:unknown){assert.equal(identity.account.id,'owner');assert.equal(key,'fixture-key');return {job_id:'job-fixture',state:'QUEUED',request:body}},async status(){return{job_id:'job-fixture',state:'COMPLETED',result_id:'result-fixture'}}} as unknown as CustomerGenerationService;
const app=createMigrationApp(catalog,{corsOrigins:[]},accounts,{} as CustomerResultService,{} as CustomerUploadService,generationFixture);
test('kiosk requires a valid signed owner session; client email cannot authorize',async()=>{
 await request(app).get('/api/kiosk/access').expect(401);
 await request(app).get('/api/kiosk/access').set('Cookie',`${accountCookie}=owner`).set('X-Email','firzadillah0192@gmail.com').expect(401);
 await request(app).get('/api/kiosk/access').set('Cookie',cookie('expired')).expect(401);
 await request(app).get('/api/kiosk/access').set('Cookie',cookie('other')).expect(403);
 await request(app).get('/api/kiosk/access').set('Cookie',`${accountCookie}=${signer.sign('owner')}`).expect(403);
 await request(app).get('/api/kiosk/access').set('Cookie',`${accountCookie}=${signer.sign('owner')}; ${kioskAccessCookie}=${signer.sign(kioskProof(signer.sign('other')))}`).expect(403);
 await request(app).get('/api/kiosk/access').set('Cookie',cookie('owner')).expect(200).expect(r=>assert.equal(r.body.allowed,true));
});
test('kiosk upload/generation/result/session reject unauthorized before handlers, public catalog preserved',async()=>{
 for(const path of ['/api/kiosk/web/templates','/api/kiosk/web/results/result/image','/api/kiosk/web/generations/job'])await request(app).get(path).expect(401);
 for(const path of ['/api/kiosk/web/uploads','/api/kiosk/web/results/result/claim','/api/kiosk/web/generations','/api/kiosk/web/kiosk/session','/api/kiosk/session']){
  await request(app).post(path).send({email:'firzadillah0192@gmail.com'}).expect(401);
  await request(app).post(path).set('Cookie',cookie('other')).send({email:'firzadillah0192@gmail.com'}).expect(403);
 }
 await request(app).get('/api/kiosk/web/templates').set('Cookie',cookie('owner')).expect(200).expect(r=>assert.equal(r.body.templates[0].id,'t'));
 await request(app).get('/api/templates').expect(200);
 await request(app).post('/api/kiosk/web/generations').set('Cookie',cookie('owner')).set('Origin','https://evil.invalid').send({}).expect(403);
});

test('authorized kiosk routes invoke the existing generation controller with signed identity and idempotency key',async()=>{
 await request(app).post('/api/kiosk/web/generations').set('Cookie',cookie('owner')).set('Idempotency-Key','fixture-key').send({mode:'CLASSIC',upload_id:'upload-1'}).expect(202).expect(r=>assert.equal(r.body.state,'QUEUED'));
 await request(app).get('/api/kiosk/web/generations/job-fixture').set('Cookie',cookie('owner')).expect(200).expect(r=>assert.equal(r.body.state,'COMPLETED'));
});

test('Google entry grants HttpOnly kiosk proof bound to verified account session; other identity/token denied',async()=>{
 await request(app).post('/api/kiosk/login/google').send({id_token:'synthetic-invalid-google-token'}).expect(401);
 const denied=await request(app).post('/api/kiosk/login/google').send({id_token:'synthetic-other-google-token'}).expect(403);assert.equal(denied.headers['set-cookie'],undefined);
 const signed=await request(app).post('/api/kiosk/login/google').send({id_token:'synthetic-verified-google-token'}).expect(200);
 const cookies=signed.headers['set-cookie'] as unknown as string[];assert.ok(cookies.every(c=>c.includes('HttpOnly')&&c.includes('Secure')&&c.includes('SameSite=Lax')));assert.ok(cookies.some(c=>c.includes('Path=/api/kiosk')));
 await request(app).get('/api/kiosk/access').set('Cookie',cookies.map(c=>c.split(';')[0]).join('; ')).expect(200);
});

test('authorized kiosk claim delegates to owned result service with kiosk session identity',async()=>{
 const token='q'.repeat(43),url='https://nxbooth.gennexbyte.com/r/'+token
 const results={async createClaim(id:string,identity:{account:{id:string}},input:{kioskSessionId:string|null;refresh:boolean;reuseToken?:string|null}){assert.equal(id,'result-fixture');assert.equal(identity.account.id,'owner');assert.equal(typeof input.kioskSessionId,'string');assert.equal(input.refresh,false);assert.equal(input.reuseToken,token);return{claim_url:url,qr_payload:url,expires_at:new Date(Date.now()+86400000).toISOString()}}} as unknown as CustomerResultService
 const claimApp=createMigrationApp(catalog,{corsOrigins:[]},accounts,results)
 await request(claimApp).post('/api/kiosk/web/results/result-fixture/claim').set('Cookie',cookie('owner')).send({kiosk:true,reuse_token:token}).expect(200).expect(r=>assert.equal(r.body.qr_payload,url))
})
