import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type pg from 'pg';
import request from 'supertest';
import { readFile,mkdir,cp,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { createMigrationApp } from '../src/migration-app.js';
import { CustomerCatalogModel } from '../src/models/customer-catalog.model.js';
import { CustomerCatalogService } from '../src/services/customer-catalog.service.js';
import { CatalogAssetsService } from '../src/services/catalog-assets.service.js';
import { CustomerAccountModel } from '../src/models/customer-account.model.js';
import { CustomerAccountService } from '../src/services/customer-account.service.js';
import { CustomerResultModel } from '../src/models/customer-result.model.js';
import { CustomerResultService } from '../src/services/customer-result.service.js';
import { CustomerUploadModel } from '../src/models/customer-upload.model.js';
import { CustomerUploadService } from '../src/services/customer-upload.service.js';
import { UploadImageEngineService } from '../src/services/upload-image-engine.service.js';
import { CustomerGenerationModel } from '../src/models/customer-generation.model.js';
import { CustomerGenerationService } from '../src/services/customer-generation.service.js';
import { CustomerGenerationWorkerService } from '../src/services/customer-generation-worker.service.js';
import { NativeGenerationRunner } from '../src/services/native-generation-runner.service.js';
import { NativeImageEngineService } from '../src/services/native-image-engine.service.js';
import { NativeNineRouterProvider } from '../src/services/native-provider.service.js';
import { ClassicGenerationRunner } from '../src/services/classic-generation-runner.service.js';
import { ClassicImageEngineService } from '../src/services/classic-image-engine.service.js';
import { ProviderRunModel } from '../src/models/provider-run.model.js';
import { AdminAuthModel } from '../src/models/admin-auth.model.js';
import { AdminDataModel } from '../src/models/admin-data.model.js';
import { AdminAuthService,adminCookie } from '../src/services/admin-auth.service.js';
import { AdminCatalogService } from '../src/services/admin-catalog.service.js';
import { AdminOperationsService } from '../src/services/admin-operations.service.js';
import { AdminUsageService } from '../src/services/admin-usage.service.js';
import { AdminPreviewService } from '../src/services/admin-preview.service.js';
import { imageEngineSocketFetch } from './image-engine-socket.js';
import { accountCookie,legacyId,tokenHash } from '../src/services/customer-credentials.service.js';
import { composeAdvancedPrompt } from '../src/services/advanced-prompt.service.js';
import { RedisGenerationQueue } from '../src/services/redis-generation-queue.service.js';
import { NativeWorkerLoop } from '../src/services/native-worker-loop.service.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';

export async function nativeApplicationIntegration(db:PrismaClient,sql:pg.Client,root:string,resultsDir:string,uploadsDir:string,ownerId:string,ownerCookie:string){
  const templatesDir=join(uploadsDir,'test-managed-templates');await mkdir(templatesDir,{recursive:true});
  const basicId='sci-fi-space-commander-framed-001';await cp(join(root,'templates',basicId),join(templatesDir,basicId),{recursive:true});await cp(join(root,'templates','_preview_sources'),join(templatesDir,'_preview_sources'),{recursive:true});
  await db.nxTemplate.update({where:{id:basicId},data:{image_path:join(templatesDir,basicId,'template.png'),marketing_preview_path:join(templatesDir,basicId,'preview.png')}});
  const assets=new CatalogAssetsService([templatesDir,join(root,'templates'),uploadsDir,resultsDir],templatesDir);
  const model=new CustomerGenerationModel(db),socketFetch=imageEngineSocketFetch(process.env.TEST_IMAGE_ENGINE_SOCKET!);
  const images=new NativeImageEngineService('http://image-engine.test','test-only-engine-key',socketFetch);
  const uploads=new CustomerUploadService(new CustomerUploadModel(db),new UploadImageEngineService('http://image-engine.test/normalize-upload','test-only-engine-key',30000,socketFetch),{uploadsDir,retentionHours:24});
  const googleClaims={subject:'synthetic-google-subject',email:'google-candidate@example.com',name:'Synthetic Google',avatar_url:null};
  const account=new CustomerAccountService(new CustomerAccountModel(db),{sessionSecret:'test-only-session-secret',cookieSecure:false,sessionDays:30},{async verify(token){assert.equal(token,'synthetic-verified-google-token');return googleClaims;}},assets);
  const results=new CustomerResultService(new CustomerResultModel(db),{resultsDir,claimHours:24,publicOrigin:'http://localhost:5173',production:false});
  let enqueueNative:((id:string)=>Promise<void>)|undefined;
  const queue={async enqueue(id:string){await enqueueNative?.(id);}};
  const generations=new CustomerGenerationService(model,uploads,assets,queue);
  const catalog=new CustomerCatalogService(new CustomerCatalogModel(db),assets);
  const syntheticOutput=await sharp({create:{width:512,height:768,channels:3,background:'orange'}}).png().toBuffer();
  let calls=0,lastPrompt='',providerFailed=false;
  const provider=new NativeNineRouterProvider({baseUrl:'https://test-provider.invalid/v1',key:'test-only-key',timeoutMs:1000,resultOrigins:[]},async(_url,options)=>{
    calls++;const body=JSON.parse(String(options?.body));lastPrompt=body.prompt;assert.equal(body.model,'test-model');if(body.image){const photo=Buffer.from(body.image.split(',')[1],'base64');assert.equal((await sharp(photo).metadata()).format,'jpeg');}
    if(providerFailed)return new Response('Synthetic unavailable',{status:503});
    let output=syntheticOutput;
    if(body.images) {
      assert.equal(body.images.length,2); assert.equal(body.image,undefined);
      const base=Buffer.from(body.images[0].split(',')[1],'base64');
      const identity=Buffer.from(body.images[1].split(',')[1],'base64');
      assert.equal((await sharp(base).metadata()).format,'png');assert.equal((await sharp(identity).metadata()).format,'jpeg');
      assert.equal(body.size,'1024x1536');
      // Synthetic contrast edit exercises real face validation/composition and
      // transport only; it is never evidence of identity quality.
      output=await sharp(base).linear(.8,15).png().toBuffer();
    }
    return new Response(JSON.stringify({data:[{b64_json:output.toString('base64')}]}),{headers:{'content-type':'application/json','x-9router-request-id':'test-request','x-9router-account-ref':'synthetic-account','x-9router-model':'test-reported-model','x-9router-input-tokens':'100','x-9router-output-tokens':'50','x-9router-total-tokens':'150','x-9router-attempt-count':'1','x-9router-duration-ms':'80'}});
  });
  const classic=new ClassicGenerationRunner(model,uploads,assets,new ClassicImageEngineService('http://image-engine.test/compose-classic','test-only-engine-key',socketFetch));
  const runner=new NativeGenerationRunner(model,new ProviderRunModel(db),uploads,classic,images,provider,'mini-me',assets),worker=new CustomerGenerationWorkerService(model,runner,resultsDir);
  const adminModel=new AdminDataModel(db),adminCatalog=new AdminCatalogService(adminModel,assets,{templatesDir,tmpDir:join(uploadsDir,'admin-tmp'),minDimension:256,maxDimension:8000});
  const operations=new AdminOperationsService(adminModel,assets,{environment:'test',ai_provider:'9router',google_configured:true,upload_max_bytes:12582912,upload_min_dimension:256,upload_max_dimension:8000,admin_default_role:'superadmin'});
  const admin={auth:new AdminAuthService(new AdminAuthModel(db),account.signer,{token:'test-admin-key',defaultRole:'superadmin',sessionDays:30,cookieSecure:false}),catalog:adminCatalog,operations,usage:new AdminUsageService(operations,results),previews:new AdminPreviewService(adminModel,adminCatalog,queue,model.leases,provider,images)};
  const app=createMigrationApp(catalog,{corsOrigins:['http://localhost:5173'],admin,health:async()=>({status:'ok',checks:{database:'ok',redis:'ok'}})},account,results,uploads,generations);
  await request(app).get('/api/health').expect(200);await request(app).get('/api/admin/overview').expect(401);
  await request(app).post('/api/admin/login').set('Origin','https://evil.test').send({token:'test-admin-key'}).expect(403).expect(response=>assert.equal(response.body.detail.error_code,'CSRF_BLOCKED'));
  const ownerAccount=await db.nxAccount.findUniqueOrThrow({where:{id:ownerId}});await db.nxAdminUser.create({data:{id:'credential-admin-fixture',name:'Fixture account admin',email:ownerAccount.email,role:'superadmin'}});
  await request(app).post('/api/admin/login').send({token:'test-admin-key'}).expect(422);await request(app).get('/api/admin/overview').set('x-admin-token','test-admin-key').expect(401);
  const login=await request(app).post('/api/admin/login').set('Cookie',ownerCookie).send({}).expect(200);const adminCookies=(login.headers['set-cookie'] as unknown as string[]).map(value=>value.split(';')[0]).join('; ');
  const a=(path:string)=>request(app).get(`/api/admin/${path}`).set('Cookie',adminCookies);
  for(const path of ['overview','users',`users/${ownerId}`,`users/${ownerId}/credits`,`users/${ownerId}/sessions`,`users/${ownerId}/generations`,`users/${ownerId}/audit`,'credits/ledger','plans','subscriptions','generations','audit','admin-users','settings','experiences','templates','classic-layouts','advanced/frame-styles','advanced/ornaments','preview-sources','usage/overview','usage/users',`usage/users/${ownerId}`,`usage/users/${ownerId}/credits`,`usage/users/${ownerId}/generations`,'usage/generations','usage/providers/overview','usage/providers/accounts'])await a(path).expect(200).expect(response=>assert.match(response.headers['cache-control'],/no-store/));
  assert.ok(Array.isArray((await a('generations')).body.jobs));assert.ok(!JSON.stringify((await a('settings')).body).includes('test-admin-key'));
  const adjust={amount:20,reason:'Native migration test',confirm:true,idempotency_key:'test-admin-native-grant'};
  assert.equal((await request(app).post(`/api/admin/users/${ownerId}/credits`).set('Cookie',adminCookies).send(adjust).expect(200)).body.changed,true);
  assert.equal((await request(app).post(`/api/admin/users/${ownerId}/credits`).set('Cookie',adminCookies).send(adjust).expect(200)).body.changed,false);
  await request(app).post(`/api/admin/users/${ownerId}/credits`).set('Cookie',adminCookies).send({...adjust,amount:21}).expect(422);
  await request(app).post(`/api/admin/users/${ownerId}/credits`).set('Cookie',adminCookies).send({...adjust,idempotency_key:'different',amount:-100000}).expect(422);
  await request(app).post('/api/admin/plans').set('Cookie',adminCookies).send({id:'test-plan',code:'test_plan',name:'Test Plan',monthly_ai_credits:7}).expect(201);
  const subscription={action:'assign',plan_id:'test-plan',reason:'Native migration test',confirm:true};const first=(await request(app).post(`/api/admin/users/${ownerId}/subscription`).set('Cookie',adminCookies).send(subscription).expect(200)).body;
  assert.equal((await request(app).post(`/api/admin/users/${ownerId}/subscription`).set('Cookie',adminCookies).send(subscription).expect(200)).body.id,first.id);
  assert.equal(await db.nxCreditLedger.count({where:{user_id:ownerId,type:'subscription_grant'}}),1);
  const center=await request(app).get('/api/account/center').set('Cookie',ownerCookie).expect(200);assert.equal(center.body.current_plan.code,'test_plan');assert.equal(center.body.billing.enabled,false);
  // Google linking uses a verifier double here; real RSA/JWT verification is a
  // separate unit test. Repeated linking never grants a second signup bonus.
  await request(app).post('/api/account/google').send({id_token:'synthetic-verified-google-token'}).expect(200);
  await request(app).post('/api/account/google').send({id_token:'synthetic-verified-google-token'}).expect(200);
  const google=await db.nxAccount.findUniqueOrThrow({where:{email:googleClaims.email}});assert.equal(await db.nxCreditLedger.count({where:{user_id:google.id,type:'signup_bonus'}}),1);
  // Basic uses the approved AI-provider business rule. The provider response is
  // explicitly synthetic; this validates the adapter and credits, not identity.
  const portrait=await readFile(join(root,'templates','_preview_sources','portrait-default.png'));
  const upload=(await request(app).post('/api/uploads').set('Cookie',ownerCookie).attach('file',portrait,{filename:'internal-demo.png',contentType:'image/png'}).expect(201)).body;
  const basic=(await request(app).post('/api/generations').set('Cookie',ownerCookie).send({mode:'BASIC',upload_id:upload.upload_id,template_id:basicId}).expect(202)).body;
  assert.equal(await worker.process(basic.job_id),true,JSON.stringify(await db.nxGenerationJob.findUnique({where:{id:basic.job_id}})));
  assert.equal(calls,1);assert.equal((await db.nxQuotaReservation.findUniqueOrThrow({where:{job_id:basic.job_id}})).status,'CONSUMED');
  const basicResult=await db.nxResult.findUniqueOrThrow({where:{job_id:basic.job_id}});assert.deepEqual([basicResult.width,basicResult.height],[1024,1536]);
  assert.match(lastPrompt,/TEMPLATE — IMMUTABLE BASE IMAGE/);assert.match(lastPrompt,/SUBJECT IDENTITY/);
  assert.equal(await worker.process(basic.job_id),false);assert.equal(calls,1);
  await request(app).post(`/api/results/${basicResult.id}/claim`).set('Cookie',ownerCookie).send({}).expect(200);
  await db.nxExperience.update({where:{id:'mini-me'},data:{compatible_frame_style_ids_json:null,compatible_ornament_ids_json:null,internal_prompt:'PRIMARY TEST EXPERIENCE'}});
  for(const id of ['natural','modern','minimal','luxury','retro','film','cute','editorial','futuristic','artistic']){
    await db.nxFrameStyle.upsert({where:{id},update:{prompt_fragment:`TEST STYLE ${id}`},create:{id,slug:id,name:id,description:'Test',prompt_fragment:`TEST STYLE ${id}`,enabled:true,sort_order:0}});
    const job=(await request(app).post('/api/generations').set('Cookie',ownerCookie).send({mode:'ADVANCED',upload_id:upload.upload_id,experience_id:'mini-me',frame_style_id:id,ornament_ids:['sparkles']}).expect(202)).body;
    assert.equal(await worker.process(job.job_id),true);assert.equal(await worker.process(job.job_id),false);
    assert.equal(lastPrompt,composeAdvancedPrompt('PRIMARY TEST EXPERIENCE',`TEST STYLE ${id}`));
    const result=await db.nxResult.findUniqueOrThrow({where:{job_id:job.job_id}});assert.deepEqual([result.width,result.height],[2160,3240]);
    const run=await db.nxProviderRun.findFirstOrThrow({where:{generation_job_id:job.job_id}});assert.equal(run.router_request_id,'test-request');assert.equal(run.provider_account_id,'synthetic-account');assert.equal(run.total_tokens,150);assert.equal(run.upstream_status,'SUCCEEDED');
    const detail=(await a(`usage/generations/${job.job_id}`).expect(200)).body;assert.equal(detail.generation.credit_state,'spent');assert.equal(detail.provider_runs.length,1);assert.ok(!JSON.stringify(detail).includes('test-only-key'));assert.ok(!JSON.stringify(detail.claims).includes('token_hash'));
    if(id==='natural'){await a(`usage/generations/${job.job_id}/result/image?thumbnail=true`).expect(200).expect('content-type',/image\/jpeg/);await a(`usage/generations/${job.job_id}/result/download`).expect(200);}
  }
  assert.equal(calls,11);
  const failed=(await request(app).post('/api/generations').set('Cookie',ownerCookie).send({mode:'ADVANCED',upload_id:upload.upload_id,experience_id:'mini-me',frame_style_id:'modern'}).expect(202)).body;providerFailed=true;assert.equal(await worker.process(failed.job_id),false);providerFailed=false;
  assert.equal((await db.nxQuotaReservation.findUniqueOrThrow({where:{job_id:failed.job_id}})).status,'REFUNDED');assert.equal((await db.nxGenerationJob.findUniqueOrThrow({where:{id:failed.job_id}})).error_code,'AI_PROVIDER_ERROR');
  const recovery=(await request(app).post('/api/generations').set('Cookie',ownerCookie).send({mode:'ADVANCED',upload_id:upload.upload_id,experience_id:'mini-me',frame_style_id:'modern'}).expect(202)).body;
  const oldToken=legacyId();assert.ok(await model.claim(recovery.job_id,oldToken));assert.equal(await model.claim(recovery.job_id,legacyId()),null);assert.ok(await model.leases.renew('customer',recovery.job_id,oldToken));
  await sql.query("UPDATE generation_worker_leases SET expires_at=now()-interval '1 second' WHERE job_id=$1",[recovery.job_id]);
  assert.equal(await model.leases.renew('customer',recovery.job_id,oldToken),false);assert.ok((await model.leases.recoverable('customer')).some(row=>row.id===recovery.job_id));assert.equal(await worker.process(recovery.job_id),true);assert.equal(await model.fail(recovery.job_id,'STALE','Stale worker',oldToken),false);assert.equal(await db.nxResult.count({where:{job_id:recovery.job_id}}),1);
  const preview=(await request(app).post('/api/admin/experiences/mini-me/preview').set('Cookie',adminCookies).expect(202)).body;
  assert.equal(await admin.previews.process(preview.id),true);assert.equal(await admin.previews.process(preview.id),false);assert.equal((await a(`preview-jobs/${preview.id}`)).body.state,'COMPLETED');
  const reservationsBefore=await db.nxQuotaReservation.count();await request(app).post('/api/admin/experiences/mini-me/preview').set('Cookie',adminCookies).expect(202);assert.equal(await db.nxQuotaReservation.count(),reservationsBefore);
  await request(app).post('/api/admin/templates').set('Cookie',adminCookies).send({id:'test-catalog-template',name:'Test'}).expect(201);await request(app).post('/api/admin/templates/test-catalog-template/image').set('Cookie',adminCookies).attach('file',portrait,{filename:'demo.png',contentType:'image/png'}).expect(200);await a('templates/test-catalog-template/image').expect(200);await request(app).delete('/api/admin/templates/test-catalog-template').set('Cookie',adminCookies).expect(204);
  await request(app).post('/api/admin/experiences').set('Cookie',adminCookies).send({id:'test-experience',name:'Test',internal_prompt:'Test authority'}).expect(201);await request(app).patch('/api/admin/experiences/test-experience').set('Cookie',adminCookies).send({status:'published'}).expect(200);await request(app).delete('/api/admin/experiences/test-experience').set('Cookie',adminCookies).expect(204);
  const roles=['operator','content_manager'] as const;for(const role of roles){const raw=legacyId(),roleAccount=await db.nxAccount.create({data:{id:legacyId(),email:`${role}@role-fixture.invalid`,password_hash:'unused-fixture-password'}});await db.nxAdminUser.create({data:{id:`test-${role}`,name:role,email:roleAccount.email,role}});await db.nxAuthSession.create({data:{id:tokenHash(raw),account_id:roleAccount.id,is_admin:true,admin_user_id:`test-${role}`,admin_role:role,expires_at:new Date(Date.now()+3600000)}});const cookie=`${adminCookie}=${account.signer.sign(raw)}`;await request(app).get('/api/admin/admin-users').set('Cookie',cookie).expect(403);await request(app).get(`/api/admin/${role==='operator'?'templates':'overview'}`).set('Cookie',cookie).expect(403);await request(app).get(`/api/admin/${role==='operator'?'overview':'templates'}`).set('Cookie',cookie).expect(200);}
  const deletion=(await db.nxResult.findUniqueOrThrow({where:{job_id:recovery.job_id}}));const claim=(await request(app).post(`/api/results/${deletion.id}/claim`).set('Cookie',ownerCookie).send({}).expect(200)).body;await request(app).delete(`/api/admin/usage/generations/${recovery.job_id}/result`).set('Cookie',adminCookies).send({confirm:true}).expect(200);await request(app).get(`/api/public/results/${claim.claim_url.split('/r/')[1]}`).expect(404);
  await request(app).post('/api/admin/logout').set('Cookie',adminCookies).expect(200);await request(app).get('/api/admin/overview').set('Cookie',adminCookies).expect(401);
  // Additive migration is idempotent; it does not replace existing entities.
  await sql.query(await readFile(join(root,'backend/migrations/015_native_worker_leases.sql'),'utf8'));
  if(process.env.TEST_BROWSER==='1'){
    assert.ok(process.env.TEST_REDIS_SOCKET?.startsWith('/tmp/nxbooth-express-redis-test-'));
    const name=`nxbooth:express:browser-test:${legacyId()}`,producer=new RedisGenerationQueue('',name,process.env.TEST_REDIS_SOCKET),consumer=new RedisGenerationQueue('',name,process.env.TEST_REDIS_SOCKET);
    enqueueNative=id=>producer.enqueue(id);const loop=new NativeWorkerLoop(consumer,id=>worker.process(id));const running=loop.run();
    const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
    try{const outcome=await promisify(execFile)(process.execPath,[join(root,'backend-express/scripts/native-browser-check.mjs')],{env:{...process.env,NXBOOTH_NATIVE_API_URL:`http://127.0.0.1:${address.port}`},timeout:240000,maxBuffer:300000});console.log(outcome.stdout.trim());}
    finally{loop.stop();await running;await producer.close();await consumer.close();await new Promise<void>(resolve=>server.close(()=>resolve()));enqueueNative=undefined;}
  }
  await rm(templatesDir,{recursive:true,force:true});
}
