import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Rehearse against a database created from ORIGINAL SQLAlchemy metadata, not
// handwritten fixture tables. Never accept the live database or network host.
const url = new URL(process.env.TEST_DATABASE_URL || '');
assert.equal(url.pathname, '/nxbooth_express_schema_test');
assert.ok(url.searchParams.get('host')?.startsWith('/tmp/nxbooth-express-migration-pg-'));
const sql = new Client({ connectionString: url.href });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href }) });
try {
  await sql.connect();
  const migration = await readFile(resolve(import.meta.dirname, '../../backend/migrations/015_native_worker_leases.sql'), 'utf8');
  await sql.query(migration); await sql.query(migration);
  const mapped = Prisma.dmmf.datamodel.models.filter(model => model.name.startsWith('Nx'));
  for (const model of mapped) await db[model.name[0].toLowerCase() + model.name.slice(1)].findFirst();
  await assert.rejects(sql.query("INSERT INTO generation_worker_leases VALUES ('invalid','fixture','fixture',now(),now())"));
  console.log(JSON.stringify({ originalSchemaMappingsPassed: mapped.length, migration015Idempotent: true }));
} finally { await db.$disconnect(); await sql.end(); }
