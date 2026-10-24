import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {ZodError} from 'zod';
import {AppError} from '../src/lib/errors.js';
import {generationWebhookRoutes} from '../src/routes/generation-webhook.routes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {randomBytes} from 'node:crypto';
import {GenerationWebhookModel} from '../src/models/generation-webhook.model.js';
import {GenerationWebhookService} from '../src/services/generation-webhook.service.js';
import {WebhookVault,verifyWebhook} from '../src/services/webhook-security.js';
import {PublicApiKeyModel} from '../src/models/public-api-key.model.js';
import {PublicApiKeyService} from '../src/services/public-api-key.service.js';
import {CustomerGenerationModel} from '../src/models/customer-generation.model.js';
import {SubscriptionWalletModel} from '../src/models/subscription-wallet.model.js';
import {legacyId} from '../src/services/customer-credentials.service.js';
// Synthetic metadata only. Dedicated disposable DB is mandatory; no image/provider calls.
test('webhook PostgreSQL transactions, accounting, ownership, retry leases, cancellation and retention',async()=>{
 const url=process.env.WEBHOOK_TEST_DATABASE_URL;assert.ok(url&&new URL(url).pathname==='/nxbooth_photo_folder_test'&&new URL(url).username==='folder_test','Disposable DB required');
 const sql=new pg.Pool({connectionString:url}),db=new PrismaClient({adapter:new PrismaPg({connectionString:url})});
 try{await sql.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await sql.query(`
      CREATE TABLE accounts(id varchar(32) PRIMARY KEY,email text DEFAULT 'synthetic@example.invalid',password_hash text DEFAULT 'synthetic',display_name text,avatar_url text,status text DEFAULT 'active',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),last_login_at timestamptz,last_activity_at timestamptz,ai_quota_total int DEFAULT 0,ai_quota_used int DEFAULT 0,ai_quota_reserved int DEFAULT 0);
      CREATE TABLE guest_sessions(id varchar(64) PRIMARY KEY);
      CREATE TABLE credit_wallets(account_id varchar(32) PRIMARY KEY,free_remaining int,top_up_remaining int);
      CREATE TABLE subscription_plans(id varchar(64) PRIMARY KEY,code varchar(64) UNIQUE,name text,description text,monthly_ai_credits int,billing_period text,price_amount int,currency text,is_active boolean,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE subscriptions(id varchar(32) PRIMARY KEY,user_id varchar(32),plan_id varchar(64),status text,source text DEFAULT 'manual',starts_at timestamptz DEFAULT now(),current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean DEFAULT false,external_customer_id text,external_subscription_id text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE generation_jobs(id varchar(32) PRIMARY KEY, account_id varchar(32),guest_id varchar(64),kiosk_session_id varchar(32),event_id varchar(32),mode varchar(16),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),upload_id varchar(32),template_id varchar(128),experience_id varchar(128),layout_id varchar(32),capture_upload_ids_json text,frame_style_id varchar(128),ornament_ids_json text,engine_config_json text,worker_attempts int DEFAULT 0,state varchar(16),error_code varchar(64),error_message text,provider varchar(64),model varchar(128),started_at timestamptz,finished_at timestamptz);
      CREATE TABLE quota_reservations(id varchar(32) PRIMARY KEY,job_id varchar(32) UNIQUE,account_id varchar(32),guest_id varchar(64),amount int DEFAULT 0,status text DEFAULT 'RESERVED',created_at timestamptz DEFAULT now(),settled_at timestamptz);
      CREATE TABLE generation_credit_charges(job_id varchar(32) PRIMARY KEY,status text,credits int,calculation_json text,settled_at timestamptz);
      CREATE TABLE results(id varchar(32) PRIMARY KEY,job_id varchar(32) UNIQUE,deleted_at timestamptz,created_at timestamptz DEFAULT now(),template_id text DEFAULT '',storage_path text DEFAULT '',content_type text DEFAULT 'image/png',size_bytes int,width int DEFAULT 1024,height int DEFAULT 1536,sha256 text DEFAULT '',provider text,model text);
      CREATE TABLE admin_audit_log(id varchar(32) PRIMARY KEY,admin_actor_id text,action text,target_type text,target_id text,reason text,metadata_json text,created_at timestamptz DEFAULT now());
    CREATE TABLE generation_events(id varchar(32) PRIMARY KEY,job_id varchar(32),event_type text,detail text,metadata_json text,created_at timestamptz DEFAULT now());`);

 for(const file of ['015_native_worker_leases.sql','016_generation_request_idempotency.sql','023_duitku_sandbox_payments.sql','024_subscription_v2.sql','025_public_api_keys.sql','027_generation_webhooks.sql','027_generation_webhooks.sql'])await sql.query(await readFile(new URL('../../backend/migrations/'+file,import.meta.url),'utf8'));
 const owner='a'.repeat(32),other='b'.repeat(32);await sql.query('INSERT INTO accounts(id) VALUES($1),($2)',[owner,other]);
 const model=new GenerationWebhookModel(db),wallets=new SubscriptionWalletModel(db),jobs=new CustomerGenerationModel(db,3,wallets,undefined,model),keys=new PublicApiKeyService(new PublicApiKeyModel(db,true),'synthetic-pepper-'.repeat(4));
 const key=await keys.create(owner,{name:'Webhook test',scopes:['generations:create']}),second=await keys.create(owner,{name:'Retry key',scopes:['generations:create']});
 const vault=new WebhookVault('v1',JSON.stringify({v1:randomBytes(32).toString('hex')}));let requests=0,status=500;
 const service=new GenerationWebhookService(model,vault,async(url,body,headers)=>{requests++;assert.equal(url,'https://example.com/hook');assert.ok(verifyWebhook(secret,headers['X-NXBooth-Timestamp']!,body,headers['X-NXBooth-Signature']!));return {status,error:status===204?null:'HTTP_ERROR'};});
 const app=express();app.use(express.json());app.use(cookieParser());app.use('/api/account/api-keys',generationWebhookRoutes(service,{resolve:async(c:Record<string,string>)=>({account:c.owner?{id:c.owner}:null})} as never));app.use((e:unknown,_q:express.Request,r:express.Response,_n:express.NextFunction)=>r.status(e instanceof AppError?e.status:e instanceof ZodError?422:500).json({error:true}));
 const path='/api/account/api-keys/'+key.id+'/webhook',cookie='owner='+owner;
 await request(app).get(path).set('Authorization','Bearer synthetic').expect(401);await request(app).get(path).set('Cookie','owner='+other).expect(404);assert.equal((await request(app).get(path).set('Cookie',cookie).expect(200)).body.webhook,null);
 const input={url:'https://example.com/hook',enabled:true,events:['generation.completed','generation.failed']};const configured=(await request(app).put(path).set('Cookie',cookie).send(input).expect(200)).body,secret=configured.signing_secret!;
 await request(app).get(path+'/deliveries?account_id=foreign').set('Cookie',cookie).expect(422);await request(app).get(path+'/deliveries?state=INVALID').set('Cookie',cookie).expect(422);await request(app).put(path).set('Cookie',cookie).send({...input,url:'https://127.0.0.1/'}).expect(422);
assert.ok(secret);assert.ok(!JSON.stringify(await service.get(owner,key.id)).includes(secret));assert.equal((await service.save(owner,key.id,input)).signing_secret,undefined);
 await assert.rejects(service.get(other,key.id),{code:'API_KEY_NOT_FOUND'});await assert.rejects(service.rotate(other,key.id),{code:'API_KEY_NOT_FOUND'});
 await wallets.snapshot({account_id:owner,guest_id:null});await sql.query('UPDATE subscription_v2_wallets SET ai_top_up=1000 WHERE account_id=$1',[owner]);
 async function create(requestKey:string,k=key.id){const d={scope:'account:'+owner,key:requestKey,hash:'h'.repeat(64),integrationKeyId:k};return jobs.createOnce({id:legacyId(),account_id:owner,mode:'BASIC',upload_id:'fixture-upload',template_id:'fixture-template',state:'QUEUED'},d);}
 const first=await create('first'),retry=await create('first',second.id);assert.equal(first.job.id,retry.job.id);assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining,950);
 await jobs.queueFailed(first.job.id);await jobs.queueFailed(first.job.id);assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining,1000);
 let history=await service.history(owner,key.id,{});assert.equal(history.deliveries.length,1);const delivery=history.deliveries[0]!;assert.equal((await request(app).get(path+'/deliveries').set('Cookie',cookie).expect(200)).body.deliveries.length,1);await request(app).get(path+'/deliveries/'+delivery.id+'/attempts').set('Cookie','owner='+other).expect(404);assert.equal(delivery.event_type,'generation.failed');assert.equal((await service.history(owner,second.id,{})).deliveries.length,0);
 await assert.rejects(service.attempts(other,key.id,delivery.id),{code:'API_KEY_NOT_FOUND'});await assert.rejects(service.retry(other,key.id,delivery.id),{code:'API_KEY_NOT_FOUND'});
 assert.equal(await service.dispatchOne(),true);let attempts=await service.attempts(owner,key.id,delivery.id);assert.equal((attempts.attempts as unknown[]).length,1);assert.equal((await service.history(owner,key.id,{})).deliveries[0]!.state,'PENDING');assert.equal(requests,1);
 for(let n=0;n<4;n++){await sql.query('UPDATE integration_webhook_deliveries SET next_attempt_at=now() WHERE id=$1',[delivery.id]);await service.dispatchOne();}
 assert.equal((await service.history(owner,key.id,{})).deliveries[0]!.state,'EXHAUSTED');assert.equal(requests,5);await assert.rejects(service.retry(owner,key.id,delivery.id),{code:'WEBHOOK_RETRY_UNAVAILABLE'});
 await sql.query("UPDATE integration_webhook_deliveries SET updated_at=now()-interval '2 minutes' WHERE id=$1",[delivery.id]);await service.retry(owner,key.id,delivery.id);status=204;await service.dispatchOne();assert.equal(requests,6);assert.equal((await service.history(owner,key.id,{})).deliveries[0]!.state,'DELIVERED');
 const success=await create('success');await jobs.claim(success.job.id,'lease-success');const resultId=legacyId();assert.equal(await jobs.complete(success.job.id,{id:resultId,job_id:success.job.id,template_id:'fixture',storage_path:'synthetic-reference-no-image',content_type:'image/png',size_bytes:123,width:1024,height:1536,sha256:'f'.repeat(64)},'lease-success'),true);assert.equal(await jobs.complete(success.job.id,{id:legacyId(),job_id:success.job.id,template_id:'fixture',storage_path:'unused',content_type:'image/png',size_bytes:123,width:1024,height:1536,sha256:'f'.repeat(64)},'lease-success'),false);
 assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining,950);
 let claims=await Promise.all([model.claim(),model.claim()]);assert.equal(claims.filter(Boolean).length,1);const claim=claims.find(Boolean)!;assert.equal(claim.job_id,success.job.id);const raw=JSON.parse(claim.payload);assert.equal(raw.data.result_id,resultId);assert.equal(raw.data.credit_charge.status,'PAID');assert.ok(!claim.payload.includes('synthetic-reference'));
 await sql.query("UPDATE integration_webhook_deliveries SET lease_until=now()-interval '1 second' WHERE id=$1",[claim.id]);const reclaimed=(await model.claim())!;assert.notEqual(reclaimed.lease_token,claim.lease_token);assert.equal(await model.finish(claim,204,null,1),false);assert.equal(await model.finish(reclaimed,204,null,1),true);
 const fail=await create('fail');await jobs.claim(fail.job.id,'lease-fail');await jobs.fail(fail.job.id,'SYNTHETIC_FAILURE','fixture','lease-fail');
 const exhausted=await create('exhausted');await sql.query('UPDATE generation_jobs SET worker_attempts=3 WHERE id=$1',[exhausted.job.id]);assert.equal(await jobs.claim(exhausted.job.id,'lease-exhausted'),null);
 const queued=await service.history(owner,key.id,{});assert.equal(queued.deliveries.length,4);assert.equal(queued.deliveries.filter(d=>d.state==='PENDING').length,2);
 // Rollback includes terminal state, refund and outbox: synthetic transaction abort.
 const rollback=await create('rollback'),reservedBalance=(await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining;
 const broken=new CustomerGenerationModel(db,3,wallets,undefined,{terminalIn:async(tx:Parameters<GenerationWebhookModel['terminalIn']>[0],id:string)=>{await model.terminalIn(tx,id);throw Error('test rollback');}} as never);
 await assert.rejects(broken.queueFailed(rollback.job.id),/test rollback/);assert.equal((await jobs.find(rollback.job.id))!.state,'QUEUED');assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining,reservedBalance);assert.equal((await service.history(owner,key.id,{})).deliveries.length,4);
 const rotated=await service.rotate(owner,key.id);assert.ok(rotated.signing_secret);assert.equal((await service.history(owner,key.id,{})).deliveries.filter(d=>d.state==='CANCELLED').length,2);assert.equal(await model.claim(),null);
 // URL snapshot remains unchanged; future events use the updated URL.
 await service.save(owner,key.id,{...input,url:'https://example.net/new'});await jobs.queueFailed(rollback.job.id);const pending=(await model.claim())!;assert.equal(pending.target_url,'https://example.net/new');await keys.revoke(owner,key.id);assert.equal(await model.credential(pending),null);assert.equal(await model.finish(pending,204,null,1),false);await assert.rejects(service.save(owner,key.id,input),{code:'API_KEY_NOT_FOUND'});
 // Disabled endpoints cancel queued work; expired keys and inactive accounts cannot dispatch.
 const keyExtra=await keys.create(owner,{name:'Lifecycle fixture',scopes:['generations:create']});
 await service.save(owner,keyExtra.id,input);const disabledJob=await create('disabled',keyExtra.id);await jobs.queueFailed(disabledJob.job.id);await service.save(owner,keyExtra.id,{...input,enabled:false});assert.equal((await service.history(owner,keyExtra.id,{})).deliveries[0]!.state,'CANCELLED');
 await service.save(owner,keyExtra.id,input);const expiredJob=await create('expired-key',keyExtra.id);await jobs.queueFailed(expiredJob.job.id);const expiredClaim=(await model.claim())!;await sql.query("UPDATE integration_api_keys SET expires_at=now()-interval '1 second' WHERE id=$1",[keyExtra.id]);assert.equal(await model.credential(expiredClaim),null);await model.cancel(expiredClaim);
 await sql.query('UPDATE integration_api_keys SET expires_at=NULL WHERE id=$1',[keyExtra.id]);const inactiveJob=await create('inactive-account',keyExtra.id);await jobs.queueFailed(inactiveJob.job.id);const inactiveClaim=(await model.claim())!;await sql.query("UPDATE accounts SET status='disabled' WHERE id=$1",[owner]);assert.equal(await model.credential(inactiveClaim),null);await model.cancel(inactiveClaim);await sql.query("UPDATE accounts SET status='active' WHERE id=$1",[owner]);
 assert.equal((await service.history(owner,keyExtra.id,{state:'CANCELLED'})).deliveries.length,3);await assert.rejects(service.history(owner,keyExtra.id,{state:'bad'}));
 // Bounded cleanup cascades attempts but preserves active deliveries.
 await sql.query("UPDATE integration_webhook_deliveries SET updated_at=now()-interval '31 days' WHERE state IN ('DELIVERED','CANCELLED')");await model.cleanup();assert.equal((await service.history(owner,key.id,{})).deliveries.length,0);
 }finally{await db.$disconnect();await sql.end();}
});
