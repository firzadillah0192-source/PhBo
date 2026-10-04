import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createMigrationApp } from '../src/migration-app.js';
import { NativeKioskService } from '../src/services/native-kiosk.service.js';
import { code, token, hash } from '../src/lib/tokens.js';
import { migrationConfigSchema } from '../src/config/migration-env.js';

function fixture() {
  const publicId = code(), claimToken = token(), access = token(), photo = 'a'.repeat(32);
  const session = { id: 'session', public_code: publicId, event_id: null, guest_id: 'isolated-kiosk-guest', status: 'ACTIVE',
    claim_token_hash: hash(claimToken), access_token_hash: null as string | null, claimed_at: null as Date | null,
    expires_at: new Date(Date.now()+3600000), created_at: new Date(), capture_upload_ids_json: JSON.stringify([photo]) };
  let claims = 0, generations = 0;
  const guest = { id: session.guest_id, ai_quota_total: 3, ai_quota_reserved: 1, ai_quota_used: 0 };
  const model = { find: async (value: string) => value === publicId ? { ...session } : null,
    credential: async (value: string) => value === session.access_token_hash ? { ...session } : null,
    guest: async () => guest, claim: async (_id: string,_claim: string,credential: string) => {
      if (session.claimed_at) return false; claims++; session.claimed_at = new Date(); session.access_token_hash = credential; return true;
    }, jobs: async () => [{ id: 'history-job' }] };
  const uploads = { config: { retentionHours: 24 }, owned: async (id: string,identity: { guest: { id: string } }) => {
    assert.equal(identity.guest.id,guest.id); assert.equal(id,photo);
    return { upload: { content_type: 'image/jpeg',width: 100,height: 150 },path: 'private-reference' };
  }, delivery: async () => ({ url: '/api/v1/photos/'+photo,expires_at: null,delivery: 'api' }),read: async () => Buffer.from('synthetic-test-photo') };
  const job = { job_id: 'b'.repeat(32),mode: 'BASIC',state: 'QUEUED',upload_id: photo,ornament_ids: [],result_id: null };
  const generation = { create: async (body: unknown,identity: { guest: { id: string } },key: string,context: unknown) => {
    generations++; assert.equal(identity.guest.id,guest.id); assert.equal(key,'retry-one');
    assert.deepEqual(context,{ id: session.id,guestId: guest.id }); return job;
  }, status: async () => job };
  const result = { publicOrigin: () => 'https://nxbooth.example' };
  const service = new NativeKioskService(model as never,uploads as never,generation as never,result as never,
    { apiKey: 'k'.repeat(32),ttlSeconds: 86400,generationLimit: 3,secureCookie: true });
  const catalog = { layouts: async () => [{ id: 'reviewed',slug: 'reviewed-strip',shot_count: 3 }], templates: async () => ({ templates: [{ id: 'published' }] }),
    experiences: async () => ({ experiences: [{ id: 'published-world' }] }),styles: async () => [],ornaments: async () => [] };
  const app = createMigrationApp(catalog as never,{ corsOrigins: ['https://nxbooth.example'],kiosk: service });
  return { app,service,session,publicId,claimToken,access,photo,get claims() { return claims; },get generations() { return generations; } };
}

test('native Kiosk upload rejects missing API key before parsing image bytes', async () => {
  const f = fixture();
  await request(f.app).post('/api/v1/photo-sessions').attach('image',Buffer.from('invalid'),{ filename: 'photo.jpg',contentType: 'image/jpeg' }).expect(401);
  assert.throws(() => f.service.authorize('other'));
  f.service.authorize('k'.repeat(32));
});

test('native Kiosk claim sets a private scoped cookie and never replaces account or web guest cookies', async () => {
  const f = fixture();
  const claimed = await request(f.app).post(`/api/v1/photo-sessions/${f.publicId}/claim`)
    .set('Cookie','photobooth_guest=web-guest; photobooth_session=web-account').send({ token: f.claimToken }).expect(200);
  const cookies = claimed.headers['set-cookie'] as unknown as string[];
  assert.equal(cookies.length,1); assert.match(cookies[0],/^photo_session=/);
  for (const part of ['HttpOnly','Secure','SameSite=Lax','Path=/api/v1']) assert.ok(cookies[0].includes(part));
  assert.equal(claimed.body.data.generationLimit,3); assert.equal(claimed.body.data.remainingGeneration,2);
  const serialized = JSON.stringify(claimed.body);
  for (const secret of [f.claimToken,f.session.claim_token_hash,f.session.access_token_hash,'private-reference','isolated-kiosk-guest']) assert.ok(!serialized.includes(secret!));
  const cookie = cookies[0].split(';')[0];
  await request(f.app).get(`/api/v1/photo-sessions/${f.publicId}`).set('Cookie',cookie).expect(200);
  await request(f.app).get(`/api/v1/photos/${f.photo}`).set('Cookie',cookie).expect(200);
  const imageMetadata=await request(f.app).get(`/api/v1/image/${f.photo}`).set('Cookie',cookie).expect(200);
  assert.equal(imageMetadata.body.data.mimeType,'image/jpeg');
  assert.equal(imageMetadata.body.data.imageUrl,`/api/v1/photos/${f.photo}`);
  await request(f.app).get('/api/v1/frames/reviewed').expect(200);
  await request(f.app).get('/api/v1/frame/reviewed-strip').expect(200);
  assert.equal((await request(f.app).get('/api/v1/photo-sessions/session/generations').set('Cookie',cookie).expect(200)).body.data.length,1);
  await request(f.app).get('/api/v1/photo-sessions/other/generations').set('Cookie',cookie).expect(403);
  await request(f.app).post(`/api/v1/photo-sessions/${f.publicId}/claim`).set('Cookie',cookie).send({ token: f.claimToken }).expect(200);
  assert.equal(f.claims,1);
  await request(f.app).post(`/api/v1/photo-sessions/${f.publicId}/claim`).send({ token: f.claimToken }).expect(409);
});

test('native Kiosk rejects wrong tokens, other sessions, other photos and expired access', async () => {
  const f = fixture();
  await request(f.app).post(`/api/v1/photo-sessions/${f.publicId}/claim`).send({ token: token() }).expect(403);
  await request(f.app).get(`/api/v1/photos/${f.photo}`).expect(401);
  f.session.claimed_at = new Date(); f.session.access_token_hash = hash(f.access);
  const cookie = `photo_session=${f.access}`;
  await request(f.app).get(`/api/v1/photo-sessions/${code()}`).set('Cookie',cookie).expect(403);
  await request(f.app).get(`/api/v1/photos/${'c'.repeat(32)}`).set('Cookie',cookie).expect(404);
  f.session.expires_at = new Date(Date.now()-1000);
  await request(f.app).get(`/api/v1/photo-sessions/${f.publicId}`).set('Cookie',cookie).expect(410);
});

test('native Kiosk generation delegates to shared generation with durable key and Kiosk context', async () => {
  const f = fixture(); f.session.claimed_at = new Date(); f.session.access_token_hash = hash(f.access);
  const cookie = `photo_session=${f.access}`, body = { sessionCode: f.publicId,mode: 'BASIC',templateId: 'published' };
  await request(f.app).post('/api/v1/generations').set('Cookie',cookie).send(body).expect(422);
  const created = await request(f.app).post('/api/v1/generations').set('Cookie',cookie).set('Idempotency-Key','retry-one').send(body).expect(202);
  assert.equal(created.body.data.status,'QUEUED'); assert.equal(f.generations,1);
  await request(f.app).post('/api/v1/generations').set('Cookie',cookie).set('Idempotency-Key','retry-one')
    .send({ ...body,photoIds: ['c'.repeat(32)] }).expect(403);
});

test('native Kiosk catalogs reuse published registry and reviewed Classic metadata', async () => {
  const f = fixture();
  assert.equal((await request(f.app).get('/api/v1/frames').expect(200)).body.data[0].shot_count,3);
  assert.equal((await request(f.app).get('/api/v1/templates').expect(200)).body.data[0].id,'published');
  assert.equal((await request(f.app).get('/api/v1/experiences').expect(200)).body.data[0].id,'published-world');
});

test('native Kiosk blocks cross-origin claim mutations and can remain unmounted', async () => {
  const f = fixture();
  await request(f.app).post(`/api/v1/photo-sessions/${f.publicId}/claim`).set('Origin','https://untrusted.example').send({ token: f.claimToken }).expect(403);
  const app = createMigrationApp({} as never,{ corsOrigins: [] });
  await request(app).get('/api/v1/photo-sessions/anything').expect(404);
});

test('native Kiosk settings reject weak keys and invalid limits', () => {
  const base = { DATABASE_URL: 'test' };
  assert.equal(migrationConfigSchema.parse(base).KIOSK_API_KEY,'');
  assert.equal(migrationConfigSchema.parse(base).KIOSK_GENERATION_LIMIT,3);
  assert.equal(migrationConfigSchema.parse(base).NATIVE_KIOSK_ENABLED,false);
  assert.equal(migrationConfigSchema.safeParse({ ...base,NATIVE_KIOSK_ENABLED: 'true' }).success,false);
  for (const settings of [{ KIOSK_API_KEY: 'weak' },{ KIOSK_GENERATION_LIMIT: 0 },{ KIOSK_PHOTO_SESSION_TTL_SECONDS: 10 }])
    assert.equal(migrationConfigSchema.safeParse({ ...base,...settings }).success,false);
});
