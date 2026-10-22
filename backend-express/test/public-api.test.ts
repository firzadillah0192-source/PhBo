import test from 'node:test';
import assert from 'node:assert/strict';
import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { ZodError } from 'zod';
import multer from 'multer';
import { AppError } from '../src/lib/errors.js';
import { PublicApiKeyService, maxKeysPerAccount, type PublicApiScope } from '../src/services/public-api-key.service.js';
import type { PublicApiKeyModel, PublicApiKeyRow } from '../src/models/public-api-key.model.js';
import { publicApiRoutes, type PublicApiDeps } from '../src/routes/public-api.routes.js';
import { publicApiKeyManagementRoutes } from '../src/routes/public-api-keys.routes.js';

const pepper = 'synthetic-test-pepper-0123456789abcdef';
class MemoryModel {
  rows = new Map<string, PublicApiKeyRow>();
  accounts = new Map<string, { id: string; status: string }>([['acc-a', { id: 'acc-a', status: 'active' }], ['acc-b', { id: 'acc-b', status: 'active' }], ['acc-off', { id: 'acc-off', status: 'suspended' }]]);
  touched: string[] = [];
  async create(key: Pick<PublicApiKeyRow, 'id' | 'account_id' | 'name' | 'prefix' | 'secret_hash' | 'scopes' | 'expires_at' | 'rotated_from'>) {
    const row = { ...key, created_at: new Date(), revoked_at: null, last_used_at: null } as PublicApiKeyRow; this.rows.set(row.id, row); return row;
  }
  async issueLocked(key: Parameters<MemoryModel['create']>[0], maximum: number, grace: Date | null) {
    if (await this.activeCount(key.account_id) >= maximum) throw new AppError(409,'API_KEY_LIMIT','Limit');
    const row = await this.create(key);
    if(key.rotated_from && grace) await this.limitExpiry(key.account_id,key.rotated_from,grace);
    return row;
  }
  async byId(id: string) { return this.rows.get(id) ?? null; }
  async account(id: string) { return this.accounts.get(id) ?? null; }
  async find(accountId: string, id: string) { const row = this.rows.get(id); return row?.account_id === accountId ? row : null; }
  async list(accountId: string) { return [...this.rows.values()].filter(row => row.account_id === accountId); }
  async activeCount(accountId: string) { return [...this.rows.values()].filter(row => row.account_id === accountId && !row.revoked_at && (!row.expires_at || row.expires_at > new Date())).length; }
  async revoke(accountId: string, id: string) { const row = await this.find(accountId, id); if (row) row.revoked_at ??= new Date(); return row; }
  async limitExpiry(accountId: string, id: string, at: Date) { const row = await this.find(accountId, id); if (row && (!row.expires_at || row.expires_at > at)) row.expires_at = at; }
  async touch(id: string, generation: boolean) { this.touched.push(`${id}:${generation}`); }
  async usage() { return [{ day: '2026-10-18', requests: 3, generations: 1 }]; }
  resultRows: { id: string; created_at: Date }[] = [];
  async resultIds(_account: string, cursor: { at: Date; id: string } | null, limit: number) {
    const rows = this.resultRows.filter(row => !cursor || row.created_at < cursor.at || (row.created_at.getTime() === cursor.at.getTime() && row.id < cursor.id));
    return rows.slice(0, limit);
  }
}
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) { res.status(error.status).json({ detail: { error_code: error.code, message: error.message } }); return; }
  if (error instanceof ZodError) { res.status(422).json({ detail: { error_code: 'VALIDATION_FAILED' } }); return; }
  if (error instanceof multer.MulterError) { res.status(413).json({ detail: { error_code: 'VALIDATION_FAILED' } }); return; }
  res.status(500).json({ error_code: 'INTERNAL_ERROR' });
};

function setup(over: Partial<PublicApiDeps> = {}) {
  const model = new MemoryModel(), keys = new PublicApiKeyService(model as unknown as PublicApiKeyModel, pepper);
  const calls = { created: [] as unknown[][], uploaded: [] as string[] };
  const deps: PublicApiDeps = { generationEnabled: true,
    keys, keyModel: model as unknown as PublicApiDeps['keyModel'], maxUploadBytes: 1024,
    catalog: { async templates() { return { count: 3, templates: [
      { id: 't-ok', name: 'OK', description: 'd', preview_url: '/api/templates/t-ok/preview', width: 10, height: 20, basic_available: true, enabled: true, sort_order: 1 },
      { id: 't-off', name: 'Off', description: 'd', preview_url: null, width: 10, height: 20, basic_available: true, enabled: false, sort_order: 2 },
      { id: 't-noasset', name: 'No asset', description: 'd', preview_url: null, width: 10, height: 20, basic_available: false, enabled: true, sort_order: 3 }] }; } } as PublicApiDeps['catalog'],
    uploads: { async create(file: unknown, identity: { account: { id: string } | null }) { calls.uploaded.push(identity.account!.id); assert.ok(file); return { upload_id: 'u'.repeat(32), normalized_content_type: 'image/jpeg', size_bytes: 5, width: 2, height: 3,
      created_at: new Date('2026-10-18T00:00:00Z'), expires_at: new Date('2026-10-19T00:00:00Z'), filename: 'secret-name.jpg', sha256: 'x', preview_url: '/api/uploads/x/preview' } as never; } } as unknown as PublicApiDeps['uploads'],
    generations: {
      async create(...args: unknown[]) { calls.created.push(args); return { job_id: 'j1', state: 'QUEUED', upload_id: 'u', template_id: 't-ok', experience_id: null, mode: 'BASIC', layout_id: null, frame_style_id: null, ornament_ids: [], created_at: new Date('2026-10-18T00:00:00Z') } as never; },
      async status(id: string, identity: { account: { id: string } | null }) {
        if (identity.account?.id !== 'acc-a') throw new AppError(404, 'JOB_NOT_FOUND', 'Generation job unavailable');
        return { job_id: id, state: 'FAILED', upload_id: 'u', template_id: 't-ok', created_at: new Date(), updated_at: new Date(), started_at: null, finished_at: null,
          provider: 'secret-provider', model: 'secret-model', error_code: 'PROVIDER_FAILED', error_message: 'upstream said secret', result_id: null, result_url: null,
          credit_charge: { status: 'REFUNDED', credits: 1, calculation: { usd_to_idr: 18000, token_usd: 1 } } } as never;
      } } as PublicApiDeps['generations'],
    results: {
      async owned(id: string) { if (id.startsWith('ee')) throw new AppError(404, 'RESULT_EXPIRED', 'gone'); return { result: { id, content_type: 'image/png' }, job: {}, kiosk: false } as never; },
      metadata(found: { result: { id: string } }) { return { result_id: found.result.id, job_id: 'j1', template_id: 't-ok', content_type: 'image/png', size_bytes: 9, width: 4, height: 4, sha256: 'h',
        provider: 'secret-provider', model: 'secret-model', result_url: '/api/results/x', created_at: new Date('2026-10-18T00:00:00Z'), expires_at: new Date('2026-11-01T00:00:00Z') } as never; },
      async rendition() { return Buffer.from('PNGBYTES'); } } as PublicApiDeps['results'],
    ...over };
  const app = express(); app.use(express.json()); app.use(cookieParser());
  app.use('/api/public/v1', publicApiRoutes(deps));
  app.use('/api/account/api-keys', publicApiKeyManagementRoutes(keys, { async resolve(cookies) { const id = cookies.acct as string | undefined; return { account: id ? { id } : null } as never; } }));
  app.use(errors);
  return { app, model, keys, calls };
}
const bearer = (secret: string) => ({ Authorization: `Bearer ${secret}` });
async function issue(ctx: ReturnType<typeof setup>, scopes: PublicApiScope[], account = 'acc-a') {
  return ctx.keys.create(account, { name: 'test', scopes });
}

test('key secret is shown once and only a keyed hash is stored', async () => {
  const ctx = setup(); const created = await issue(ctx, ['catalog:read']);
  assert.match(created.secret, /^nxb_live_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
  const secretPart = created.secret.split('_').slice(3).join('_');
  const stored = JSON.stringify([...ctx.model.rows.values()]);
  assert.ok(!stored.includes(secretPart));
  assert.ok(!JSON.stringify(await ctx.keys.list('acc-a')).includes(secretPart));
});

test('missing, malformed, wrong-secret, unknown, revoked and expired keys are rejected the same way', async () => {
  const ctx = setup(); const key = await issue(ctx, ['catalog:read']);
  const codes: string[] = [];
  for (const header of [undefined, 'Bearer nope', `Bearer ${key.secret.slice(0, -1)}${key.secret.endsWith('A')?'B':'A'}`, `Bearer nxb_live_${'0'.repeat(16)}_${'A'.repeat(43)}`, `Basic ${key.secret}`]) {
    const res = await request(ctx.app).get('/api/public/v1/templates').set(header ? { Authorization: header } : {}).expect(401);
    codes.push(res.body.detail.error_code);
  }
  assert.deepEqual([...new Set(codes)], ['API_KEY_INVALID']);
  await request(ctx.app).get('/api/public/v1/templates').set(bearer(key.secret)).expect(200);
  await ctx.keys.revoke('acc-a', key.id);
  await request(ctx.app).get('/api/public/v1/templates').set(bearer(key.secret)).expect(401);
  const expiring = await issue(ctx, ['catalog:read']); ctx.model.rows.get(expiring.id)!.expires_at = new Date(Date.now() - 1000);
  await request(ctx.app).get('/api/public/v1/templates').set(bearer(expiring.secret)).expect(401);
});

test('a suspended account cannot use its keys', async () => {
  const ctx = setup(); const key = await issue(ctx, ['catalog:read'], 'acc-off');
  const res = await request(ctx.app).get('/api/public/v1/templates').set(bearer(key.secret)).expect(403);
  assert.equal(res.body.detail.error_code, 'ACCOUNT_UNAVAILABLE');
});

test('scopes: a read-only key can neither upload nor generate, and keys never reach management routes', async () => {
  const ctx = setup(); const key = await issue(ctx, ['catalog:read', 'generations:read', 'results:read']);
  await request(ctx.app).post('/api/public/v1/inputs').set(bearer(key.secret)).attach('file', Buffer.from('abc'), 'a.jpg').expect(403);
  const res = await request(ctx.app).post('/api/public/v1/generations').set(bearer(key.secret)).set('Idempotency-Key', 'k1').send({ template_id: 't-ok', input_id: 'u' }).expect(403);
  assert.equal(res.body.detail.error_code, 'API_KEY_SCOPE_FORBIDDEN');
  assert.equal(ctx.calls.created.length, 0);
  await request(ctx.app).get('/api/public/v1/usage').set(bearer(key.secret)).expect(403);
  await request(ctx.app).get('/api/account/api-keys').set(bearer(key.secret)).expect(401);
});

test('catalog lists only enabled templates with registered assets and does not expose internals', async () => {
  const ctx = setup(); const key = await issue(ctx, ['catalog:read']);
  const res = await request(ctx.app).get('/api/public/v1/templates').set(bearer(key.secret)).expect(200);
  assert.equal(res.body.templates[0].credit_cost,50);
  assert.deepEqual(res.body.templates.map((row: { id: string }) => row.id), ['t-ok']);
  assert.deepEqual(Object.keys(res.body.templates[0]).sort(), ['credit_cost', 'description', 'height', 'id', 'input', 'mode', 'name', 'preview_url', 'width']);
  await request(ctx.app).get('/api/public/v1/templates/t-ok').set(bearer(key.secret)).expect(200);
  await request(ctx.app).get('/api/public/v1/templates/t-off').set(bearer(key.secret)).expect(404);
  assert.equal(res.headers['cache-control'], 'private, no-store');
});

test('generation requires an idempotency key, maps to BASIC for the key owner and namespaces the key', async () => {
  const ctx = setup(); const key = await issue(ctx, ['generations:create'], 'acc-b');
  await request(ctx.app).post('/api/public/v1/generations').set(bearer(key.secret)).send({ template_id: 't-ok', input_id: 'u' }).expect(400);
  await request(ctx.app).post('/api/public/v1/generations').set(bearer(key.secret)).set('Idempotency-Key', 'k1').send({ template_id: 't-ok', input_id: 'u', mode: 'ADVANCED' }).expect(422);
  const res = await request(ctx.app).post('/api/public/v1/generations').set(bearer(key.secret)).set('Idempotency-Key', 'k1').send({ template_id: 't-ok', input_id: 'u' }).expect(202);
  assert.deepEqual(Object.keys(res.body).sort(), ['created_at', 'job_id', 'state', 'template_id']);
  const [body, identity, requestKey] = ctx.calls.created[0] as [Record<string, unknown>, { account: { id: string }; guest: null }, string];
  assert.deepEqual(body, { mode: 'BASIC', upload_id: 'u', template_id: 't-ok' });
  assert.equal(identity.account.id, 'acc-b'); assert.equal(identity.guest, null);
  assert.equal(requestKey, 'pub_k1');
  assert.ok(ctx.model.touched.some(entry => entry.endsWith(':true')));
});

test('status is an allow-list: no provider, model, error text or pricing calculation; other tenants get 404', async () => {
  const ctx = setup(); const a = await issue(ctx, ['generations:read'], 'acc-a'), b = await issue(ctx, ['generations:read'], 'acc-b');
  const res = await request(ctx.app).get('/api/public/v1/generations/j1').set(bearer(a.secret)).expect(200);
  const text = JSON.stringify(res.body);
  for (const leaked of ['secret-provider', 'secret-model', 'upstream said secret', 'usd_to_idr', 'calculation']) assert.ok(!text.includes(leaked), leaked);
  assert.equal(res.body.error_code, 'PROVIDER_FAILED'); assert.deepEqual(res.body.credit_charge, { status: 'REFUNDED', credits: 1 });
  await request(ctx.app).get('/api/public/v1/generations/j1').set(bearer(b.secret)).expect(404);
});

test('input upload returns a public DTO without filenames or storage paths', async () => {
  const ctx = setup(); const key = await issue(ctx, ['inputs:write'], 'acc-a');
  const res = await request(ctx.app).post('/api/public/v1/inputs').set(bearer(key.secret)).attach('file', Buffer.from('abc'), 'a.jpg').expect(201);
  assert.deepEqual(Object.keys(res.body).sort(), ['content_type', 'created_at', 'expires_at', 'height', 'input_id', 'size_bytes', 'width']);
  assert.deepEqual(ctx.calls.uploaded, ['acc-a']);
  await request(ctx.app).post('/api/public/v1/inputs').set(bearer(key.secret)).attach('file', Buffer.alloc(2048), 'big.jpg').expect(413);
});

test('results: paginated list skips expired items, DTO hides provider/model, download streams bytes', async () => {
  const ctx = setup(); const key = await issue(ctx, ['results:read']);
  const id = (n: number) => n.toString(16).padStart(32, '0');
  ctx.model.resultRows = [{ id: id(3), created_at: new Date('2026-10-18T03:00:00Z') }, { id: 'ee'.padEnd(32, '0'), created_at: new Date('2026-10-18T02:00:00Z') }, { id: id(1), created_at: new Date('2026-10-18T01:00:00Z') }];
  const first = await request(ctx.app).get('/api/public/v1/results?limit=2').set(bearer(key.secret)).expect(200);
  assert.equal(first.body.results.length, 1); assert.ok(first.body.next_cursor);
  assert.ok(!JSON.stringify(first.body).includes('secret-'));
  const second = await request(ctx.app).get(`/api/public/v1/results?limit=2&cursor=${first.body.next_cursor}`).set(bearer(key.secret)).expect(200);
  assert.deepEqual(second.body.results.map((row: { result_id: string }) => row.result_id), [id(1)]); assert.equal(second.body.next_cursor, null);
  await request(ctx.app).get('/api/public/v1/results?cursor=garbage').set(bearer(key.secret)).expect(422);
  await request(ctx.app).get('/api/public/v1/results?limit=500').set(bearer(key.secret)).expect(422);
  const file = await request(ctx.app).get(`/api/public/v1/results/${id(1)}/download`).set(bearer(key.secret)).buffer().expect(200);
  assert.equal(file.headers['content-type'], 'image/png'); assert.equal(file.body.toString(), 'PNGBYTES');
  assert.match(file.headers['content-disposition'], /^attachment; filename="nxbooth-[a-f0-9]{32}\.png"$/);
});

test('rate limit is per key, returns 429 with Retry-After and does not affect other keys', async () => {
  const counts = new Map<string, number>();
  const ctx = setup({ window: async key => { counts.set(key, (counts.get(key) ?? 0) + 1); return counts.get(key)!; } });
  const a = await issue(ctx, ['inputs:write'], 'acc-a'), b = await issue(ctx, ['inputs:write'], 'acc-b');
  const send = (secret: string) => request(ctx.app).post('/api/public/v1/inputs').set(bearer(secret)).attach('file', Buffer.from('abc'), 'a.jpg');
  for (let i = 0; i < 20; i++) await send(a.secret).expect(201);
  const limited = await send(a.secret).expect(429);
  assert.equal(limited.headers['retry-after'], '60');
  await send(b.secret).expect(201);
});

test('rate limiting falls back to process memory when the shared counter fails', async () => {
  const ctx = setup({ window: async () => { throw new Error('redis down'); } });
  const key = await issue(ctx, ['inputs:write']);
  for (let i = 0; i < 20; i++) await request(ctx.app).post('/api/public/v1/inputs').set(bearer(key.secret)).attach('file', Buffer.from('abc'), 'a.jpg').expect(201);
  await request(ctx.app).post('/api/public/v1/inputs').set(bearer(key.secret)).attach('file', Buffer.from('abc'), 'a.jpg').expect(429);
});

test('key management needs a signed-in account, is tenant-scoped, limits count and rotates with a grace period', async () => {
  const ctx = setup();
  await request(ctx.app).post('/api/account/api-keys').send({ name: 'x', scopes: ['catalog:read'] }).expect(401);
  const created = await request(ctx.app).post('/api/account/api-keys').set('Cookie', 'acct=acc-a').send({ name: 'Prod', scopes: ['catalog:read', 'catalog:read'] }).expect(201);
  assert.deepEqual(created.body.scopes, ['catalog:read']); assert.match(created.body.secret, /^nxb_live_/);
  await request(ctx.app).post('/api/account/api-keys').set('Cookie', 'acct=acc-a').send({ name: 'Bad', scopes: ['admin:all'] }).expect(422);
  await request(ctx.app).post('/api/account/api-keys').set('Cookie', 'acct=acc-a').send({ name: 'Bad', scopes: ['catalog:read'], extra: 1 }).expect(422);
  const listed = await request(ctx.app).get('/api/account/api-keys').set('Cookie', 'acct=acc-a').expect(200);
  assert.ok(!JSON.stringify(listed.body).includes('secret'));
  assert.equal((await request(ctx.app).get('/api/account/api-keys').set('Cookie', 'acct=acc-b').expect(200)).body.keys.length, 0);
  await request(ctx.app).post(`/api/account/api-keys/${created.body.id}/revoke`).set('Cookie', 'acct=acc-b').expect(404);
  const rotated = await request(ctx.app).post(`/api/account/api-keys/${created.body.id}/rotate`).set('Cookie', 'acct=acc-a').expect(201);
  assert.notEqual(rotated.body.id, created.body.id); assert.equal(rotated.body.rotated_from, created.body.id);
  await request(ctx.app).get('/api/public/v1/templates').set(bearer(created.body.secret)).expect(200);
  const old = ctx.model.rows.get(created.body.id)!;
  assert.ok(old.expires_at && old.expires_at.getTime() > Date.now() && old.expires_at.getTime() <= Date.now() + 24 * 3600000);
  old.expires_at = new Date(Date.now() - 1);
  await request(ctx.app).get('/api/public/v1/templates').set(bearer(created.body.secret)).expect(401);
  await request(ctx.app).get('/api/public/v1/templates').set(bearer(rotated.body.secret)).expect(200);
  for (let i = 0; i < maxKeysPerAccount; i++) await ctx.keys.create('acc-b', { name: `k${i}`, scopes: ['catalog:read'] });
  await request(ctx.app).post('/api/account/api-keys').set('Cookie', 'acct=acc-b').send({ name: 'over', scopes: ['catalog:read'] }).expect(409);
});

test('the pepper must be long enough', () => {
  assert.throws(() => new PublicApiKeyService(new MemoryModel() as unknown as PublicApiKeyModel, 'short'));
});

test('the application mounts the Public API only when configured, without disturbing existing routes', async () => {
  const { createMigrationApp } = await import('../src/migration-app.js');
  const ctx = setup();
  const catalog = { async templates() { return { templates: [], count: 0 }; } } as never;
  const account = { signer: { unsign: () => null }, config: { cookieSecure: true, sessionDays: 1 }, async resolve() { return { account: null, guest: null, clearAccount: false, newGuest: null }; } } as never;
  const services = [{} as never, {} as never, {} as never] as const;
  const without = createMigrationApp(catalog, { corsOrigins: [] }, account, ...services);
  await request(without).get('/api/public/v1/templates').expect(404);
  await request(without).get('/api/account/api-keys').expect(404);
  const withKeys = createMigrationApp(catalog, { corsOrigins: [], publicApi: { keys: ctx.keys, keyModel: ctx.model as never } }, account, ...services);
  await request(withKeys).get('/api/public/v1/templates').expect(401);
  await request(withKeys).get('/api/account/api-keys').expect(401);
  await request(withKeys).get('/api/templates').expect(200);
  await request(withKeys).get('/api/v1/templates').expect(404);
});

test('Storage-only activation denies upload and generation even for write-scoped keys', async () => {
  const ctx=setup({generationEnabled:false}); const key=await issue(ctx,['inputs:write','generations:create','results:read']);
  await request(ctx.app).post('/api/public/v1/inputs').set(bearer(key.secret)).expect(404);
  await request(ctx.app).post('/api/public/v1/generations').set(bearer(key.secret)).send({}).expect(404);
  assert.equal(ctx.calls.created.length,0); assert.equal(ctx.calls.uploaded.length,0);
});

test('OpenAPI and capability metadata are public and accurately describe activation', async () => {
  const {createMigrationApp}=await import('../src/migration-app.js');
  const app=createMigrationApp({} as never,{corsOrigins:[]});
  const caps=await request(app).get('/api/public/v1/capabilities').expect(200);
  assert.deepEqual(caps.body,{enabled:false,dashboard:false,webhooks:false,storage:false,generation:false,scopes:['results:read','usage:read']});
  const spec=await request(app).get('/api/public/v1/openapi.json').expect(200);
  assert.equal(spec.body.openapi,'3.1.0');
  for(const value of Object.values(spec.body.paths) as {get:{security:unknown}}[]) assert.deepEqual(value.get.security,[{bearerAuth:[]}]);
  assert.ok(!JSON.stringify(spec.body).includes('nxb_live_'));
});


test('generation API accepts folder routing but rejects custom prompts, model, fast and unsupported personalization',async()=>{
 const ctx=setup();const key=await issue(ctx,['generations:create']);
 for(const extra of [{prompt:'secret'},{model:'private'},{lane:'fast'},{event_name:'not-supported'},{captured_at:new Date().toISOString()}])
  await request(ctx.app).post('/api/public/v1/generations').set(bearer(key.secret)).set('Idempotency-Key','contract-1').send({input_id:'u',template_id:'t-ok',...extra}).expect(422);
 await request(ctx.app).post('/api/public/v1/generations').set(bearer(key.secret)).set('Idempotency-Key','contract-2').send({input_id:'u',template_id:'t-ok',folder_id:'a'.repeat(32)}).expect(202);
 assert.equal((ctx.calls.created[0][0] as {folder_id:string}).folder_id,'a'.repeat(32));
});


test('generation capabilities and OpenAPI expose authenticated generation contract only when enabled',async()=>{
 const {createMigrationApp}=await import('../src/migration-app.js');const ctx=setup();
 const app=createMigrationApp({} as never,{corsOrigins:[],publicApi:{keys:ctx.keys,keyModel:ctx.model as never,generationEnabled:true}},{} as never,{} as never,{} as never,{} as never);
 const caps=await request(app).get('/api/public/v1/capabilities').expect(200);assert.equal(caps.body.generation,true);assert.ok(caps.body.scopes.includes('generations:create'));
 const spec=await request(app).get('/api/public/v1/openapi.json').expect(200);
 assert.deepEqual(spec.body.paths['/generations'].post.security,[{bearerAuth:[]}]);assert.equal(spec.body.paths['/generations'].post.requestBody.content['application/json'].schema.additionalProperties,false);
 assert.equal(spec.body.paths['/inputs'].post.requestBody.content['multipart/form-data'].schema.required[0],'file');
});
