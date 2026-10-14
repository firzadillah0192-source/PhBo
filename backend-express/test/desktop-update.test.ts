import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createMigrationApp } from '../src/migration-app.js';
import { NativeKioskService } from '../src/services/native-kiosk.service.js';
import { isNewer } from '../src/services/desktop-update.service.js';

const key = 'k'.repeat(32);
async function fixture(publish: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-update-'));
  const bytes = Buffer.from('synthetic installer bytes');
  if (publish) {
    await writeFile(join(dir, 'NXBooth-Setup-1.2.0.exe'), bytes);
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ version: '1.2.0', file: 'NXBooth-Setup-1.2.0.exe',
      sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, notes: 'Test release' }));
  }
  const service = new NativeKioskService({} as never, {} as never, {} as never, {} as never,
    { apiKey: key, ttlSeconds: 86400, generationLimit: 3, secureCookie: true });
  const app = createMigrationApp({} as never, { corsOrigins: ['https://nxbooth.example'], kiosk: service, desktopUpdateDir: dir });
  return { app, bytes, dir };
}

test('desktop update requires the kiosk API key', async () => {
  const f = await fixture(true);
  await request(f.app).get('/api/v1/desktop/update?current=1.0.0').expect(401);
  await request(f.app).get('/api/v1/desktop/update/download').expect(401);
  await request(f.app).get('/api/v1/desktop/update?current=1.0.0').set('X-API-Key', 'wrong').expect(401);
});

test('desktop update reports a newer version with hash and size, nothing when current', async () => {
  const f = await fixture(true);
  const newer = await request(f.app).get('/api/v1/desktop/update?current=1.1.9').set('X-API-Key', key).expect(200);
  assert.equal(newer.body.data.update_available, true);
  assert.equal(newer.body.data.version, '1.2.0');
  assert.equal(newer.body.data.size, f.bytes.length);
  assert.equal(newer.body.data.sha256, createHash('sha256').update(f.bytes).digest('hex'));
  assert.ok(!JSON.stringify(newer.body).includes(f.dir));
  const same = await request(f.app).get('/api/v1/desktop/update?current=1.2.0').set('X-API-Key', key).expect(200);
  assert.deepEqual(same.body.data, { update_available: false });
  await request(f.app).get('/api/v1/desktop/update?current=latest').set('X-API-Key', key).expect(400);
  await request(f.app).get('/api/v1/desktop/update').set('X-API-Key', key).expect(400);
});

test('desktop update streams the installer named by the manifest', async () => {
  const f = await fixture(true);
  const download = await request(f.app).get('/api/v1/desktop/update/download').set('X-API-Key', key).buffer(true)
    .parse((res, done) => { const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks))); }).expect(200);
  assert.deepEqual(download.body, f.bytes);
  assert.equal(download.headers['content-length'], String(f.bytes.length));
  assert.match(download.headers['content-disposition'], /NXBooth-Setup-1\.2\.0\.exe/);
});

test('desktop update with nothing published is not an error for checks and 404 for downloads', async () => {
  const f = await fixture(false);
  assert.deepEqual((await request(f.app).get('/api/v1/desktop/update?current=1.0.0').set('X-API-Key', key).expect(200)).body.data, { update_available: false });
  await request(f.app).get('/api/v1/desktop/update/download').set('X-API-Key', key).expect(404);
});

test('desktop update refuses a manifest that does not match the file or names another path', async () => {
  const f = await fixture(true);
  await writeFile(join(f.dir, 'manifest.json'), JSON.stringify({ version: '1.2.0', file: '../../etc/passwd', sha256: 'a'.repeat(64), size: 5 }));
  await request(f.app).get('/api/v1/desktop/update?current=1.0.0').set('X-API-Key', key).expect(503);
  await request(f.app).get('/api/v1/desktop/update/download').set('X-API-Key', key).expect(503);
  await writeFile(join(f.dir, 'manifest.json'), JSON.stringify({ version: '1.2.0', file: 'NXBooth-Setup-1.2.0.exe', sha256: 'a'.repeat(64), size: 5 }));
  await request(f.app).get('/api/v1/desktop/update/download').set('X-API-Key', key).expect(503);
});

test('version comparison is numeric, not lexical', () => {
  assert.equal(isNewer('1.10.0', '1.9.9'), true);
  assert.equal(isNewer('1.2.0', '1.2.0'), false);
  assert.equal(isNewer('0.9.0', '1.0.0'), false);
});
