import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CreditWalletModel, FREE_PERIOD_MS } from '../src/models/credit-wallet.model.js';
import { CreditAccountingModel } from '../src/models/credit-accounting.model.js';
import { CustomerAccountModel } from '../src/models/customer-account.model.js';
import { CustomerResultModel } from '../src/models/customer-result.model.js';
import { readGenerationCharge } from '../src/services/generation-credit-charge.service.js';

test('PostgreSQL wallet: initial grant, free-first spend, reset, concurrency, post-result AI calculation, insufficient funds and unknown usage', async () => {
  const connectionString = process.env.CREDIT_TEST_DATABASE_URL;
  assert.ok(connectionString && new URL(connectionString).pathname === '/nxbooth_credit_test', 'Dedicated disposable database required');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const clock = { now: new Date('2026-10-08T00:00:00Z') };
  const wallets = new CreditWalletModel(db, () => clock.now);
  const credits = new CreditAccountingModel(db);
  const owner = { account_id: 'wallet-account', guest_id: null };
  let sequence = 0;
  const job = async (mode: string) => db.nxGenerationJob.create({ data: { id: `wallet-job-${++sequence}`, account_id: owner.account_id, upload_id: 'fixture-upload', template_id: '', mode } });
  const finish = async (id: string) => db.nxGenerationJob.update({ where: { id }, data: { state: 'COMPLETED' } });
  const usage = async (id: string) => db.nxProviderRun.create({ data: { id: `run-${id}`, generation_job_id: id, account_id: owner.account_id, provider_name: 'fixture', requested_model: 'cx/gpt-image-2.5', upstream_status: 'SUCCEEDED', request_started_at: clock.now, provider_usage_raw_json: JSON.stringify({ input_text_tokens: 3000, cached_text_tokens: 2000, input_image_tokens: 3000, cached_image_tokens: 1000, output_image_tokens: 400 }) } });
  try {
    await db.$executeRaw`TRUNCATE generation_credit_charges,credit_wallet_reservations,credit_wallets,quota_reservations,generation_events,generation_provider_runs,results,generation_jobs,uploads,credit_ledger,accounts CASCADE`;
    await db.nxAccount.create({ data: { id: owner.account_id, email: 'wallet@example.invalid', password_hash: 'synthetic-unused', ai_quota_total: 7 } });
    await db.nxUpload.create({ data: { id: 'fixture-upload', account_id: owner.account_id, storage_path: '/srv/photobooth/tmp/synthetic-unused.png', filename: 'fixture.png', content_type: 'image/png', size_bytes: 1, width: 1, height: 1, format: 'PNG', sha256: '0'.repeat(64) } });
    const initial = await Promise.all(Array.from({ length: 6 }, () => wallets.snapshot(owner.account_id)));
    for (const value of initial) { assert.equal(value.free_remaining, 50); assert.equal(value.top_up_remaining, 7); }
    assert.equal(await db.nxCreditLedger.count({ where: { type: 'free_credit_reset' } }), 1);
    const model = new CustomerAccountModel(db);
    const signedUp = await model.signup('new-wallet@example.invalid', 'synthetic-unused', null);
    assert.equal((await model.wallet(signedUp.id)).free_remaining, 50); assert.equal((await model.wallet(signedUp.id)).top_up_remaining, 0);

    // Zero amount at start; no free or paid balance deducted.
    const classic = await job('CLASSIC'); await credits.reserve(classic.id, owner);
    assert.equal((await wallets.snapshot(owner.account_id)).free_remaining, 50);
    assert.equal((await db.nxQuotaReservation.findUniqueOrThrow({ where: { job_id: classic.id } })).amount, 0);
    await finish(classic.id);
    await Promise.all(Array.from({ length: 4 }, () => credits.settle(classic.id, true)));
    assert.equal((await wallets.snapshot(owner.account_id)).free_remaining, 49);
    assert.equal(await db.nxCreditLedger.count({ where: { related_generation_id: classic.id, type: 'generation_spend' } }), 1);

    const ai = await job('BASIC'); await credits.reserve(ai.id, owner); await usage(ai.id);
    assert.equal((await wallets.snapshot(owner.account_id)).free_remaining, 49);
    await finish(ai.id); await credits.settle(ai.id, true);
    assert.equal((await wallets.snapshot(owner.account_id)).free_remaining, 40);
    assert.equal((await db.$transaction(tx => readGenerationCharge(tx, ai.id)))?.credits, 9);
    assert.equal((await wallets.snapshot(owner.account_id)).top_up_remaining, 7);

    const failed = await job('ADVANCED'); await credits.reserve(failed.id, owner); await db.nxGenerationJob.update({ where: { id: failed.id }, data: { state: 'FAILED' } }); await credits.settle(failed.id, false);
    assert.equal((await wallets.snapshot(owner.account_id)).free_remaining, 40);

    // A reset skips missed cycles; it never accumulates 50 per missed period.
    clock.now = new Date(clock.now.getTime() + 3 * FREE_PERIOD_MS + 1000);
    const reset = await wallets.snapshot(owner.account_id);
    assert.equal(reset.free_remaining, 50); assert.equal(reset.top_up_remaining, 7);
    assert.equal(reset.next_reset_at.getTime(), new Date('2026-10-08T00:00:00Z').getTime() + 4 * FREE_PERIOD_MS);
    assert.equal((await wallets.snapshot(owner.account_id)).free_remaining, 50);
    // Return synthetic clock to real time before using the real accounting model.
    await db.$executeRaw`UPDATE credit_wallets SET cycle_started_at=now() WHERE account_id=${owner.account_id}`;
    clock.now = new Date();

    // Minimum is exactly 10. A total of 9 is rejected, 10 can start.
    await db.$executeRaw`UPDATE credit_wallets SET free_remaining=9,top_up_remaining=0 WHERE account_id=${owner.account_id}`;
    await db.$executeRaw`UPDATE accounts SET ai_quota_total=ai_quota_used+ai_quota_reserved+9 WHERE id=${owner.account_id}`;
    const below = await job('ADVANCED'); await assert.rejects(credits.reserve(below.id, owner), { code: 'AI_QUOTA_EXHAUSTED' });
    await db.nxGenerationJob.update({ where: { id: below.id }, data: { state: 'FAILED' } });
    await db.$executeRaw`UPDATE credit_wallets SET free_remaining=10 WHERE account_id=${owner.account_id}`;
    await db.$executeRaw`UPDATE accounts SET ai_quota_total=ai_quota_total+1 WHERE id=${owner.account_id}`;
    const exact = await job('ADVANCED'); await credits.reserve(exact.id, owner);
    await db.nxGenerationJob.update({ where: { id: exact.id }, data: { state: 'FAILED' } }); await credits.settle(exact.id, false);

    // An actual charge larger than the balance is held, never negative or free.
    const expensive = await job('BASIC'); await credits.reserve(expensive.id, owner); await usage(expensive.id);
    await db.nxProviderRun.update({ where: { id: `run-${expensive.id}` }, data: { provider_usage_raw_json: JSON.stringify({ input_text_tokens: 0, input_image_tokens: 10000, output_image_tokens: 0, cached_text_tokens: 0, cached_image_tokens: 0 }) } });
    await finish(expensive.id); assert.equal(await credits.settle(expensive.id, true), false);
    assert.equal((await db.$transaction(tx => readGenerationCharge(tx, expensive.id)))?.status, 'NEEDS_TOP_UP');
    assert.equal((await wallets.snapshot(owner.account_id)).free_remaining, 10);
    await assert.rejects(new CustomerResultModel(db).assertPaid(expensive.id), { code: 'GENERATION_PAYMENT_PENDING' });
    await db.nxAccount.update({ where: { id: owner.account_id }, data: { ai_quota_total: { increment: 20 } } });
    assert.equal(await credits.settle(expensive.id, true), true);
    assert.equal((await wallets.snapshot(owner.account_id)).free_remaining, 0);
    assert.equal((await wallets.snapshot(owner.account_id)).top_up_remaining, 12); // 18 charged: free10 + topup8.
    await new CustomerResultModel(db).assertPaid(expensive.id);

    const missing = await job('ADVANCED'); await credits.reserve(missing.id, owner); await finish(missing.id);
    assert.equal(await credits.settle(missing.id, true), false);
    assert.equal((await db.$transaction(tx => readGenerationCharge(tx, missing.id)))?.status, 'PENDING_USAGE');
    assert.equal((await wallets.snapshot(owner.account_id)).top_up_remaining, 12);
    await assert.rejects(new CustomerResultModel(db).assertPaid(missing.id), { code: 'CREDIT_USAGE_UNAVAILABLE' });
    const blocked = await job('ADVANCED'); await assert.rejects(credits.reserve(blocked.id, owner), { code: 'CREDIT_USAGE_UNAVAILABLE' });
    console.log('PASS: real PostgreSQL wallet lifecycle, post-result prices, no duplicate spend, no guessed billing, protected unpaid results');
  } finally { await db.$disconnect(); }
});

test('Real worker completion and Express result routes enforce post-result charge and protect unpaid images', async () => {
  const connectionString = process.env.CREDIT_TEST_DATABASE_URL;
  assert.ok(connectionString && new URL(connectionString).pathname === '/nxbooth_credit_test');
  const [{ default: sharp }, { default: request }, fs, { CustomerGenerationModel }, { CustomerGenerationWorkerService }, { ProviderRunModel }, { CustomerAccountService }, { CustomerResultService }, { CatalogAssetsService }, { createMigrationApp }, { hashCustomerPassword }] = await Promise.all([
    import('sharp'), import('supertest'), import('node:fs/promises'), import('../src/models/customer-generation.model.js'), import('../src/services/customer-generation-worker.service.js'), import('../src/models/provider-run.model.js'), import('../src/services/customer-account.service.js'), import('../src/services/customer-result.service.js'), import('../src/services/catalog-assets.service.js'), import('../src/migration-app.js'), import('../src/services/customer-credentials.service.js'),
  ]);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const directory = await fs.mkdtemp('/srv/photobooth/tmp/credit-wallet-test/result-');
  try {
    const accountModel = new CustomerAccountModel(db);
    const password = 'Synthetic-worker-test-123';
    const account = await accountModel.signup(`pipeline-${Date.now()}@example.invalid`, await hashCustomerPassword(password), null);
    await db.nxUpload.create({ data: { id: `upload-${account.id.slice(0,16)}`, account_id: account.id, storage_path: '/srv/photobooth/tmp/synthetic-unused.png', filename: 'fixture.png', content_type: 'image/png', size_bytes: 1, width: 1, height: 1, format: 'PNG', sha256: '0'.repeat(64) } });
    const model = new CustomerGenerationModel(db), runs = new ProviderRunModel(db);
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'blue' } }).png().toBuffer();
    const createJob = async () => model.create({ id: (await import('node:crypto')).randomBytes(16).toString('hex'), account_id: account.id, upload_id: `upload-${account.id.slice(0,16)}`, template_id: '', mode: 'BASIC' });
    let withUsage = true, calls = 0;
    const worker = new CustomerGenerationWorkerService(model, { async generate(job) {
      calls++; const run = await runs.start(job,'synthetic-provider','gpt-image-2.5');
      const generated = { bytes: png, provider:'synthetic-provider', model:'gpt-image-2.5', meta: (withUsage ? { usage: { input_text_tokens:3000,input_image_tokens:3000,output_image_tokens:400,cached_text_tokens:2000,cached_image_tokens:1000 } } : {}) as never };
      await runs.finish(run,job,generated); return {...generated,canvas:{width:32,height:32}};
    } },directory);
    const paid = await createJob(); assert.equal((await accountModel.wallet(account.id)).free_remaining,50);
    assert.equal(await worker.process(paid.id),true); assert.equal((await accountModel.wallet(account.id)).free_remaining,41);
    assert.equal(await worker.process(paid.id),false); assert.equal(calls,1);
    const result = await db.nxResult.findUniqueOrThrow({where:{job_id:paid.id}});
    const accounts = new CustomerAccountService(accountModel,{sessionSecret:'synthetic-pipeline-secret',sessionDays:1,cookieSecure:false},undefined,new CatalogAssetsService([directory],directory));
    const results = new CustomerResultService(new CustomerResultModel(db),{resultsDir:directory,claimHours:1,publicOrigin:'http://localhost',production:false});
    const app = createMigrationApp({} as never,{corsOrigins:[]},accounts,results);
    const signedIn = await request(app).post('/api/account/login').send({email:account.email,password}).expect(200);
    const cookie = (signedIn.headers['set-cookie'] as unknown as string[]).map(value=>value.split(';')[0]).join('; ');
    await request(app).get(`/api/results/${result.id}/image`).set('Cookie',cookie).expect(200).expect(response=>assert.equal(response.headers['content-type'],'image/png'));
    await request(app).get(`/api/results/${result.id}/image`).expect(404);
    // Real stored 9Router aggregate counters: usable without text/image split.
    const aggregate = await createJob();
    const aggregateRun = await runs.start(aggregate,'synthetic-provider','gpt-image-2.5');
    await runs.finish(aggregateRun,aggregate,{bytes:png,provider:'synthetic-provider',model:'gpt-image-2.5',meta:{usage:{input_tokens:2421,output_tokens:87,total_tokens:2508}}});
    // This fixture runner generates the image, while the aggregate metadata is
    // already persisted just as the production provider adapter persists it.
    const aggregateWorker = new CustomerGenerationWorkerService(model,{async generate(){return {bytes:png,provider:'synthetic-provider',model:'gpt-image-2.5',canvas:{width:32,height:32}};}},directory);
    assert.equal(await aggregateWorker.process(aggregate.id),true);
    assert.equal((await accountModel.wallet(account.id)).free_remaining,36);
    assert.equal(await aggregateWorker.process(aggregate.id),false);
    assert.equal((await accountModel.wallet(account.id)).free_remaining,36);
    const aggregateCharge = await db.$transaction(tx=>readGenerationCharge(tx,aggregate.id));
    assert.equal(aggregateCharge?.status,'PAID');assert.equal(aggregateCharge?.credits,5);
    assert.equal(JSON.parse(aggregateCharge!.calculation_json!).estimated,true);
    const aggregateResult=await db.nxResult.findUniqueOrThrow({where:{job_id:aggregate.id}});
    await request(app).get(`/api/results/${aggregateResult.id}/image`).set('Cookie',cookie).expect(200);
    withUsage = false; const pending = await createJob(); await worker.process(pending.id);
    assert.equal((await accountModel.wallet(account.id)).free_remaining,36);
    const held = await db.nxResult.findUniqueOrThrow({where:{job_id:pending.id}});
    for (const path of ['', '/image', '/download']) await request(app).get(`/api/results/${held.id}${path}`).set('Cookie',cookie).expect(402);
    await request(app).post(`/api/results/${held.id}/claim`).set('Cookie',cookie).send({}).expect(402);
    const center = await request(app).get('/api/account/center').set('Cookie',cookie).expect(200);
    const creation = center.body.creations.find((item:{job_id:string})=>item.job_id===pending.id);
    assert.equal(creation.image_url,null); assert.equal(creation.download_url,null); assert.equal(creation.status,'PENDING_USAGE');
    assert.equal(center.body.privacy.retention_days,14);
    assert.ok(creation.expires_at);
    await request(app).delete(`/api/results/${held.id}`).send({confirm:true}).expect(404);
    await request(app).delete(`/api/results/${held.id}`).set('Cookie',cookie).send({confirm:false}).expect(422);
    await request(app).delete(`/api/results/${held.id}`).set('Cookie',cookie).send({confirm:true}).expect(200);
    assert.equal((await accountModel.wallet(account.id)).free_remaining,36);
    assert.equal((await db.$transaction(tx=>readGenerationCharge(tx,pending.id)))?.status,'REFUNDED');
    await assert.rejects(fs.readFile(held.storage_path));
    const afterDelete=await request(app).get('/api/account/center').set('Cookie',cookie).expect(200);
    assert.equal(afterDelete.body.creations.some((item:{result_id:string})=>item.result_id===held.id),false);
    await request(app).get(`/api/results/${held.id}/image`).set('Cookie',cookie).expect(404);
    withUsage=true; const afterPending=await createJob(); await worker.process(afterPending.id);
    const shared=await request(app).post(`/api/results/${result.id}/claim`).set('Cookie',cookie).send({}).expect(200);
    const token=new URL(shared.body.claim_url).pathname.split('/').at(-1);
    await db.nxResult.update({where:{id:result.id},data:{created_at:new Date(Date.now()-14*86400000)}});
    await request(app).get(`/api/results/${result.id}/image`).set('Cookie',cookie).expect(404);
    await request(app).get(`/api/public/results/${token}/image`).expect(404);
    const balanceBefore=(await accountModel.wallet(account.id)).free_remaining;
    assert.equal((await results.cleanup()).deleted,1);
    await assert.rejects(fs.readFile(result.storage_path));
    assert.equal((await accountModel.wallet(account.id)).free_remaining,balanceBefore);
    assert.equal((await db.$transaction(tx=>readGenerationCharge(tx,paid.id)))?.status,'PAID');
    assert.equal((await db.nxResultClaim.findFirstOrThrow({where:{result_id:result.id}})).is_revoked,true);
    assert.equal((await results.cleanup()).deleted,0);
    console.log('PASS: actual worker -> PostgreSQL result -> post-result token charge -> Express image delivery; missing usage held without charge');
  } finally { await db.$disconnect(); await fs.rm(directory,{recursive:true,force:true}); }
});
