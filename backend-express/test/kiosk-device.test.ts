import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createMigrationApp } from '../src/migration-app.js';
import { NativeKioskService } from '../src/services/native-kiosk.service.js';
import { KioskDeviceService, type DeviceModel } from '../src/services/kiosk-device.service.js';
import { tokenHash } from '../src/services/customer-credentials.service.js';

type Actor = { id: string; role: string; is_active: boolean; email: string | null };
const key = 'k'.repeat(32);

async function fixture() {
  let now = Date.UTC(2026, 9, 14, 8, 0, 0);
  const actors = new Map<string, Actor>([
    ['staff', { id: 'staff', role: 'kiosk_operator', is_active: true, email: 'staff@example.com' }],
    ['boss', { id: 'boss', role: 'superadmin', is_active: true, email: 'boss@example.com' }],
    ['content', { id: 'content', role: 'content_manager', is_active: true, email: 'content@example.com' }]]);
  const accounts = new Map([['a-staff', { id: 'a-staff', status: 'active', email: 'staff@example.com' }], ['a-boss', { id: 'a-boss', status: 'active', email: 'boss@example.com' }],
    ['a-content', { id: 'a-content', status: 'active', email: 'content@example.com' }], ['a-none', { id: 'a-none', status: 'active', email: 'nobody@example.com' }]]);
  const sessions = new Map<string, { account_id: string; is_admin: boolean; admin_user_id: string; admin_role: string; expires_at: Date }>();
  const audits: string[] = [];
  const byEmail = (email: string) => [...actors.values()].find(a => a.email === email && a.is_active) ?? null;
  const model: DeviceModel = {
    actor: async id => actors.get(id) ?? null, actorForEmail: async email => byEmail(email), account: async id => accounts.get(id) ?? null,
    session: async raw => sessions.get(tokenHash(raw)) ?? null,
    createSession: async (raw, actorId, accountId, expiresAt, name) => { sessions.set(tokenHash(raw), { account_id: accountId, is_admin: false, admin_user_id: actorId, admin_role: 'kiosk_device', expires_at: expiresAt }); audits.push(`${actorId}:${name}`); },
    extend: async (raw, expiresAt) => { sessions.get(tokenHash(raw))!.expires_at = expiresAt; } };
  const devices = new KioskDeviceService(model, async cookies => typeof cookies.acct === 'string' && accounts.has(cookies.acct) ? { id: cookies.acct, email: accounts.get(cookies.acct)!.email } : null,
    { sessionDays: 14, activationUrl: 'https://nxbooth.example/kiosk/activate', now: () => now });
  const kiosk = new NativeKioskService({} as never, {} as never, {} as never, {} as never, { apiKey: key, ttlSeconds: 86400, generationLimit: 3, secureCookie: true, devices });
  const dir = await mkdtemp(join(tmpdir(), 'device-update-'));
  const bytes = Buffer.from('installer');
  await writeFile(join(dir, 'NXBooth-Setup-1.2.0.exe'), bytes);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ version: '1.2.0', file: 'NXBooth-Setup-1.2.0.exe', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }));
  const app = createMigrationApp({} as never, { corsOrigins: ['https://nxbooth.example'], kiosk, devices, desktopUpdateDir: dir });
  return { app, actors, sessions, audits, advance: (ms: number) => { now += ms; } };
}
async function activate(f: Awaited<ReturnType<typeof fixture>>, account = 'a-staff', name = 'Event PC 1') {
  const code = (await request(f.app).post('/api/v1/desktop/device/code').send({ device_name: name }).expect(201)).body.data;
  await request(f.app).post('/api/desktop-device/approve').set('Cookie', `acct=${account}`).send({ user_code: code.user_code }).expect(200);
  const token = (await request(f.app).post('/api/v1/desktop/device/token').send({ device_code: code.device_code }).expect(200)).body.data;
  return { code, token };
}

test('device login: code, approval by an allowed staff member, token handed over once', async () => {
  const f = await fixture();
  const code = (await request(f.app).post('/api/v1/desktop/device/code').send({ device_name: 'Event PC 1' }).expect(201)).body.data;
  assert.match(code.user_code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(code.verification_url, 'https://nxbooth.example/kiosk/activate');
  assert.deepEqual((await request(f.app).post('/api/v1/desktop/device/token').send({ device_code: code.device_code }).expect(200)).body.data, { status: 'pending' });
  const lookup = await request(f.app).post('/api/desktop-device/lookup').set('Cookie', 'acct=a-staff').send({ user_code: code.user_code.toLowerCase().replace('-', ' ') }).expect(200);
  assert.equal(lookup.body.data.device_name, 'Event PC 1');
  await request(f.app).post('/api/desktop-device/approve').set('Cookie', 'acct=a-staff').send({ user_code: code.user_code }).expect(200);
  await request(f.app).post('/api/desktop-device/approve').set('Cookie', 'acct=a-staff').send({ user_code: code.user_code }).expect(409);
  const done = (await request(f.app).post('/api/v1/desktop/device/token').send({ device_code: code.device_code }).expect(200)).body.data;
  assert.equal(done.status, 'approved'); assert.equal(done.staff.email, 'staff@example.com'); assert.ok(done.token.length >= 40); assert.ok(Date.parse(done.expires_at) > Date.now() - 1);
  await request(f.app).post('/api/v1/desktop/device/token').send({ device_code: code.device_code }).expect(410); // token is not repeatable
  assert.deepEqual(f.audits, ['staff:Event PC 1']);
  const stored = [...f.sessions.entries()][0];
  assert.notEqual(stored[0], done.token); assert.equal(stored[1].is_admin, false); assert.equal(stored[1].admin_role, 'kiosk_device');
});

test('only signed-in kiosk operators or superadmins may approve', async () => {
  const f = await fixture();
  const code = (await request(f.app).post('/api/v1/desktop/device/code').send({}).expect(201)).body.data;
  await request(f.app).post('/api/desktop-device/approve').send({ user_code: code.user_code }).expect(401);
  for (const account of ['a-content', 'a-none']) await request(f.app).post('/api/desktop-device/approve').set('Cookie', `acct=${account}`).send({ user_code: code.user_code }).expect(403);
  await request(f.app).post('/api/desktop-device/approve').set('Cookie', 'acct=a-staff').send({ user_code: 'ZZZZ-ZZZZ' }).expect(404);
  await request(f.app).post('/api/desktop-device/approve').set('Cookie', 'acct=a-boss').send({ user_code: code.user_code }).expect(200);
  assert.equal(f.sessions.size, 1);
});

test('device token authorizes kiosk and update routes; the shared key still works; bad tokens do not', async () => {
  const f = await fixture();
  const { token } = await activate(f);
  const bearer = { Authorization: `Bearer ${token.token}` };
  const update = await request(f.app).get('/api/v1/desktop/update?current=1.0.0').set(bearer).expect(200);
  assert.equal(update.body.data.version, '1.2.0');
  await request(f.app).get('/api/v1/desktop/update?current=1.0.0').set('X-API-Key', key).expect(200);
  await request(f.app).get('/api/v1/desktop/update?current=1.0.0').expect(401);
  await request(f.app).get('/api/v1/desktop/update?current=1.0.0').set('Authorization', 'Bearer ' + 'x'.repeat(60)).expect(401);
  await request(f.app).get('/api/v1/desktop/update?current=1.0.0').set('Authorization', `Bearer ${token.token}`).set('X-API-Key', 'wrong').expect(200);
  await request(f.app).get('/api/v1/desktop/update?current=1.0.0').set('Authorization', 'Basic abc').expect(401);
  await request(f.app).post('/api/v1/kiosk/sessions').set('Authorization', 'Bearer ' + 'y'.repeat(60)).send({}).expect(401);
});

test('deactivating the staff member, removing the role or expiry revokes the device', async () => {
  const f = await fixture();
  const { token } = await activate(f);
  const get = () => request(f.app).get('/api/v1/desktop/update?current=1.0.0').set('Authorization', `Bearer ${token.token}`);
  await get().expect(200);
  f.actors.get('staff')!.role = 'content_manager'; await get().expect(401);
  f.actors.get('staff')!.role = 'kiosk_operator'; await get().expect(200);
  f.actors.get('staff')!.is_active = false; await get().expect(401);
  f.actors.get('staff')!.is_active = true; await get().expect(200);
  f.advance(15 * 86400000); await get().expect(401);
});

test('device sessions slide forward and codes expire', async () => {
  const f = await fixture();
  const { token } = await activate(f);
  const stored = [...f.sessions.values()][0], first = stored.expires_at.getTime();
  f.advance(8 * 86400000);
  await request(f.app).get('/api/v1/desktop/update?current=1.0.0').set('Authorization', `Bearer ${token.token}`).expect(200);
  assert.ok(stored.expires_at.getTime() > first + 7 * 86400000);
  const code = (await request(f.app).post('/api/v1/desktop/device/code').send({}).expect(201)).body.data;
  f.advance(11 * 60000);
  await request(f.app).post('/api/v1/desktop/device/token').send({ device_code: code.device_code }).expect(410);
  await request(f.app).post('/api/desktop-device/approve').set('Cookie', 'acct=a-staff').send({ user_code: code.user_code }).expect(404);
});

test('a device session is never an admin session and bad input is rejected', async () => {
  const f = await fixture();
  await activate(f);
  const stored = [...f.sessions.values()][0];
  assert.equal(stored.is_admin, false);
  await request(f.app).post('/api/v1/desktop/device/code').send({ device_name: '' }).expect(400);
  await request(f.app).post('/api/v1/desktop/device/code').send({ device_name: 'x'.repeat(61) }).expect(400);
  await request(f.app).post('/api/v1/desktop/device/code').send({ other: 1 }).expect(422);
  await request(f.app).post('/api/v1/desktop/device/token').send({ device_code: 'short' }).expect(400);
  await request(f.app).post('/api/desktop-device/lookup').set('Cookie', 'acct=a-staff').send({ user_code: 'x'.repeat(30) }).expect(422);
});
