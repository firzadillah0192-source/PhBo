import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PublicApiKeyModel } from '../src/models/public-api-key.model.js';
import { PublicApiKeyService } from '../src/services/public-api-key.service.js';

// Disposable database only: TEST_DATABASE_URL=postgres://.../nxbooth_express_public_api_test. Never point this at production.
test('migration 025 applies twice and the key model works against real PostgreSQL', async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString && /^nxbooth_express_[a-z0-9_]*test$/.test(decodeURIComponent(new URL(connectionString).pathname.slice(1))), 'Use a dedicated nxbooth_express_*test database');
  const sql = new pg.Client({ connectionString }); await sql.connect();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    // Minimal stand-ins for the tables 025 references and the list query joins; the real ones come from earlier migrations.
    await sql.query(`DROP TABLE IF EXISTS integration_api_key_usage,integration_api_keys,results,generation_jobs,accounts CASCADE;
      CREATE TABLE accounts(id varchar(32) PRIMARY KEY,email varchar(320) UNIQUE NOT NULL,password_hash varchar(512) NOT NULL DEFAULT 'x',display_name varchar(255),avatar_url varchar(1024),
        status varchar(24) NOT NULL DEFAULT 'active',ai_quota_total int NOT NULL DEFAULT 5,ai_quota_used int NOT NULL DEFAULT 0,ai_quota_reserved int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),last_login_at timestamptz,last_activity_at timestamptz);
      CREATE TABLE generation_jobs(id varchar(32) PRIMARY KEY,account_id varchar(32));
      CREATE TABLE results(id varchar(32) PRIMARY KEY,job_id varchar(32) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz);
      INSERT INTO accounts(id,email) VALUES('a','a@example.test'),('b','b@example.test');`);
    const migration = await readFile(fileURLToPath(new URL('../../backend/migrations/025_public_api_keys.sql', import.meta.url)), 'utf8');
    await sql.query(migration); await sql.query(migration);

    const keys = new PublicApiKeyService(new PublicApiKeyModel(db), 'synthetic-integration-pepper-0123456789');
    const created = await keys.create('a', { name: 'Integration', scopes: ['catalog:read', 'results:read'] });
    const principal = await keys.authenticate(`Bearer ${created.secret}`);
    assert.equal(principal.account.id, 'a'); assert.deepEqual([...principal.scopes].sort(), ['catalog:read', 'results:read']);
    await assert.rejects(keys.authenticate(`Bearer ${created.secret.slice(0, -1)}${created.secret.endsWith('x')?'y':'x'}`), { code: 'API_KEY_INVALID' });
    const stored = await sql.query('SELECT secret_hash,prefix FROM integration_api_keys WHERE id=$1', [created.id]);
    assert.match(stored.rows[0].secret_hash, /^[a-f0-9]{64}$/); assert.ok(!created.secret.includes(stored.rows[0].secret_hash));

    await assert.rejects(sql.query(`INSERT INTO integration_api_keys(id,account_id,name,prefix,secret_hash,scopes) VALUES('bad','a','n','p','h',ARRAY['admin:all'])`), /check/i);
    await assert.rejects(sql.query(`INSERT INTO integration_api_keys(id,account_id,name,prefix,secret_hash,scopes) VALUES('bad','a','n','p','h',ARRAY[]::text[])`), /check/i);

    const rotated = await keys.rotate('a', created.id);
    assert.equal(rotated.rotated_from, created.id);
    const old = (await sql.query('SELECT expires_at FROM integration_api_keys WHERE id=$1', [created.id])).rows[0].expires_at as Date;
    assert.ok(old.getTime() > Date.now() && old.getTime() <= Date.now() + 24 * 3600000 + 5000);
    await assert.rejects(keys.revoke('b', created.id), { code: 'API_KEY_NOT_FOUND' });
    await keys.revoke('a', created.id);
    await assert.rejects(keys.authenticate(`Bearer ${created.secret}`), { code: 'API_KEY_INVALID' });
    await keys.authenticate(`Bearer ${rotated.secret}`);

    const raced=await Promise.allSettled(Array.from({length:15},(_,i)=>keys.create('b',{name:'parallel-'+i,scopes:['results:read']})));
    assert.equal(raced.filter(r=>r.status==='fulfilled').length,10);
    assert.equal(raced.filter(r=>r.status==='rejected' && r.reason.code==='API_KEY_LIMIT').length,5);
    const model = new PublicApiKeyModel(db);
    await model.touch(rotated.id, true); await model.touch(rotated.id, false);
    const usage = await model.usage(rotated.id);
    assert.deepEqual(usage.map(row => [row.requests, row.generations]), [[2, 1]]);

    await sql.query(`INSERT INTO generation_jobs(id,account_id) VALUES('j1','a'),('j2','a'),('j3','b');
      INSERT INTO results(id,job_id,created_at,deleted_at) VALUES('r1','j1','2026-10-18T01:00:00Z',NULL),('r2','j2','2026-10-18T02:00:00Z',NULL),('r3','j3','2026-10-18T03:00:00Z',NULL),('r4','j2','2026-10-18T04:00:00Z',now());`);
    const first = await model.resultIds('a', null, 1);
    assert.deepEqual(first.map(row => row.id), ['r2']);
    assert.deepEqual((await model.resultIds('a', { at: first[0].created_at, id: first[0].id }, 5)).map(row => row.id), ['r1']);
    assert.deepEqual((await model.resultIds('b', null, 5)).map(row => row.id), ['r3']);
  } finally { await db.$disconnect(); await sql.end(); }
});
