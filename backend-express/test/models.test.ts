import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type { Client } from 'minio';
import { AppError } from '../src/lib/errors.js';
import { generationFixture, workerJobFixture } from './helpers.js';
import { GenerationModel } from '../src/models/generation.model.js';
import { StorageService } from '../src/services/storage.service.js';
import { GenerationWorkerService } from '../src/services/generation-worker.service.js';
import { ImageService } from '../src/services/image.service.js';
import { AiEngineService } from '../src/services/ai-engine.service.js';
import { createGeneration } from '../src/objects/requests.js';
import { sessionObject } from '../src/objects/responses.js';
import { sessionFixture } from './helpers.js';
import sharp from 'sharp';
import { Readable } from 'node:stream';

test('complete keys resolve across event folders, URLs, reads, cleanup and legacy objects', async () => {
  const objects = new Map<string, Buffer>();
  const client: Pick<Client, 'putObject' | 'getObject' | 'removeObject'> = {
    async putObject(bucket, key, body, size, metadata) {
      assert.equal(bucket, 'photos');
      assert.ok(Buffer.isBuffer(body));
      assert.equal(size, body.length);
      assert.equal(metadata?.['Content-Type'], 'image/png');
      objects.set(key, body);
      return { etag: 'test', versionId: null };
    },
    async getObject(_bucket, key) {
      assert.ok(objects.has(key), 'Read must resolve to an uploaded object');
      return Readable.from([objects.get(key)!]);
    },
    async removeObject(_bucket, key) {
      assert.ok(objects.delete(key), 'Cleanup must remove the uploaded object');
    },
  };
  const storage = new StorageService(client, {
    async presignedGetObject(_bucket, key) {
      assert.ok(objects.has(key), 'Signed URL must target an uploaded object');
      return `https://storage.example/photos/${key}`;
    },
  }, { MINIO_BUCKET: 'photos', PRESIGNED_URL_TTL_SECONDS: 300 });
  const body = Buffer.from('image');
  for (const event of [undefined, 'event-a', 'event-b']) {
    for (const folder of ['images', 'frames'] as const) {
      const id = await storage.put(body, 'image/png', folder, event);
      assert.ok(id.startsWith(event ? `${event}/${folder}/` : `${folder}/`));
      assert.match(id.split('/').at(-1)!, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.equal(await storage.url(id), `https://storage.example/photos/${id}`);
      assert.deepEqual(await storage.read(id), body);
      await storage.cleanup(id);
    }
  }
  const legacyId = 'd801cd3f-3d7d-4b67-a9bd-c3fa4d038d68';
  objects.set(legacyId, body);
  assert.deepEqual(await storage.read(legacyId), body);
  assert.equal(await storage.url(legacyId), `https://storage.example/photos/${legacyId}`);
  await storage.cleanup(legacyId);
  await assert.rejects(storage.put(body, 'image/png', 'images', '../other'));
  assert.equal(objects.size, 0);
});

test('generation normalizes null optional fields while retaining string validation', () => {
  for (const mode of ['CLASSIC', 'BASIC', 'ADVANCED']) {
    const parsed = createGeneration.parse({ sessionCode: 'a'.repeat(24), mode, frameId: null, templateId: null, experienceId: null });
    assert.equal(parsed.frameId, undefined);
    assert.equal(parsed.templateId, undefined);
    assert.equal(parsed.experienceId, undefined);
    for (const field of ['frameId', 'templateId', 'experienceId']) {
      for (const value of ['', 42, 'invalid/value']) {
        assert.equal(createGeneration.safeParse({ sessionCode: 'a'.repeat(24), mode, [field]: value }).success, false);
      }
    }
  }
});

test('request modes allow optional frames only for Classic and reject old modes', () => {
  const sessionCode = 'a'.repeat(24);
  const frameId = '10000000-0000-4000-8000-000000000000';
  assert.ok(createGeneration.safeParse({ sessionCode, mode: 'CLASSIC', frameId }).success);
  assert.equal(createGeneration.safeParse({ sessionCode, mode: 'CLASSIC' }).success, true);
  for (const mode of ['BASIC', 'ADVANCED']) {
    assert.ok(createGeneration.safeParse({ sessionCode, mode }).success);
    assert.equal(createGeneration.safeParse({ sessionCode, mode, frameId }).success, false);
  }
  for (const mode of ['FRAME', 'ORIGINAL']) assert.equal(createGeneration.safeParse({ sessionCode, mode }).success, false);
});

test('Classic creates more than three jobs at exhausted AI quota without reserving quota', async () => {
  let created = 0;
  const transaction = {
    photoSession: {
      async findFirst() { return { id: 'session' }; },
      async updateMany() { assert.fail('Classic must not reserve AI quota'); },
    },
    generation: { async create() { created++; return generationFixture({ mode: 'CLASSIC' }); } },
  };
  const db = { async $transaction<T>(fn: (tx: typeof transaction) => Promise<T>) { return fn(transaction); } };
  const model = new GenerationModel(db as unknown as PrismaClient);
  for (let n = 0; n < 5; n++) await model.create({ id: 'session', generationLimit: 3 }, { mode: 'CLASSIC', frameId: 'frame', requestKey: `classic-${n}` });
  assert.equal(created, 5);
});

test('Classic still rejects expired sessions', async () => {
  const transaction = { photoSession: { async findFirst() { return null; } } };
  const db = {
    async $transaction<T>(fn: (tx: typeof transaction) => Promise<T>) { return fn(transaction); },
    generation: { async findUnique() { return null; } },
  };
  const model = new GenerationModel(db as unknown as PrismaClient);
  await assert.rejects(model.create({ id: 'session', generationLimit: 3 }, { mode: 'CLASSIC', frameId: 'frame', requestKey: 'key' }), (e) => e instanceof AppError && e.status === 410);
});

test('Classic and legacy failure do not refund AI quota', async () => {
  const transaction = {
    generation: { async updateMany() { return { count: 1 }; } },
    photoSession: { async update() { assert.fail('Unmetered jobs must not refund quota'); } },
  };
  const db = { async $transaction<T>(fn: (tx: typeof transaction) => Promise<T>) { return fn(transaction); } };
  const model = new GenerationModel(db as unknown as PrismaClient);
  for (const mode of ['CLASSIC', 'ORIGINAL'] as const) await model.fail(generationFixture({ mode }), 'failed');
});

test('Basic and Advanced share the same three-generation reservation counter', async () => {
  let used = 0;
  const transaction = {
    photoSession: { async updateMany(input: { where: { generationUsed: { lt: number } } }) {
      if (used >= input.where.generationUsed.lt) return { count: 0 };
      used++; return { count: 1 };
    } },
    generation: { async create() { return generationFixture(); } },
  };
  const db = {
    async $transaction<T>(fn: (tx: typeof transaction) => Promise<T>) { return fn(transaction); },
    generation: { async findUnique() { return null; } },
  };
  const model = new GenerationModel(db as unknown as PrismaClient);
  for (const [n, mode] of (['BASIC', 'ADVANCED', 'BASIC'] as const).entries()) {
    await model.create({ id: 'session', generationLimit: 3 }, { mode, frameId: null, requestKey: `ai-${n}` });
  }
  await assert.rejects(model.create({ id: 'session', generationLimit: 3 }, { mode: 'ADVANCED', frameId: null, requestKey: 'ai-4' }), (e) => e instanceof AppError && e.code === 'GENERATION_LIMIT');
  assert.equal(used, 3);
  const info = sessionObject({ ...sessionFixture(), generationUsed: used });
  assert.equal(info.remainingGeneration, 0);
  assert.equal(info.classicUnlimited, true);
  assert.deepEqual(info.availableModes, ['CLASSIC', 'BASIC', 'ADVANCED']);
});

test('Classic adapter sends selected photos, frame, authorization and stable job id to image helper', async () => {
  const engine = new AiEngineService({ AI_ENGINE_URL: 'https://ai.example/generate', AI_ENGINE_API_KEY: 'secret', AI_ENGINE_TIMEOUT_MS: 1000 }, async (url, options) => {
    assert.equal(url, 'https://ai.example/generate');
    assert.equal(options?.method, 'POST');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('Idempotency-Key'), 'job-123');
    assert.equal(headers.get('Authorization'), 'Bearer secret');
    assert.ok(options?.body instanceof FormData);
    assert.equal(options.body.get('mode'), 'CLASSIC');
    assert.equal(options.body.get('generationId'), 'job-123');
    assert.equal(options.body.get('image'), null);
    assert.equal(options.body.get('templateId'), null);
    assert.deepEqual(await Promise.all((options.body.getAll('images') as Blob[]).map(file => file.text())), ['first', 'second']);
    assert.equal(await (options.body.get('frame') as Blob).text(), 'frame');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
  });
  assert.deepEqual(await engine.generate(Buffer.alloc(0), 'CLASSIC', 'job-123', undefined,
    { photos: [Buffer.from('first'), Buffer.from('second')], frame: Buffer.from('frame') }), Buffer.from([1, 2, 3]));
});

test('AI adapter fails clearly for missing config, HTTP failures, non-images and empty output', async () => {
  const missing = new AiEngineService({ AI_ENGINE_TIMEOUT_MS: 1000 });
  assert.throws(() => missing.assertConfigured(), (e) => e instanceof AppError && e.status === 503);
  for (const response of [new Response('bad', { status: 503 }), new Response('{}', { headers: { 'Content-Type': 'application/json' } }), new Response('', { headers: { 'Content-Type': 'image/png' } })]) {
    const engine = new AiEngineService({ AI_ENGINE_URL: 'https://ai.example/generate', AI_ENGINE_TIMEOUT_MS: 1000 }, async () => response);
    await assert.rejects(engine.generate(Buffer.alloc(0), 'CLASSIC', 'job', undefined, { photos: [Buffer.from('source')], frame: null }));
  }
});

test('AI worker dispatches both AI modes externally and normalizes the result without local compositing', async () => {
  const image = await sharp({ create: { width: 4, height: 6, channels: 3, background: 'red' } }).jpeg().toBuffer();
  const received: string[] = [];
  let completed = 0;
  const worker = new GenerationWorkerService({
    async complete() { completed++; return { count: 1 }; }, async fail() { assert.fail('Unexpected failure'); },
  }, {
    async read() { return image; }, async cleanup() {},
    async put(buffer, mime) { assert.equal(mime, 'image/png'); assert.equal((await sharp(buffer).metadata()).format, 'png'); return 'result'; },
  }, {
    normalize: new ImageService().normalize,
    async render() { assert.fail('AI modes must not use local compositing'); },
  }, { async generate(_image, mode, id) { received.push(`${mode}:${id}`); return image; } });
  for (const mode of ['BASIC', 'ADVANCED'] as const) await worker.process({ ...workerJobFixture(), id: mode, mode });
  assert.deepEqual(received, ['BASIC:BASIC', 'ADVANCED:ADVANCED']);
  assert.equal(completed, 2);
});

test('Classic worker sends selected photos and frame to compositor', async () => {
  const job = workerJobFixture();
  job.session.photo!.objectId = 'event-a/images/source';
  const first = job.session.photo!;
  const second = { ...first, id: 'second-photo', objectId: 'event-a/images/second', position: 1 };
  job.session.photos = [first, second];
  job.photoIds = [second.id, first.id];
  const overlay = await sharp({ create: { width: 4, height: 6, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } }).png().toBuffer();
  const frame = { id: 'frame', objectId: 'overlay', name: 'test', width: 4, height: 6, active: true, createdAt: new Date(), updatedAt: new Date() };
  let completed = false;
  const worker = new GenerationWorkerService({
    async complete() { completed = true; return { count: 1 }; }, async fail() { assert.fail('Unexpected failure'); },
  }, {
    async read(id) { return id === second.objectId ? Buffer.from('second-source') : overlay; }, async cleanup() {},
    async put(_body, _mime, folder, event) {
      assert.equal(folder, 'images'); assert.equal(event, 'event-a');
      return 'event-a/images/result';
    },
  }, new ImageService(), { async generate(_source, mode, _id, _config, classic) {
    assert.equal(mode, 'CLASSIC'); assert.equal(classic?.photos.length, 2);
    assert.deepEqual(classic?.photos, [Buffer.from('second-source'), overlay]);
    assert.deepEqual(classic?.frame, overlay); return overlay;
  } });
  await worker.process({ ...job, mode: 'CLASSIC', frameId: frame.id, frame });
  assert.equal(completed, true);
});

test('exhausted quota cannot enqueue a job', async () => {
  let created = false;
  const transaction = {
    photoSession: { async updateMany() { return { count: 0 }; } },
    generation: { async create() { created = true; } },
  };
  // Unit mocks implement only the ORM methods exercised by this scenario.
  const db = {
    generation: { async findUnique() { return null; } },
    async $transaction<T>(fn: (tx: typeof transaction) => Promise<T>) { return fn(transaction); },
  };
  const model = new GenerationModel(db as unknown as PrismaClient);
  await assert.rejects(model.create({ id: 'session', generationLimit: 3 }, { requestKey: 'key', mode: 'BASIC', frameId: null }), (error) => error instanceof AppError && error.code === 'GENERATION_LIMIT');
  assert.equal(created, false);
});
test('concurrent retry recovers existing idempotent job after transaction rollback', async () => {
  const existing = generationFixture();
  const db = { async $transaction() { throw new Error('unique constraint'); }, generation: { async findUnique() { return existing; } } };
  const model = new GenerationModel(db as unknown as PrismaClient);
  assert.equal(await model.create({ id: 'session', generationLimit: 3 }, { requestKey: 'key', mode: 'BASIC', frameId: null }), existing);
});
test('failed job refunds quota only when the worker still owns it', async () => {
  let refunds = 0; let count = 1;
  const transaction = {
    generation: { async updateMany() { const result = { count }; count = 0; return result; } },
    photoSession: { async update() { refunds++; } },
  };
  const db = { async $transaction<T>(fn: (tx: typeof transaction) => Promise<T>) { return fn(transaction); } };
  const model = new GenerationModel(db as unknown as PrismaClient);
  const job = { id: 'job', sessionId: 'session', leaseToken: 'lease', mode: 'BASIC' as const };
  await model.fail(job, 'failed'); await model.fail(job, 'failed');
  assert.equal(refunds, 1);
});
test('presigned URLs never outlive session expiry and never get stored', async () => {
  const calls: Array<Parameters<Client['presignedGetObject']>> = [];
  const client: Pick<Client, 'putObject' | 'getObject' | 'removeObject'> = {
    async putObject() { throw new Error('Unexpected upload'); },
    async getObject() { throw new Error('Unexpected read'); },
    async removeObject() { throw new Error('Unexpected delete'); },
  };
  const storage = new StorageService(client, { async presignedGetObject(...args) { calls.push(args); return 'url'; } }, { MINIO_BUCKET: 'photos', PRESIGNED_URL_TTL_SECONDS: 300 });
  assert.equal(await storage.url('id', new Date(Date.now() + 40000)), 'url');
  const expiry = calls[0][2];
  assert.ok(expiry !== undefined && expiry > 0 && expiry <= 40);
  assert.equal(await storage.url('id', new Date(0)), null);
  assert.equal(calls.length, 1);
});
test('ambiguous database completion leaves result intact for lease recovery', async () => {
  let removed = false; let failed = false;
  const worker = new GenerationWorkerService({
    async complete() { throw new Error('Connection lost after COMMIT'); }, async fail() { failed = true; },
  }, {
    async read() { return Buffer.from('original'); }, async put() { return 'object-id'; }, async cleanup() { removed = true; },
  }, { async render() { return Buffer.from('result'); }, normalize: new ImageService().normalize });
  await worker.process(workerJobFixture());
  assert.equal(removed, false); assert.equal(failed, false);
});
