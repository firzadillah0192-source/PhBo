import type { Express } from 'express';
import type { Frame, Generation } from '@prisma/client';
import type { ApiConfig, SessionConfig } from '../src/config/env.js';
import type { FrameModel } from '../src/models/frame.model.js';
import type { PhotoSessionModel } from '../src/models/photo-session.model.js';
import type { GenerationModel } from '../src/models/generation.model.js';
import type { Repository, SessionWithPhoto } from '../src/types/domain.js';
import type { StorageService } from '../src/services/storage.service.js';
import { required, responseData, sessionFixture, generationFixture, workerJobFixture } from './helpers.js';
import type { UploadedSession } from './helpers.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { PhotoSessionService } from '../src/services/photo-session.service.js';
import { PhotoService } from '../src/services/photo.service.js';
import { BrowserSessionService } from '../src/services/browser-session.service.js';
import { GenerationService } from '../src/services/generation.service.js';
import { GenerationWorkerService } from '../src/services/generation-worker.service.js';
import { FrameService } from '../src/services/frame.service.js';
import { ImageService } from '../src/services/image.service.js';

const config: ApiConfig & SessionConfig = {
  NODE_ENV: 'test', KIOSK_API_KEY: 'k'.repeat(32), ADMIN_API_KEY: 'a'.repeat(32),
  CORS_ORIGINS: ['http://localhost:5173'], WEB_URL: 'http://localhost:5173',
  UPLOAD_MAX_MB: 1, PHOTO_SESSION_TTL_SECONDS: 86400, GENERATION_LIMIT: 2,
};
const png = () => sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer();
const framePng = () => sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();

test('CLASSIC selects 1–4 owned photos; other modes accept one and retries preserve order', async () => {
  const image = await png();
  for (let count = 1; count <= 4; count++) {
    const h = harness();
    let uploadRequest = request(h.app).post('/api/v1/photo-sessions').set('X-API-Key', config.KIOSK_API_KEY);
    for (let i = 0; i < count; i++) uploadRequest = uploadRequest.attach('image', image, `${i}.png`);
    const session = responseData<UploadedSession>(await uploadRequest.expect(201));
    assert.equal(session.photos.length, count);
    const agent = await claim(h.app, session);
    const frame = responseData<{ id: string }>(await request(h.app).post('/api/v1/frames')
      .set('X-API-Key', config.ADMIN_API_KEY).field('name', 'Test').attach('image', await framePng(), 'frame.png').expect(201));
    const payload = { sessionCode: session.code, mode: 'CLASSIC', frameId: frame.id, photoIds: session.photos.map(photo => photo.id) };
    const first = await agent.post('/api/v1/generations').set('Idempotency-Key', 'multi').send(payload).expect(202);
    assert.deepEqual(first.body.data.photoIds, payload.photoIds);
    await agent.post('/api/v1/generations').set('Idempotency-Key', 'multi').send(payload).expect(202);
    await agent.post('/api/v1/generations').set('Idempotency-Key', 'foreign').send({ ...payload, photoIds: [randomUUID()] }).expect(403);
    await agent.post('/api/v1/generations').set('Idempotency-Key', 'empty').send({ ...payload, photoIds: [] }).expect(400);
    if (count > 1) {
      await agent.post('/api/v1/generations').set('Idempotency-Key', 'multi').send({ ...payload, photoIds: [...payload.photoIds].reverse() }).expect(409);
      await agent.post('/api/v1/generations').set('Idempotency-Key', 'basic').send({ sessionCode: session.code, mode: 'BASIC', photoIds: payload.photoIds }).expect(400);
      await agent.post('/api/v1/generations').set('Idempotency-Key', 'no-frame').send({ ...payload, frameId: null }).expect(400);
      await agent.post('/api/v1/generations').set('Idempotency-Key', 'duplicate').send({ ...payload, photoIds: [payload.photoIds[0], payload.photoIds[0]] }).expect(400);
    }
    await agent.post('/api/v1/generations').set('Idempotency-Key', 'default').send({ sessionCode: session.code, mode: 'CLASSIC', frameId: frame.id }).expect(202);
  }
  let oversized = request(harness().app).post('/api/v1/photo-sessions').set('X-API-Key', config.KIOSK_API_KEY);
  for (let i = 0; i < 5; i++) oversized = oversized.attach('image', image, `${i}.png`);
  await oversized.expect(400);
});

function harness() {
  const sessions = new Map<string, SessionWithPhoto>();
  const objects = new Map<string, Buffer>();
  const frames = new Map<string, Frame>();
  const jobs = new Map<string, Generation>();
  const storage: Pick<StorageService, 'put' | 'read' | 'url' | 'cleanup'> = {
    async put(buffer, _mime, folder = 'images', event) { const id = `${event ? `${event}/` : ''}${folder}/${randomUUID()}`; objects.set(id, buffer); return id; },
    async read(id) { return required(objects.get(id)); },
    async url(id) { return `https://minio.example/${id}?signature=test`; },
    async cleanup(id) { objects.delete(id); },
  };
  const sessionModel: Repository<PhotoSessionModel> = {
    async create(data) {
      const fixture = sessionFixture();
      const photos = data.photos.create.map(photo => ({ ...required(fixture.photo), ...photo, id: randomUUID() }));
      const session = { ...fixture, ...data, photos, photo: photos[0] };
      sessions.set(session.code, session);
      return session;
    },
    async find(code) { return sessions.get(code) ?? null; },
    async findId(id) { return [...sessions.values()].find((s) => s.id === id) ?? null; },
    async findCredential(hash) { return [...sessions.values()].find(s => s.accessTokenHash === hash) ?? null; },
    async claim(id, hash, accessTokenHash) {
      const session = required(await this.findId(id));
      if (session.claimedAt || session.claimTokenHash !== hash || session.expiresAt <= new Date()) return { count: 0 };
      session.claimedAt = new Date(); session.accessTokenHash = accessTokenHash; return { count: 1 };
    },
  };
  const frameModel: Repository<FrameModel> = {
    async list() { return [...frames.values()].filter((f) => f.active); },
    async find(id) { return frames.get(id) ?? null; },
    async create(data) {
      const frame = { ...data, id: randomUUID(), active: true, createdAt: new Date(), updatedAt: new Date() };
      frames.set(frame.id, frame); return frame;
    },
    async update(id, data) { return Object.assign(required(frames.get(id)), data); },
  };
  const jobModel: Repository<Pick<GenerationModel, 'findRequest' | 'create' | 'find' | 'list'>> = {
    async findRequest(sessionId, requestKey) { return [...jobs.values()].find((j) => j.sessionId === sessionId && j.requestKey === requestKey) ?? null; },
    async create(session, data) {
      const job = generationFixture({ ...data, sessionId: session.id });
      if (data.mode !== 'CLASSIC') required(await sessionModel.findId(session.id)).generationUsed++;
      jobs.set(job.id, job); return job;
    },
    async find(id) { const job = jobs.get(id); return job ? { ...job, session: required(await sessionModel.findId(job.sessionId)) } : null; },
    async list(id) { return [...jobs.values()].filter((j) => j.sessionId === id); },
  };
  const images = new ImageService();
  const browsers = new BrowserSessionService(sessionModel);
  const sessionService = new PhotoSessionService(sessionModel, storage, images, browsers, config);
  const services = {
    browsers, sessions: sessionService,
    frames: new FrameService(frameModel, storage, images),
    photos: new PhotoService({ async find(code) {
      const session = [...sessions.values()].find((s) => s.photo?.code === code);
      return session ? { ...required(session.photo), session } : null;
    } }, storage),
    generations: new GenerationService(jobModel, frameModel, sessionService, storage, { assertConfigured() {} }),
  };
  return { app: createApp(services, config), sessions, objects, services, sessionModel, jobModel };
}
async function upload(app: Express, path = '/api/v1/photo-sessions') {
  const response = await request(app).post(path).set('X-API-Key', config.KIOSK_API_KEY).attach('image', await png(), 'photo.png').expect(201);
  return responseData<UploadedSession>(response);
}
async function claim(app: Express, session: UploadedSession) {
  const agent = request.agent(app);
  await agent.post(`/api/v1/photo-sessions/${session.code}/claim`).send({ token: session.claimToken }).expect(200);
  return agent;
}

test('multipart event routes photos and frames into event folders and rejects invalid slugs', async () => {
  const h = harness();
  for (const event of ['event-a', 'event-b']) {
    const photo = responseData<UploadedSession>(await request(h.app).post('/api/v1/photo-sessions')
      .set('X-API-Key', config.KIOSK_API_KEY).field('event', event).attach('image', await png(), 'photo.png').expect(201));
    assert.ok(photo.photo.objectId.startsWith(`${event}/images/`));
    assert.ok(h.objects.has(photo.photo.objectId));
    const frame = responseData<Frame>(await request(h.app).post('/api/v1/frames')
      .set('X-API-Key', config.ADMIN_API_KEY).field('name', 'Frame').field('event', event)
      .attach('image', await framePng(), 'frame.png').expect(201));
    assert.ok(frame.objectId.startsWith(`${event}/frames/`));
    assert.ok(h.objects.has(frame.objectId));
  }
  const count = h.objects.size;
  for (const event of ['../event-a', 'event/a', 'event\\a', '']) {
    await request(h.app).post('/api/v1/upload-image').set('X-API-Key', config.KIOSK_API_KEY)
      .field('event', event).attach('image', await png(), 'photo.png').expect(400);
    await request(h.app).post('/api/v1/frames').set('X-API-Key', config.ADMIN_API_KEY)
      .field('name', 'Frame').field('event', event).attach('image', await framePng(), 'frame.png').expect(400);
  }
  assert.equal(h.objects.size, count);
});

test('upload stores object ID and returns QR URL; claim keeps credentials in HttpOnly cookie', async () => {
  const h = harness(); const session = await upload(h.app);
  assert.equal(h.objects.size, 1);
  assert.equal(new URL(session.qrUrl).hash, `#token=${session.claimToken}`);
  assert.ok(!required(h.sessions.get(session.code)).claimTokenHash.includes(session.claimToken));
  const agent = request.agent(h.app);
  const response = await agent.post(`/api/v1/photo-sessions/${session.code}/claim`).send({ token: session.claimToken }).expect(200);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.equal(response.body.data.claimTokenHash, undefined);
  assert.match(response.headers['set-cookie'][0], /Max-Age=86[0-9]{3}/);
  assert.equal(response.body.data.accessTokenHash, undefined);
  assert.ok(required(h.sessions.get(session.code)).accessTokenHash);
  const photo = await agent.get(`/api/v1/photos/${session.photo.code}`).expect(200);
  assert.match(photo.body.data.imageUrl, /signature=/);
  await agent.get(`/api/v1/photo-sessions/${session.code}`).expect(200);
});
test('simultaneous QR claims only create one usable browser session', async () => {
  const h = harness(); const session = await upload(h.app);
  const results = await Promise.all([1, 2].map(() => request(h.app).post(`/api/v1/photo-sessions/${session.code}/claim`).send({ token: session.claimToken })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal([...h.sessions.values()].filter(s => s.accessTokenHash).length, 1);
});
test('reject wrong claim token and unauthenticated photo reads', async () => {
  const h = harness(); const session = await upload(h.app);
  await request(h.app).get(`/api/v1/photos/${session.photo.code}`).expect(401);
  await request(h.app).post(`/api/v1/photo-sessions/${session.code}/claim`).send({ token: 'x'.repeat(43) }).expect(403);
});
test('browser cannot access another session photos, info, or generation history', async () => {
  const h = harness(); const first = await upload(h.app); const second = await upload(h.app);
  const agent = await claim(h.app, first);
  await agent.get(`/api/v1/photos/${second.photo.code}`).expect(403);
  await agent.get(`/api/v1/photo-sessions/${second.code}`).expect(403);
  await agent.get(`/api/v1/photo-sessions/${second.id}/generations`).expect(403);
});
test('expired sessions deny claim and previously authenticated photo access', async () => {
  const h = harness(); const session = await upload(h.app); const agent = await claim(h.app, session);
  required(h.sessions.get(session.code)).expiresAt = new Date(0);
  await agent.get(`/api/v1/photos/${session.photo.code}`).expect(410);
  await request(h.app).post(`/api/v1/photo-sessions/${session.code}/claim`).send({ token: session.claimToken }).expect(410);
});
test('same browser may retry claim; another browser may not', async () => {
  const h = harness(); const session = await upload(h.app); const agent = await claim(h.app, session);
  await agent.post(`/api/v1/photo-sessions/${session.code}/claim`).send({ token: session.claimToken }).expect(200);
  await request(h.app).post(`/api/v1/photo-sessions/${session.code}/claim`).send({ token: session.claimToken }).expect(409);
});
test('invalid image and missing kiosk key are rejected before storage', async () => {
  const h = harness();
  await request(h.app).post('/api/v1/photo-sessions').expect(401);
  await request(h.app).post('/api/v1/photo-sessions').set('X-API-Key', config.KIOSK_API_KEY).attach('image', Buffer.from('fake'), 'photo.png').expect(400);
  await request(h.app).post('/api/v1/photo-sessions').set('X-API-Key', config.KIOSK_API_KEY).attach('image', Buffer.alloc(1024 * 1024 + 1), 'photo.png').expect(413);
  assert.equal(h.objects.size, 0);
});
test('database creation failure cleans up uploaded object', async () => {
  const h = harness(); h.sessionModel.create = async () => { throw new Error('database unavailable'); };
  await assert.rejects(h.services.sessions.create({ buffer: await png() }), /database unavailable/);
  assert.equal(h.objects.size, 0);
});
test('frame CRUD enforces admin key, soft delete hides frame, patch can reactivate', async () => {
  const h = harness();
  await request(h.app).post('/api/v1/frames').expect(401);
  const response = await request(h.app).post('/api/v1/frame').set('X-API-Key', config.ADMIN_API_KEY).field('name', 'Birthday').attach('image', await framePng(), 'frame.png').expect(201);
  const id = response.body.data.id;
  await request(h.app).get(`/api/v1/frame/${id}`).expect(200);
  await request(h.app).delete(`/api/v1/frames/${id}`).set('X-API-Key', config.ADMIN_API_KEY).expect(204);
  await request(h.app).get(`/api/v1/frames/${id}`).expect(404);
  assert.deepEqual((await request(h.app).get('/api/v1/frames')).body.data, []);
  await request(h.app).patch(`/api/v1/frames/${id}`).set('X-API-Key', config.ADMIN_API_KEY).send({ active: true }).expect(200);
  await request(h.app).get(`/api/v1/frames/${id}`).expect(200);
});
test('generation retries reuse job; mode validation and idempotency conflicts reject', async () => {
  const h = harness(); const session = await upload(h.app); const agent = await claim(h.app, session);
  const payload = { sessionCode: session.code, mode: 'BASIC' };
  const first = await agent.post('/api/v1/generations').set('Idempotency-Key', 'request-1').send(payload).expect(202);
  const second = await agent.post('/api/v1/generations').set('Idempotency-Key', 'request-1').send(payload).expect(202);
  assert.equal(first.body.data.id, second.body.data.id);
  assert.equal(required(h.sessions.get(session.code)).generationUsed, 1);
  await agent.post('/api/v1/generations').send(payload).expect(400);
  await agent.post('/api/v1/generations').set('Idempotency-Key', 'request-2').send({ ...payload, mode: 'CLASSIC' }).expect(202);
  await agent.post('/api/v1/generations').set('Idempotency-Key', 'invalid-mode-fields').send({ ...payload, experienceId: 'mini-me' }).expect(400);
  await agent.post('/api/v1/generations').set('Idempotency-Key', 'request-1').send({ ...payload, templateId: 'different' }).expect(409);
  await agent.post('/api/v1/generations').set('Idempotency-Key', 'request-1').send({ ...payload, mode: 'CLASSIC', frameId: randomUUID() }).expect(409);
  await agent.get(`/api/v1/generations/${first.body.data.id}`).expect(200);
  await agent.get(`/api/v1/photo-sessions/${session.code}/generations`).expect(200);
});
test('generation accepts null optional fields and treats omitted fields as the same retry', async () => {
  const h = harness(); const session = await upload(h.app); const agent = await claim(h.app, session);
  const payload = { sessionCode: session.code, mode: 'ADVANCED', experienceId: 'mini-me' };
  const first = await agent.post('/api/v1/generations').set('Idempotency-Key', 'nullable-fields')
    .send({ ...payload, frameId: null, templateId: null }).expect(202);
  const retry = await agent.post('/api/v1/generations').set('Idempotency-Key', 'nullable-fields')
    .send(payload).expect(202);
  assert.equal(first.body.data.id, retry.body.data.id);
  await agent.post('/api/v1/generations').set('Idempotency-Key', 'invalid-advanced-frame')
    .send({ ...payload, frameId: randomUUID() }).expect(400);
});

test('legacy upload-image and image routes follow the same session flow', async () => {
  const h = harness(); const session = await upload(h.app, '/api/v1/upload-image'); const agent = await claim(h.app, session);
  await agent.get(`/api/v1/image/${session.photo.code}`).expect(200);
});
test('untrusted browser origins cannot mutate state', async () => {
  const h = harness();
  await request(h.app).post('/api/v1/photo-sessions').set('Origin', 'https://evil.example').set('X-API-Key', config.KIOSK_API_KEY).expect(403);
});
test('malformed JSON and identifiers return structured 400 errors', async () => {
  const h = harness();
  await request(h.app).get('/api/v1/frames/invalid').expect(400);
  const response = await request(h.app).post('/api/v1/generations').set('Content-Type', 'application/json').send('{').expect(400);
  assert.equal(response.body.error.code, 'INVALID_JSON');
});
test('local frame generation composites real pixels and preserves canvas dimensions', async () => {
  const images = new ImageService();
  const frame = await sharp({ create: { width: 4, height: 6, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.5 } } }).png().toBuffer();
  const result = await images.render(await png(), frame);
  const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 4); assert.equal(info.height, 6);
  assert.ok(data[0] > 100 && data[0] < 150); assert.ok(data[2] > 100 && data[2] < 150);
});
test('worker failure records terminal error; stale worker completion cleans its own result', async () => {
  const failed: unknown[][] = []; const removed: string[] = [];
  const job = workerJobFixture();
  const model = { async fail(...args: unknown[]) { failed.push(args); }, async complete() { return { count: 0 }; } };
  const storage: Pick<StorageService, 'read' | 'cleanup' | 'put'> = { async read() { throw new Error('storage down'); }, async cleanup(id) { removed.push(id); }, async put() { return 'output'; } };
  const worker = new GenerationWorkerService(model, storage, new ImageService());
  await worker.process(job); assert.equal(failed.length, 1);
  storage.read = png;
  await worker.process(job); assert.deepEqual(removed, ['output']);
});

test('unclaimed session expires; late claim and retries never extend the original deadline', async () => {
  const h = harness();
  const unclaimed = await upload(h.app);
  required(h.sessions.get(unclaimed.code)).expiresAt = new Date(0);
  await request(h.app).post(`/api/v1/photo-sessions/${unclaimed.code}/claim`).send({ token: unclaimed.claimToken }).expect(410);
  const session = await upload(h.app);
  const row = required(h.sessions.get(session.code));
  row.expiresAt = new Date(Date.now() + 60000);
  const deadline = row.expiresAt.getTime();
  const agent = await claim(h.app, session);
  await agent.post(`/api/v1/photo-sessions/${session.code}/claim`).send({ token: session.claimToken }).expect(200);
  assert.equal(row.expiresAt.getTime(), deadline);
  const credential = row.accessTokenHash;
  assert.ok(credential);
  row.expiresAt = new Date(0);
  await agent.get(`/api/v1/photo-sessions/${session.code}`).expect(410);
  await agent.get(`/api/v1/photo-sessions/${session.id}/generations`).expect(410);
  await agent.post('/api/v1/generations').set('Idempotency-Key', 'expired').send({ sessionCode: session.code, mode: 'BASIC' }).expect(410);
});
