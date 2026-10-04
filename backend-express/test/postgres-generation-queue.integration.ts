import assert from 'node:assert/strict';
import type pg from 'pg';
import type { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { PostgresGenerationQueueModel } from '../src/models/postgres-generation-queue.model.js';
import { PostgresGenerationQueue } from '../src/services/postgres-generation-queue.service.js';
import { CustomerGenerationModel } from '../src/models/customer-generation.model.js';
import { legacyId } from '../src/services/customer-credentials.service.js';

export async function postgresQueueIntegration(sql: pg.Client,db: PrismaClient) {
  try {
    for (const name of ['015_native_worker_leases.sql','018_postgres_generation_dispatch.sql','018_postgres_generation_dispatch.sql'])
      await sql.query(await readFile(new URL(`../../backend/migrations/${name}`,import.meta.url),'utf8'));
    const model = new PostgresGenerationQueueModel(db),customer = new PostgresGenerationQueue(model,'customer'),preview = new PostgresGenerationQueue(model,'preview');
    const ids = Array.from({ length: 24 },() => legacyId());
    await Promise.all(ids.flatMap(id => [customer.enqueue(id),customer.enqueue(id)]));
    for (const id of ids.slice(0,2)) await preview.enqueue(id);
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM generation_dispatch WHERE queue_kind='customer'")).rows[0].n,24);
    const consumed = await Promise.all(Array.from({ length: 40 },() => model.next('customer')));
    const actual = consumed.filter((id): id is string => id!==null);
    assert.equal(actual.length,24); assert.equal(new Set(actual).size,24); assert.deepEqual(actual.sort(),[...ids].sort());
    assert.equal((await sql.query("SELECT count(*)::int AS n FROM generation_dispatch WHERE queue_kind='preview'")).rows[0].n,2);
    assert.equal(await customer.dequeue(0),null);
    assert.ok(ids.slice(0,2).includes((await preview.dequeue(0))!));
    const jobs = new CustomerGenerationModel(db),crashed = await jobs.create({ id: legacyId(),guest_id: 'exhausted',upload_id: 'synthetic',template_id: '',mode: 'CLASSIC',state: 'QUEUED' });
    await customer.enqueue(crashed.id); assert.equal(await customer.dequeue(0),crashed.id);
    // Dispatch consumed, worker crashed before acquiring its lease: the durable
    // job still recovers, without a new job or any credit reservation.
    assert.ok((await jobs.leases.recoverable('customer')).some(row => row.id===crashed.id));
    await customer.enqueue(crashed.id); assert.equal(await customer.dequeue(0),crashed.id);
    await jobs.claim(crashed.id,legacyId());
    assert.ok(!(await jobs.leases.recoverable('customer')).some(row => row.id===crashed.id));
    await sql.query("UPDATE generation_worker_leases SET expires_at=now()-interval '1 second' WHERE queue_kind='customer' AND job_id=$1",[crashed.id]);
    assert.ok((await jobs.leases.recoverable('customer')).some(row => row.id===crashed.id));
    const claims = await Promise.all([jobs.claim(crashed.id,legacyId()),jobs.claim(crashed.id,legacyId())]);
    assert.equal(claims.filter(Boolean).length,1);
    assert.equal(await db.nxQuotaReservation.count({ where: { job_id: crashed.id } }),0);
    await customer.close(); await preview.close();
  } finally { await sql.query('DROP TABLE IF EXISTS generation_dispatch,generation_worker_leases'); }
}
