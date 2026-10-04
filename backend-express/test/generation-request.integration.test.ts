import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFile } from 'node:fs/promises';
import { CustomerGenerationModel } from '../src/models/customer-generation.model.js';
import { legacyId } from '../src/services/customer-credentials.service.js';
import { nativeKioskIntegration } from './native-kiosk.integration.js';
import { postgresQueueIntegration } from './postgres-generation-queue.integration.js';

test('PostgreSQL retries reserve once, reject changed selections, isolate owners, and roll back quota failures', async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString && /^nxbooth_express_[a-z0-9_]*test$/.test(new URL(connectionString).pathname.slice(1)), 'Dedicated disposable test database required');
  const sql = new pg.Client({ connectionString });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  await sql.connect();
  try {
    await sql.query(`
      CREATE TABLE guest_sessions(id varchar(64) PRIMARY KEY, ai_quota_total integer NOT NULL DEFAULT 2, ai_quota_used integer NOT NULL DEFAULT 0, ai_quota_reserved integer NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
      CREATE TABLE generation_jobs(id varchar(32) PRIMARY KEY, account_id varchar(32), guest_id varchar(64), mode varchar(16), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), upload_id varchar(32), template_id varchar(128), experience_id varchar(128), layout_id varchar(32), capture_upload_ids_json text, frame_style_id varchar(128), ornament_ids_json text, state varchar(16), error_code varchar(64), error_message text, provider varchar(64), model varchar(128), started_at timestamptz, finished_at timestamptz);
      CREATE TABLE quota_reservations(id varchar(32) PRIMARY KEY, job_id varchar(32) UNIQUE, account_id varchar(32), guest_id varchar(64), amount integer DEFAULT 1, status varchar(16) DEFAULT 'RESERVED', created_at timestamptz DEFAULT now(), settled_at timestamptz);
      CREATE TABLE credit_ledger(id varchar(32) PRIMARY KEY, user_id varchar(32), guest_id varchar(64), amount integer, type varchar(64), reason text DEFAULT '', related_generation_id varchar(32), admin_actor_id varchar(64), idempotency_key varchar(255) UNIQUE, metadata_json text, created_at timestamptz DEFAULT now());
      CREATE TABLE generation_events(id varchar(32) PRIMARY KEY, job_id varchar(32), event_type varchar(64), detail text DEFAULT '', metadata_json text, created_at timestamptz DEFAULT now());
      INSERT INTO guest_sessions(id) VALUES ('first'),('second');
      INSERT INTO guest_sessions(id,ai_quota_total) VALUES ('exhausted',0);
    `);
    const leaseMigration = await readFile(new URL('../../backend/migrations/015_native_worker_leases.sql', import.meta.url), 'utf8');
    const migration = await readFile(new URL('../../backend/migrations/016_generation_request_idempotency.sql', import.meta.url), 'utf8');
    const snapshotMigration = await readFile(new URL('../../backend/migrations/019_generation_snapshots_worker_attempts.sql', import.meta.url),'utf8');
    await sql.query(leaseMigration); await sql.query(leaseMigration);
    await sql.query(snapshotMigration); await sql.query(snapshotMigration);
    await sql.query(migration);
    await sql.query(migration); // Reapplication is safe.
    const model = new CustomerGenerationModel(db,3);
    const descriptor = { scope: 'guest:first', key: 'request-one', hash: 'a'.repeat(64) };
    const create = (guest = 'first', mode = 'BASIC') => ({ id: legacyId(), account_id: null, guest_id: guest,
      upload_id: 'synthetic', template_id: 'test', mode, state: 'QUEUED' });
    const race = await Promise.all(Array.from({ length: 8 }, () => model.createOnce(create(), descriptor)));
    assert.equal(new Set(race.map(item => item.job.id)).size, 1);
    assert.equal(race.filter(item => !item.reused).length, 1);
    assert.equal((await sql.query('SELECT ai_quota_reserved FROM guest_sessions WHERE id=$1', ['first'])).rows[0].ai_quota_reserved, 1);
    assert.equal((await sql.query('SELECT count(*)::int AS n FROM quota_reservations')).rows[0].n, 1);
    assert.equal((await sql.query('SELECT count(*)::int AS n FROM credit_ledger')).rows[0].n, 1);
    // A live worker lease does not consume another attempt. Expired leases can
    // recover three times; the next claim fails and refunds the reservation once.
    assert.ok(await model.claim(race[0].job.id,'attempt-one'));
    assert.equal(await model.claim(race[0].job.id,'blocked-live-lease'),null);
    assert.equal((await db.nxGenerationJob.findUniqueOrThrow({where:{id:race[0].job.id}})).worker_attempts,1);
    for (const [attempt,token] of [[2,'attempt-two'],[3,'attempt-three']] as const) {
      await sql.query("UPDATE generation_worker_leases SET expires_at=now()-interval '1 second' WHERE queue_kind='customer' AND job_id=$1",[race[0].job.id]);
      assert.ok(await model.claim(race[0].job.id,token));
      assert.equal((await db.nxGenerationJob.findUniqueOrThrow({where:{id:race[0].job.id}})).worker_attempts,attempt);
    }
    await sql.query("UPDATE generation_worker_leases SET expires_at=now()-interval '1 second' WHERE queue_kind='customer' AND job_id=$1",[race[0].job.id]);
    assert.equal(await model.claim(race[0].job.id,'exhausted'),null);
    assert.equal(await model.claim(race[0].job.id,'exhausted-again'),null);
    const exhausted = await db.nxGenerationJob.findUniqueOrThrow({where:{id:race[0].job.id}});
    assert.equal(exhausted.state,'FAILED'); assert.equal(exhausted.error_code,'WORKER_RETRY_EXHAUSTED'); assert.equal(exhausted.worker_attempts,3);
    assert.equal((await db.nxQuotaReservation.findUniqueOrThrow({where:{job_id:race[0].job.id}})).status,'REFUNDED');
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM credit_ledger WHERE idempotency_key=$1",[`generation_refund:${race[0].job.id}`])).rows[0].n,1);
    await assert.rejects(model.createOnce(create(), { ...descriptor, hash: 'b'.repeat(64) }), (e: unknown) => e instanceof Error && 'code' in e && e.code === 'IDEMPOTENCY_CONFLICT');
    const second = await model.createOnce(create('second'), { ...descriptor, scope: 'guest:second' });
    assert.notEqual(second.job.id, race[0].job.id);
    const before = (await sql.query('SELECT count(*)::int AS n FROM generation_jobs')).rows[0].n;
    await assert.rejects(model.createOnce(create('exhausted'), { ...descriptor, scope: 'guest:exhausted' }));
    assert.equal((await sql.query('SELECT count(*)::int AS n FROM generation_jobs')).rows[0].n, before);
    assert.equal(await model.findRequest({ ...descriptor, scope: 'guest:exhausted' }), null);
    const classic = await model.createOnce(create('exhausted', 'CLASSIC'), { ...descriptor, scope: 'guest:exhausted' });
    assert.equal(classic.job.mode, 'CLASSIC');
    assert.equal((await sql.query('SELECT count(*)::int AS n FROM quota_reservations')).rows[0].n, 2);
    assert.equal((await model.findRequest(descriptor))!.id, race[0].job.id);
    await nativeKioskIntegration(sql,db);
    await postgresQueueIntegration(sql,db);
  } finally {
    await db.$disconnect();
    await sql.query('DROP TABLE IF EXISTS generation_requests, generation_events, credit_ledger, quota_reservations, generation_jobs, guest_sessions');
    await sql.end();
  }
});
