import type { FrameObject, GenerationObject } from '../src/objects/responses.js';
import { required, responseData } from './helpers.js';
import type { UploadedSession } from './helpers.js';
// Requires a dedicated PostgreSQL database ending in _test, plus MinIO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import sharp from 'sharp';

test('real PostgreSQL + MinIO: claims, concurrent quota, worker, presigned download', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  assert.ok(databaseUrl && new URL(databaseUrl).pathname.endsWith('_test'), 'Set TEST_DATABASE_URL to a dedicated database ending in _test');
  process.env.DATABASE_URL = databaseUrl;
  process.env.GENERATION_LIMIT = '3';
  process.env.AI_ENGINE_URL = 'http://ai-test.invalid/generate';
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
  const { db, connect, disconnect } = await import('../src/config/clients.js');
  const { services, generationModel, storage, images } = await import('../src/container.js');
  const { env } = await import('../src/config/env.js');
  const { createApp } = await import('../src/app.js');
  const { GenerationWorkerService } = await import('../src/services/generation-worker.service.js');
  const config = env;
  const app = createApp(services, config);
  let session: UploadedSession | undefined; let frame: FrameObject | undefined; const cookies: string[] = [];
  await connect();
  try {
    const source = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } }).png().toBuffer();
    const overlay = await sharp({ create: { width: 24, height: 40, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } }).png().toBuffer();
    frame = responseData<FrameObject>(await request(app).post('/api/v1/frames').set('X-API-Key', env.ADMIN_API_KEY).field('name', 'Integration frame').attach('image', overlay, 'frame.png').expect(201));
    session = responseData<UploadedSession>(await request(app).post('/api/v1/photo-sessions').set('X-API-Key', env.KIOSK_API_KEY).attach('image', source, 'photo.png').expect(201));
    const uploaded = session;
    const claims = await Promise.all([1, 2].map(() => request(app).post(`/api/v1/photo-sessions/${uploaded.code}/claim`).send({ token: uploaded.claimToken })));
    assert.deepEqual(claims.map((r) => r.status).sort(), [200, 409]);
    const cookie = required(claims.find((r) => r.status === 200)).headers['set-cookie'][0].split(';')[0]; cookies.push(cookie);
    const payload = { sessionCode: session.code, mode: 'BASIC' };
    const repeated = await Promise.all([1, 2].map(() => request(app).post('/api/v1/generations').set('Cookie', cookie).set('Idempotency-Key', 'same-request').send(payload)));
    assert.deepEqual(repeated.map((r) => r.status), [202, 202]);
    assert.equal(repeated[0].body.data.id, repeated[1].body.data.id);
    const attempts = await Promise.all([1, 2, 3].map((n) => request(app).post('/api/v1/generations').set('Cookie', cookie).set('Idempotency-Key', `next-${n}`).send({ ...payload, mode: n % 2 ? 'ADVANCED' : 'BASIC' })));
    assert.deepEqual(attempts.map((r) => r.status).sort(), [202, 202, 409]);
    assert.equal((await db.photoSession.findUniqueOrThrow({ where: { id: session.id } })).generationUsed, 3);
    // Classic remains available after the shared AI quota is exhausted.
    for (let n = 0; n < 4; n++) {
      await request(app).post('/api/v1/generations').set('Cookie', cookie).set('Idempotency-Key', `classic-${n}`)
        .send({ sessionCode: session.code, mode: 'CLASSIC', frameId: frame.id }).expect(202);
    }
    assert.equal((await db.photoSession.findUniqueOrThrow({ where: { id: session.id } })).generationUsed, 3);
    const ownedJobs = await db.generation.findMany({ where: { sessionId: session.id } });
    // Isolate queue polling from any stale fixture jobs in this dedicated test DB.
    assert.equal(await db.generation.count({ where: { status: 'QUEUED', sessionId: { not: session.id } } }), 0, 'Test DB has unrelated queued jobs');
    // Only the AI engine is a test double; PostgreSQL/MinIO are real.
    const worker = new GenerationWorkerService(generationModel, storage, images, { async generate() { return overlay; } });
    const job = required(await generationModel.next(120));
    assert.ok(ownedJobs.some((j) => j.id === job.id));
    await worker.process(job);
    const result = responseData<GenerationObject>(await request(app).get(`/api/v1/generations/${job.id}`).set('Cookie', cookie).expect(200));
    assert.equal(result.status, 'COMPLETED');
    const downloaded = await fetch(required(result.imageUrl));
    assert.equal(downloaded.status, 200);
    const metadata = await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata();
    assert.equal(metadata.width, 24); assert.equal(metadata.height, 40);
    const stale = required(await generationModel.next(120));
    await db.generation.update({ where: { id: stale.id }, data: { leaseUntil: new Date(0) } });
    await generationModel.recover(3);
    const reclaimed = required(await generationModel.next(120));
    assert.equal(reclaimed.id, stale.id);
    assert.notEqual(reclaimed.leaseToken, stale.leaseToken);
    assert.equal((await generationModel.complete(stale, frame.objectId)).count, 0);
    await generationModel.fail(reclaimed, 'Test failure');
    await generationModel.fail(reclaimed, 'Duplicate failure');
    assert.equal((await db.photoSession.findUniqueOrThrow({ where: { id: session.id } })).generationUsed, 2);
  } finally {
    if (session) {
      const jobs = await db.generation.findMany({ where: { sessionId: session.id } });
      for (const job of jobs) if (job.objectId) await storage.cleanup(job.objectId);
      await Promise.all(session.photos.map(photo => storage.cleanup(photo.objectId)));
      await db.photoSession.delete({ where: { id: session.id } });
    }
    if (frame) { await db.frame.delete({ where: { id: frame.id } }); await storage.cleanup(frame.objectId); }
    await disconnect();
  }
});
