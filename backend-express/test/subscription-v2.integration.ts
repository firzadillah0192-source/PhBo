import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { SubscriptionWalletModel } from '../src/models/subscription-wallet.model.js';
import { GenerationApiRoutesService } from '../src/services/generation-api-routes.service.js';
import { PaymentModel } from '../src/models/payment.model.js';
import { AdminDataModel } from '../src/models/admin-data.model.js';
import { AdminOperationsService } from '../src/services/admin-operations.service.js';
import request from 'supertest';
import { PaymentService } from '../src/services/payment.service.js';
import { createMigrationApp } from '../src/migration-app.js';
import { AppError } from '../src/lib/errors.js';

test('v2 real PostgreSQL: conversion, separate wallets, concurrent daily limits, settlement/refunds, storage and retention', async () => {
  const url = process.env.SUBSCRIPTION_TEST_DATABASE_URL;
  assert.ok(url && new URL(url).pathname === '/nxbooth_subscription_test' && new URL(url).username === 'subscription_test', 'Dedicated disposable subscription database required');
  const sql = new pg.Pool({ connectionString: url });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await sql.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await sql.query(`
      CREATE TABLE accounts(id varchar(32) PRIMARY KEY,email text DEFAULT 'synthetic@example.invalid',password_hash text DEFAULT 'synthetic',display_name text,avatar_url text,status text DEFAULT 'active',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),last_login_at timestamptz,last_activity_at timestamptz,ai_quota_total int DEFAULT 0,ai_quota_used int DEFAULT 0,ai_quota_reserved int DEFAULT 0);
      CREATE TABLE guest_sessions(id varchar(64) PRIMARY KEY);
      CREATE TABLE credit_wallets(account_id varchar(32) PRIMARY KEY,free_remaining int,top_up_remaining int);
      CREATE TABLE subscription_plans(id varchar(64) PRIMARY KEY,code varchar(64) UNIQUE,name text,description text,monthly_ai_credits int,billing_period text,price_amount int,currency text,is_active boolean,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE subscriptions(id varchar(32) PRIMARY KEY,user_id varchar(32),plan_id varchar(64),status text,source text DEFAULT 'manual',starts_at timestamptz DEFAULT now(),current_period_start timestamptz,current_period_end timestamptz,cancel_at_period_end boolean DEFAULT false,external_customer_id text,external_subscription_id text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE generation_jobs(id varchar(32) PRIMARY KEY,account_id varchar(32),guest_id varchar(64),kiosk_session_id varchar(32),mode text);
      CREATE TABLE quota_reservations(id varchar(32) PRIMARY KEY,job_id varchar(32) UNIQUE,status text DEFAULT 'RESERVED',settled_at timestamptz);
      CREATE TABLE generation_credit_charges(job_id varchar(32) PRIMARY KEY,status text,credits int,calculation_json text,settled_at timestamptz);
      CREATE TABLE results(id varchar(32) PRIMARY KEY,job_id varchar(32) UNIQUE,deleted_at timestamptz,created_at timestamptz DEFAULT now(),template_id text DEFAULT '',storage_path text DEFAULT '',content_type text DEFAULT 'image/png',size_bytes int,width int DEFAULT 1024,height int DEFAULT 1536,sha256 text DEFAULT '',provider text,model text);
      CREATE TABLE admin_audit_log(id varchar(32) PRIMARY KEY,admin_actor_id text,action text,target_type text,target_id text,reason text,metadata_json text,created_at timestamptz DEFAULT now());
    `);
    await sql.query(await readFile(new URL('../../backend/migrations/023_duitku_sandbox_payments.sql', import.meta.url), 'utf8'));
    await sql.query(await readFile(new URL('../../backend/migrations/024_subscription_v2.sql', import.meta.url), 'utf8'));
    // Rerun is additive/idempotent and does not replace existing plan assignments.
    await sql.query(await readFile(new URL('../../backend/migrations/024_subscription_v2.sql', import.meta.url), 'utf8'));
    await sql.query("INSERT INTO accounts(id,ai_quota_total) VALUES('owner',57),('other',0),('storage',0); INSERT INTO credit_wallets VALUES('owner',50,7),('other',0,0),('storage',0,0)");
    const clock = { now: new Date('2026-10-18T10:00:00Z') };
    const wallets = new SubscriptionWalletModel(db, () => clock.now), owner = { account_id: 'owner', guest_id: null };
    const initial = await Promise.all(Array.from({ length: 5 }, () => wallets.snapshot(owner)));
    for (const s of initial) { assert.equal(s.ai.remaining, 70); assert.equal(s.classic.remaining, 500); }
    assert.equal((await sql.query("SELECT count(*)::int n FROM subscription_v2_ledger WHERE idempotency_key='v2:legacy:account:owner'")).rows[0].n, 1);
    assert.equal((await sql.query("SELECT top_up_remaining FROM credit_wallets WHERE account_id='owner'")).rows[0].top_up_remaining, 7);
    let seq = 0;
    const reserve = async (mode = 'CLASSIC', lane: 'standard' | 'fast' = 'standard', identity = owner) => {
      const id = `job-${++seq}`;
      await db.$transaction(async tx => {
        await tx.$executeRaw`INSERT INTO generation_jobs(id,account_id,guest_id,mode) VALUES(${id},${identity.account_id},${identity.guest_id},${mode})`;
        await tx.$executeRaw`INSERT INTO quota_reservations(id,job_id) VALUES(${id},${id})`;
        await tx.$executeRaw`INSERT INTO generation_credit_charges(job_id,status) VALUES(${id},'PENDING_RESULT')`;
        await wallets.reserveIn(tx, { id, mode }, identity, lane);
      });
      return id;
    };
    const finish = async (id: string, size = 4_000_000) => {
      await sql.query('INSERT INTO results(id,job_id,size_bytes,created_at) VALUES($1,$1,$2,$3)', [id, size, clock.now]);
      return db.$transaction(tx => wallets.settleIn(tx, id, true));
    };
    const race = await Promise.allSettled([reserve(), reserve(), reserve()]);
    assert.equal(race.filter(x => x.status === 'fulfilled').length, 2);
    assert.equal(race.filter(x => x.status === 'rejected').length, 1);
    const ids = race.filter(x => x.status === 'fulfilled').map(x => (x as PromiseFulfilledResult<string>).value);
    assert.equal((await wallets.snapshot(owner)).classic.remaining, 480);
    await finish(ids[0]);
    assert.equal(await db.$transaction(tx => wallets.settleIn(tx, ids[0], true)), false);
    await db.$transaction(tx => wallets.settleIn(tx, ids[1], false));
    assert.equal((await wallets.snapshot(owner)).classic.remaining, 490);
    assert.equal((await wallets.snapshot(owner)).classic.daily_remaining, 1);
    await assert.rejects(reserve('BASIC', 'fast'), { code: 'SUBSCRIPTION_REQUIRED' });
    const standard = await reserve('BASIC');
    assert.equal((await wallets.snapshot(owner)).ai.remaining, 20);
    await db.$transaction(tx => wallets.settleIn(tx, standard, false));
    assert.equal((await wallets.snapshot(owner)).ai.remaining, 70);
    const admin = new AdminOperationsService(new AdminDataModel(db), {} as never, {}, wallets);
    await admin.subscription('owner', { action: 'assign', plan_id: 'nx-v2-starter', reason: 'Synthetic manual assignment test', confirm: true }, { actor_id: 'synthetic-admin', role: 'superadmin' });
    await admin.subscription('owner', { action: 'assign', plan_id: 'nx-v2-starter', reason: 'Synthetic retry test', confirm: true }, { actor_id: 'synthetic-admin', role: 'superadmin' });
    assert.equal((await wallets.snapshot(owner)).ai.remaining, 2570);
    assert.equal((await wallets.snapshot(owner)).classic.remaining, 1250);
    const fast = await reserve('ADVANCED', 'fast'); await finish(fast, 8_000_000);
    assert.equal((await wallets.snapshot(owner)).ai.remaining, 2470);
    const totals = await wallets.totals('owner');
    assert.equal(totals.ai_spent, 100); assert.equal(totals.classic_spent, 10);
    const expiry = (await sql.query('SELECT expires_at FROM subscription_v2_results WHERE result_id=$1', [fast])).rows[0].expires_at;
    assert.equal(expiry.toISOString(), '2026-11-01T10:00:00.000Z');
    // Top-up refund survives period expiry, monthly refund does not inflate Free.
    await sql.query("UPDATE subscription_v2_wallets SET ai_monthly=40,ai_top_up=100 WHERE account_id='owner'");
    const rollover = await reserve('ADVANCED', 'fast');
    clock.now = new Date('2026-11-18T10:00:00Z');
    await db.$transaction(tx => wallets.settleIn(tx, rollover, false));
    const expired = await wallets.snapshot(owner);
    assert.equal(expired.plan.code, 'free'); assert.equal(expired.ai.monthly_remaining, 0); assert.equal(expired.ai.top_up_remaining, 100); assert.equal(expired.classic.remaining, 500);
    assert.equal((await sql.query('SELECT expires_at FROM subscription_v2_results WHERE result_id=$1', [fast])).rows[0].expires_at.toISOString(), expiry.toISOString());
    const other = await wallets.snapshot({ account_id: 'other', guest_id: null });
    assert.equal(other.ai.remaining, 0); assert.equal(other.classic.remaining, 500);
    await db.$transaction(tx => wallets.adjustIn(tx, 'other', 'CLASSIC', 1000, 'synthetic-classic-grant', 'Synthetic top-up'));
    await db.$transaction(tx => wallets.adjustIn(tx, 'other', 'CLASSIC', 1000, 'synthetic-classic-grant', 'Synthetic top-up'));
    assert.equal((await wallets.snapshot({ account_id: 'other', guest_id: null })).classic.remaining, 1500);
    await sql.query("INSERT INTO guest_sessions(id) VALUES('synthetic-guest')");
    const guest = { account_id: null, guest_id: 'synthetic-guest' };
    await wallets.snapshot(guest);
    const guestJob = await reserve('CLASSIC', 'standard', guest as never); await finish(guestJob);
    await db.$transaction(tx => wallets.claimGuestIn(tx, 'other', guest.guest_id));
    const claimed = await wallets.snapshot({ account_id: 'other', guest_id: null });
    assert.equal(claimed.classic.monthly_remaining, 490); assert.equal(claimed.classic.daily_used, 1);
    await db.$transaction(tx => wallets.adjustIn(tx, 'other', 'AI', 50, 'synthetic-ai-grant', 'Synthetic top-up'));
    const aiRace = await Promise.allSettled([reserve('BASIC', 'standard', { account_id: 'other', guest_id: null }), reserve('BASIC', 'standard', { account_id: 'other', guest_id: null })]);
    assert.equal(aiRace.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal((await wallets.snapshot({ account_id: 'other', guest_id: null })).ai.remaining, 0);
    await wallets.snapshot({ account_id: 'storage', guest_id: null });
    await sql.query("INSERT INTO generation_jobs(id,account_id,mode) VALUES('large','storage','CLASSIC'); INSERT INTO results(id,job_id,size_bytes) VALUES('large','large',149000000)");
    await assert.rejects(reserve('CLASSIC', 'standard', { account_id: 'storage', guest_id: null }), { code: 'STORAGE_QUOTA_EXCEEDED' });
    const routes = new GenerationApiRoutesService(db, { sessionSecret: 'synthetic-test-secret', baseUrl: 'http://9router.invalid/v1', standardKey: 'synthetic-standard-key', timeoutMs: 1000, resultOrigins: [] });
    assert.equal((await routes.availability()).fast, false);
    const payments = new PaymentModel(db), invoiceExpiry = new Date('2026-12-01T00:00:00Z');
    let invoiceCalls = 0, signedIn = true;
    const gateway = {
      available: () => true,
      invoice: async (input: { order: string; amount: number }) => {
        invoiceCalls++;
        return { reference: `api-fixture-${invoiceCalls}`, checkout_url: `https://app-sandbox.duitku.com/redirect_checkout?reference=api-fixture-${invoiceCalls}` };
      },
      status: async (order: string) => {
        const row = (await sql.query('SELECT * FROM payment_transactions WHERE merchant_order_id=$1', [order])).rows[0];
        return { merchantOrderId: order, reference: row.reference, amount: row.amount_rupiah, statusCode: '00' as const };
      },
      verifyCallback: () => true, // Synthetic gateway; real HMAC covered by payment tests.
    };
    const paymentService = new PaymentService(payments, gateway, { enabled: true, publicOrigin: 'https://fixture.invalid', creditRupiah: 10 });
    const accountService = {
      config: { cookieSecure: false }, payments: paymentService, subscriptions: wallets,
      resolve: async () => ({ account: signedIn ? { id: 'owner', email: 'fixture@example.invalid' } : null }),
      requireAccount: (identity: { account: unknown }) => { if (!identity.account) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Sign in'); return identity.account; },
    };
    const app = createMigrationApp({} as never, { corsOrigins: [] }, accountService as never);
    const order = await request(app).post('/api/account/subscriptions/checkout').set('Idempotency-Key', 'synthetic-http-plan-order').send({ plan_code: 'plus' });
    assert.equal(order.status, 200); assert.equal(order.body.amount_rupiah, 45000); assert.equal(order.body.credits, 5000); assert.equal(order.body.product_kind, 'subscription');
    assert.equal((await request(app).post('/api/account/subscriptions/checkout').set('Idempotency-Key', 'synthetic-http-plan-order').send({ plan_code: 'plus' })).status, 200);
    assert.equal(invoiceCalls, 1);
    assert.equal((await request(app).post('/api/account/subscriptions/checkout').set('Idempotency-Key', 'synthetic-http-plan-order').send({ plan_code: 'max' })).status, 409);
    assert.equal((await request(app).post('/api/account/subscriptions/checkout').send({ plan_code: 'plus', amount_rupiah: 1 })).status, 422);
    const walletBeforeCallback = await wallets.snapshot(owner);
    const callback = await request(app).post('/api/payments/duitku/callback').type('form').send({ merchantCode: 'synthetic', amount: '45000', merchantOrderId: order.body.merchant_order_id, reference: order.body.reference, signature: '0'.repeat(64), resultCode: '00' });
    assert.equal(callback.status, 200);
    assert.equal((await payments.find(order.body.id))!.status, 'PAID');
    assert.equal((await wallets.snapshot(owner)).ai.remaining, walletBeforeCallback.ai.remaining);
    assert.equal((await wallets.snapshot(owner)).plan.code, walletBeforeCallback.plan.code);
    const topup = await request(app).post('/api/account/topups/checkout').set('Idempotency-Key', 'synthetic-http-topup-order').send({ credits: 1000 });
    assert.equal(topup.status, 200); assert.equal(topup.body.amount_rupiah, 10000);
    signedIn = false;
    assert.equal((await request(app).post('/api/account/subscriptions/checkout').send({ plan_code: 'starter' })).status, 401);
    const beforePayment = await wallets.snapshot(owner);
    const invoice = await payments.create('owner', 'synthetic-subscription-order', 2500, invoiceExpiry, { kind: 'subscription', code: 'starter', amount_rupiah: 25000, policy_version: 2 });
    assert.equal(invoice.amount_rupiah, 25000);
    await payments.settle(invoice.id, 'synthetic-reference', 'PAID', true);
    const afterPayment = await wallets.snapshot(owner);
    assert.equal(afterPayment.plan.code, beforePayment.plan.code);
    assert.equal(afterPayment.ai.remaining, beforePayment.ai.remaining);
    assert.equal(afterPayment.classic.remaining, beforePayment.classic.remaining);
    const aiInvoice = await payments.create('owner', 'synthetic-ai-order', 1000, invoiceExpiry, { kind: 'ai_topup', code: 'ai', amount_rupiah: 10000, policy_version: 2 });
    assert.equal(aiInvoice.amount_rupiah, 10000);
    await assert.rejects(payments.create('owner', 'synthetic-ai-order', 1000, invoiceExpiry, { kind: 'subscription', code: 'starter', amount_rupiah: 25000, policy_version: 2 }));
    await assert.rejects(routes.provider('fast'), { code: 'AI_PROVIDER_NOT_CONNECTED' });
    await routes.save('fast', { enabled: true, model: 'openai/gpt-image-2.5-flare', api_key: 'synthetic-fast-key', confirm: true }, 'synthetic-admin');
    const safe = await routes.list();
    assert.equal(safe.find(r => r.lane === 'fast')!.ready, true);
    assert.equal(JSON.stringify(safe).includes('synthetic-fast-key'), false);
    assert.equal((await sql.query("SELECT encrypted_key FROM generation_api_routes WHERE lane='fast'")).rows[0].encrypted_key.includes('synthetic-fast-key'), false);
    assert.equal((await routes.provider('fast')).available(), true);
    await routes.save('fast', { enabled: false, model: 'openai/gpt-image-2.5-flare', clear_key: true, confirm: true }, 'synthetic-admin');
    assert.equal((await routes.availability()).fast, false);
  } finally { await db.$disconnect(); await sql.end(); }
});
