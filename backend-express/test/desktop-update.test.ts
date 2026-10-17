import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createMigrationApp } from '../src/migration-app.js';
import { NativeKioskService } from '../src/services/native-kiosk.service.js';
import { isNewer } from '../src/services/desktop-update.service.js';
import { DesktopDiagnosticsService } from '../src/services/desktop-diagnostics.service.js';

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

async function diagnosticsFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-diag-'));
  const service = new NativeKioskService({} as never, {} as never, {} as never, {} as never,
    { apiKey: key, ttlSeconds: 86400, generationLimit: 3, secureCookie: true });
  const app = createMigrationApp({} as never, { corsOrigins: ['https://nxbooth.example'], kiosk: service, desktopDiagnosticsDir: dir });
  return { app, dir };
}
const report = () => ({
  app_version: '1.0.1', platform: 'win32', os_version: '10.0.26100', device_name: 'KIOSK-1', captured_at: new Date().toISOString(),
  device_status: { camera: 'BROWSER_WEBCAM', printer: 'READY' },
  camera_probe: { ok: false, total_ms: 1800, cameras: [{ name: 'Canon EOS 2000D' }], model: 'Canon EOS 2000D', serial_tail: '1234',
    steps: [{ name: 'enumerate', ok: true, ms: 40 }, { name: 'liveview', ok: false, ms: 900, code: 'LIVEVIEW_FAILED', detail: 'error=0x8D01', size_bytes: 0 }] }
});

test('desktop diagnostics require kiosk credentials', async () => {
  const f = await diagnosticsFixture();
  await request(f.app).post('/api/v1/desktop/diagnostics').send(report()).expect(401);
  await request(f.app).post('/api/v1/desktop/diagnostics').set('X-API-Key', 'wrong').send(report()).expect(401);
  assert.deepEqual(await readdir(f.dir).catch(() => []), []);
});

test('desktop diagnostics are stored as one JSON line with only the allowed fields', async () => {
  const f = await diagnosticsFixture();
  const ok = await request(f.app).post('/api/v1/desktop/diagnostics').set('X-API-Key', key).send(report()).expect(201);
  assert.equal(ok.body.data.stored, true);
  const files = await readdir(f.dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/);
  const lines = (await readFile(join(f.dir, files[0]), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1);
  const saved = JSON.parse(lines[0]);
  assert.equal(saved.id, ok.body.data.id);
  assert.equal(saved.report.camera_probe.steps[1].code, 'LIVEVIEW_FAILED');
  assert.equal(saved.from, null);
});

test('desktop diagnostics reject unknown fields, secrets-shaped keys and oversize text', async () => {
  const f = await diagnosticsFixture();
  const post = (body: unknown) => request(f.app).post('/api/v1/desktop/diagnostics').set('X-API-Key', key).send(body as object);
  await post({ ...report(), token: 'x'.repeat(40) }).expect(400);
  await post({ ...report(), image: 'AAAA' }).expect(400);
  await post({ ...report(), app_version: 'latest' }).expect(400);
  await post({ ...report(), note: 'x'.repeat(501) }).expect(400);
  await post({ ...report(), startup_log: 'bad\u0000byte' }).expect(400);
  await post({ ...report(), camera_probe: { ...report().camera_probe, steps: Array.from({ length: 17 }, () => ({ name: 's', ok: true, ms: 1 })) } }).expect(400);
  assert.deepEqual(await readdir(f.dir).catch(() => []), []);
});

test('desktop diagnostics stop after the daily size limit and drop files older than 30 days', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-diag-'));
  const now = new Date('2026-10-20T10:00:00Z');
  await writeFile(join(dir, '2026-08-01.jsonl'), 'old\n');
  await writeFile(join(dir, '2026-10-19.jsonl'), 'recent\n');
  await writeFile(join(dir, 'notes.txt'), 'keep');
  const service = new DesktopDiagnosticsService(dir, () => now);
  await service.record('ops@example.com', report());
  assert.deepEqual((await readdir(dir)).sort(), ['2026-10-19.jsonl', '2026-10-20.jsonl', 'notes.txt']);
  await writeFile(join(dir, '2026-10-20.jsonl'), 'x'.repeat(2 * 1024 * 1024));
  await assert.rejects(() => service.record('ops@example.com', report()), /Too many diagnostics/);
});
