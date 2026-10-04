import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresGenerationQueue } from '../src/services/postgres-generation-queue.service.js';
import { nativeGenerationQueue } from '../src/services/native-generation-queue.js';
import { migrationConfigSchema } from '../src/config/migration-env.js';

test('PostgreSQL queue preserves producer/consumer contract and validates job IDs', async () => {
  const ids: string[] = [],calls: string[] = [];
  const model = { enqueue: async (kind: string,id: string) => { calls.push(kind); ids.push(id); },next: async (kind: string) => { calls.push(kind); return ids.shift() ?? null; },ready: async () => true };
  const queue = new PostgresGenerationQueue(model as never,'customer');
  await assert.rejects(queue.enqueue('invalid'));
  const id = 'a'.repeat(32); await queue.enqueue(id);
  assert.equal(await queue.dequeue(0),id); assert.equal(await queue.dequeue(0),null); assert.equal(await queue.ping(),true);
  assert.deepEqual(calls,['customer','customer','customer']);
  await queue.close(); assert.equal(await queue.dequeue(0),null); await assert.rejects(queue.enqueue(id));
});

test('closing a PostgreSQL consumer interrupts its idle wait', async () => {
  const queue = new PostgresGenerationQueue({ next: async () => null } as never,'preview');
  const pending = queue.dequeue(10);
  await new Promise(resolve => setImmediate(resolve));
  await queue.close(); assert.equal(await pending,null);
});

test('queue backend is explicit and remains Redis by default', async () => {
  const config = migrationConfigSchema.parse({ DATABASE_URL: 'test' });
  assert.equal(config.GENERATION_QUEUE_BACKEND,'redis');
  assert.equal(migrationConfigSchema.safeParse({ DATABASE_URL: 'test',GENERATION_QUEUE_BACKEND: 'unknown' }).success,false);
  const postgres = nativeGenerationQueue({} as never,{ ...config,GENERATION_QUEUE_BACKEND: 'postgres' },'preview');
  assert.ok(postgres instanceof PostgresGenerationQueue); assert.equal(postgres.kind,'preview'); await postgres.close();
  const redis = nativeGenerationQueue({} as never,config,'customer');
  assert.equal('name' in redis ? redis.name : null,config.QUEUE_NAME); await redis.close();
});
