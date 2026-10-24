// Real PostgreSQL, HTTP, wallet and storage tests; AI/camera images are synthetic fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { SubscriptionWalletModel } from '../src/models/subscription-wallet.model.js';
import { DuetModel } from '../src/nxduet/model.js';
import { DuetFiles,poseKind } from '../src/nxduet/files.js';
import { DuetService } from '../src/nxduet/service.js';
import { DuetWorker } from '../src/nxduet/worker.js';
import { createMigrationApp } from '../src/migration-app.js';
import { AppError } from '../src/lib/errors.js';

test('isolated PostgreSQL: NXDuet credits, replay, worker, ownership, retention and admin controls',async()=>{
  const url=process.env.NXDUET_TEST_DATABASE_URL;
  assert.ok(url,'NXDUET_TEST_DATABASE_URL required');const parsed=new URL(url);
  assert.equal(parsed.pathname,'/nxbooth_nxduet_test');assert.equal(parsed.username,'nxduet_test');assert.ok(parsed.searchParams.get('host')?.startsWith('/tmp/nxduet-test-'),'Disposable Unix socket required');
  const pool=new pg.Pool({connectionString:url}),db=new PrismaClient({adapter:new PrismaPg({connectionString:url})});
  const directory=await mkdtemp(join(tmpdir(),'nxduet-fixtures-'));
  try{
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await pool.query(`CREATE TABLE accounts(id varchar(32) PRIMARY KEY,ai_quota_total int DEFAULT 0,ai_quota_used int DEFAULT 0,ai_quota_reserved int DEFAULT 0);
      CREATE TABLE guest_sessions(id varchar(64) PRIMARY KEY);
      CREATE TABLE credit_wallets(account_id varchar(32),free_remaining int);
      CREATE TABLE subscription_plans(id varchar(64) PRIMARY KEY,code text,name text,description text,monthly_ai_credits int,billing_period text,price_amount int,currency text,is_active boolean);
      CREATE TABLE subscriptions(id varchar(32) PRIMARY KEY,user_id varchar(32),plan_id text,status text,current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean DEFAULT false,created_at timestamptz DEFAULT now());
      CREATE TABLE generation_jobs(id varchar(32) PRIMARY KEY,account_id varchar(32),guest_id varchar(64),kiosk_session_id varchar(32));
      CREATE TABLE quota_reservations(job_id varchar(32),status text);
      CREATE TABLE results(id varchar(32) PRIMARY KEY,job_id varchar(32),size_bytes int,deleted_at timestamptz);
      CREATE TABLE payment_transactions(id text PRIMARY KEY,credits int,amount_rupiah int);
      CREATE TABLE admin_audit_log(id varchar(32) PRIMARY KEY,admin_actor_id text,action text,target_type text,target_id text,reason text,metadata_json text,created_at timestamptz DEFAULT now());`);
    for(const file of ['024_subscription_v2.sql','028_nxduet.sql','029_nxduet_poses.sql','029_nxduet_poses.sql'])await pool.query(await readFile(new URL('../../backend/migrations/'+file,import.meta.url),'utf8'));
    const owner='a'.repeat(32),other='b'.repeat(32);await pool.query('INSERT INTO accounts(id) VALUES($1),($2)',[owner,other]);
    const wallets=new SubscriptionWalletModel(db,undefined,true),model=new DuetModel(db,wallets),files=new DuetFiles(directory);
    await wallets.snapshot({account_id:owner,guest_id:null});await pool.query('UPDATE subscription_v2_wallets SET ai_top_up=1000 WHERE account_id=$1',[owner]);
    const source=await sharp({create:{width:512,height:512,channels:3,background:'#345678'}}).jpeg().toBuffer();
    const overlay=await sharp(Buffer.from('<svg width="512" height="512"><rect x="100" y="80" width="310" height="430" rx="40" fill="#ef4050"/></svg>')).png().toBuffer();
    let aiCalls=0,mode='valid',sourceReads=0;
    const provider={name:'synthetic-test-only',available:()=>true,generate:async()=>{aiCalls++;if(mode==='fail')throw new AppError(502,'AI_PROVIDER_ERROR','Synthetic provider failure');return {bytes:mode==='opaque'?await sharp(source).png().toBuffer():overlay,provider:'synthetic-test-only',model:'synthetic-fixture',meta:{}};}};
    const uploads={owned:async(id:string,identity:any)=>{assert.equal(identity.account.id,owner);return {upload:{id},path:'synthetic-source'};},read:async()=>{sourceReads++;return source;}};
    const slots=[{x:10,y:10,width:500,height:430},{x:10,y:500,width:500,height:430},{x:10,y:1000,width:500,height:430}],frame={info:async()=>({slots}),load:async()=>({slots,layout:{},frame:Buffer.from('frame')}),compose:async(_info:unknown,photos:Buffer[])=>photos[0]};
    const service=new DuetService(model,files,uploads as never,provider,async()=>'synthetic-fixture',frame as never),worker=new DuetWorker(model,files,provider);
    const identity={account:{id:owner},guest:null} as never;
    const accounts={resolve:async(cookies:Record<string,string>)=>({account:cookies.owner?{id:cookies.owner}:null}),requireAccount:(value:any)=>{if(!value.account)throw new AppError(401,'AUTHENTICATION_REQUIRED','Sign in');return value.account;}};
    const auth={config:{cookieSecure:false},resolve:async(cookies:Record<string,string>)=>{if(cookies.role!=='operator'&&cookies.role!=='superadmin')throw new AppError(403,'ADMIN_FORBIDDEN','Denied');return {role:cookies.role,actor_id:'synthetic-admin'};},requireRole:(actor:any,role:string)=>{if(actor.role!==role&&actor.role!=='superadmin')throw new AppError(403,'ADMIN_FORBIDDEN','Denied');}};
    const app=createMigrationApp({} as never,{corsOrigins:[],duet:service,admin:{auth} as never},accounts as never);
    // Other unrelated admin endpoints are never exercised with this minimal auth fixture.
    const agent=request(app),cookie=(account=owner)=>`owner=${account}`;
    const body={upload_id:'c'.repeat(32),name:'Synthetic companion',poses:['smile','angry','hug'],rights_accepted:true};
    assert.equal((await agent.get('/api/nxduet/templates')).status,401);
    const create=(key:string)=>agent.post('/api/nxduet/templates').set('Cookie',cookie()).set('Idempotency-Key',key).send(body);
    const attempts=await Promise.all([create('nxduet-same-key-001'),create('nxduet-same-key-001')]);
    assert.ok(attempts.every(result=>result.status===202),JSON.stringify(attempts.map(v=>v.body)));assert.equal(attempts[0].body.id,attempts[1].body.id);const id=attempts[0].body.id;
    assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining,900);
    assert.equal((await pool.query('SELECT count(*)::int n FROM nxduet_templates')).rows[0].n,1);
    const reads=sourceReads;assert.equal((await create('nxduet-same-key-001')).body.id,id);assert.equal(sourceReads,reads);
    const mismatch=await agent.post('/api/nxduet/templates').set('Cookie',cookie()).set('Idempotency-Key','nxduet-same-key-001').send({...body,name:'Different'});assert.equal(mismatch.status,409);
    await worker.processOne();assert.equal(aiCalls,3);let row=await model.find(id);assert.equal(row?.state,'COMPLETED');assert.equal(row?.charge_status,'CONSUMED');
    assert.equal((await agent.get(`/api/nxduet/templates/${id}/image`).set('Cookie',cookie(other))).status,404);
    assert.equal((await agent.get(`/api/nxduet/templates/${id}/image`).set('Cookie',cookie())).status,200);
    assert.equal((await agent.patch(`/api/nxduet/templates/${id}`).set('Cookie',cookie(other)).send({name:'Intruder'})).status,404);
    assert.equal((await agent.patch(`/api/nxduet/templates/${id}`).set('Cookie',cookie()).send({name:'Renamed',placement:{side:'left',scale:.8}})).status,200);
    await worker.maintain();row=await model.find(id);assert.equal(row?.source_path,'');assert.equal(row?.source_bytes,0);const poseRows=await model.poses(id);assert.deepEqual(poseRows.map(p=>[p.slot,p.pose_key]),[[1,'smile'],[2,'angry'],[3,'hug']]);assert.equal((await service.image(owner,id,2)).length,poseRows[1]!.size_bytes);assert.equal((await agent.get(`/api/nxduet/templates/${id}`).set('Cookie',cookie())).body.poses.length,3);
    assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).storage.used_bytes,poseRows.reduce((sum,p)=>sum+p.size_bytes,0));assert.equal((await wallets.totals(owner)).ai_spent,100);
    const compose=()=>agent.post(`/api/nxduet/templates/${id}/compose`).set('Cookie',cookie()).field('placement',JSON.stringify({side:'left',scale:.8})).attach('captures',source,'one.jpg').attach('captures',source,'two.jpg').attach('captures',source,'three.jpg');
    assert.equal((await compose()).status,200);assert.equal(aiCalls,3);assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining,900);
    const control=(action:string)=>agent.post(`/api/admin/nxduet/templates/${id}/control`).set('Cookie','role=operator').send({action,reason:'Synthetic moderation test'});
    assert.equal((await agent.get('/api/admin/nxduet/templates').set('Cookie','role=content_manager')).status,403);
    assert.equal((await control('disable')).status,200);assert.equal((await compose()).status,409);assert.equal((await agent.get(`/api/nxduet/templates/${id}/image`).set('Cookie',cookie())).status,409);
    assert.equal((await control('enable')).status,200);
    mode='opaque';const invalid=await create('nxduet-invalid-002');await worker.processOne();assert.equal((await model.find(invalid.body.id))?.charge_status,'REFUNDED');assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining,900);
    mode='fail';const failed=await create('nxduet-failure-003');await worker.processOne();assert.equal((await model.find(failed.body.id))?.charge_status,'REFUNDED');assert.equal(await model.finish(failed.body.id,'wrong',null),false);assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining,900);
    mode='valid';const interrupted=await create('nxduet-interrupt-004');const claimed=await model.claim();assert.equal(claimed?.id,interrupted.body.id);await pool.query("UPDATE nxduet_templates SET lease_until=now()-interval '1 second' WHERE id=$1",[claimed!.id]);const beforeAi=aiCalls;await worker.maintain();assert.equal(aiCalls,beforeAi);assert.equal((await model.find(claimed!.id))?.charge_status,'REFUNDED');
    // Concurrent completion vs interruption: only one terminal outcome/ledger refund.
    const racing=await create('nxduet-racing-005');const racingJob=(await model.claim())!;assert.equal(racingJob.id,racing.body.id);
    const racePoses=[];for(const slot of [1,2,3])racePoses.push({slot,key:['smile','angry','hug'][slot-1]!,path:await files.put(racingJob.id,poseKind(slot),overlay),width:512,height:512,size:overlay.length});
    const terminal=await Promise.all([model.finish(racingJob.id,racingJob.lease_token!,{poses:racePoses,meta:{synthetic:true}}),model.finish(racingJob.id,racingJob.lease_token!,null)]);assert.equal(terminal.filter(Boolean).length,1);
    const terminalRow=(await model.find(racingJob.id))!;const currentBalance=terminalRow.state==='COMPLETED'?800:900;assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining,currentBalance);
    // Queue timeout refunds once; another maintain call cannot refund a second time.
    const queued=await create('nxduet-queued-006');await pool.query("UPDATE nxduet_templates SET created_at=now()-interval '31 minutes' WHERE id=$1",[queued.body.id]);await worker.maintain();await worker.maintain();assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining,currentBalance);
    assert.equal((await control('delete')).status,200);await worker.maintain();assert.equal((await agent.get(`/api/nxduet/templates/${id}/image`).set('Cookie',cookie())).status,404);assert.equal((await model.find(id))?.overlay_path,null);assert.equal((await model.poses(id)).length,0);assert.equal((await create('nxduet-same-key-001')).status,410);
    assert.equal((await pool.query("SELECT count(*)::int n FROM admin_audit_log WHERE target_id=$1",[id])).rows[0].n,3);
    // Insufficient balance and full storage do not leave jobs, charges or provider calls.
    await pool.query('UPDATE subscription_v2_wallets SET ai_top_up=99 WHERE account_id=$1',[owner]);const n=(await pool.query('SELECT count(*)::int n FROM nxduet_templates')).rows[0].n;
    assert.equal((await create('nxduet-rate-check-007')).status,429);
    await assert.rejects(service.create(identity,body,'nxduet-no-money-007'),{code:'CREDIT_BALANCE_EXHAUSTED'});assert.equal((await pool.query('SELECT count(*)::int n FROM nxduet_templates')).rows[0].n,n);
    // Mixed allocations refund to their original buckets, without reviving an expired period.
    await pool.query('UPDATE subscription_v2_wallets SET ai_monthly=60,ai_top_up=40 WHERE account_id=$1',[owner]);
    const mixed=await service.create(identity,body,'nxduet-mixed-fund-009');const mixedRow=(await model.find(mixed.id))!;assert.equal(mixedRow.monthly_part,60);assert.equal(mixedRow.top_up_part,40);
    mode='fail';await worker.processOne();let wallet=await wallets.snapshot({account_id:owner,guest_id:null});assert.equal(wallet.ai.monthly_remaining,60);assert.equal(wallet.ai.top_up_remaining,40);
    const expired=await service.create(identity,body,'nxduet-expired-fund-010');await pool.query("UPDATE nxduet_templates SET period_start=period_start-interval '1 month' WHERE id=$1",[expired.id]);await worker.processOne();wallet=await wallets.snapshot({account_id:owner,guest_id:null});assert.equal(wallet.ai.monthly_remaining,0);assert.equal(wallet.ai.top_up_remaining,40);
    await pool.query('UPDATE subscription_v2_wallets SET ai_top_up=1000 WHERE account_id=$1',[owner]);await pool.query('INSERT INTO generation_jobs(id,account_id) VALUES($1,$2)',['d'.repeat(32),owner]);await pool.query('INSERT INTO results(id,job_id,size_bytes) VALUES($1,$2,149000000)',['e'.repeat(32),'d'.repeat(32)]);
    await assert.rejects(service.create(identity,body,'nxduet-no-space-008'),{code:'STORAGE_QUOTA_EXCEEDED'});assert.equal((await wallets.snapshot({account_id:owner,guest_id:null})).ai.remaining,1000);
  }finally{await db.$disconnect();await pool.end();await rm(directory,{recursive:true,force:true});}
});
