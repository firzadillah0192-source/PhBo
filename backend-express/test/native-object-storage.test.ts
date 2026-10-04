import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { Client } from 'minio';
import { NativeObjectStorage } from '../src/services/native-object-storage.service.js';
import { CustomerUploadService } from '../src/services/customer-upload.service.js';
import { CustomerResultService } from '../src/services/customer-result.service.js';
import { CustomerGenerationWorkerService } from '../src/services/customer-generation-worker.service.js';
import { CatalogAssetsService } from '../src/services/catalog-assets.service.js';
import { migrationConfigSchema } from '../src/config/migration-env.js';

const id = 'ab' + '1'.repeat(30);
const identity = { account: null, guest: { id: 'guest' }, sessionId: 'guest' } as never;
function fixture() {
  const files = new Map<string, Buffer>();
  let unavailable = false;
  const client = {
    async putObject(_bucket: string, key: string, bytes: Buffer) { if (unavailable) throw new Error('Offline'); files.set(key, bytes); },
    async getObject(_bucket: string, key: string) { if (unavailable) throw new Error('Offline'); if (!files.has(key)) throw Object.assign(new Error('Missing'), { code: 'NoSuchKey' }); return Readable.from([files.get(key)!]); },
    async statObject(_bucket: string, key: string) { if (unavailable) throw new Error('Offline'); if (!files.has(key)) throw Object.assign(new Error('Missing'), { code: 'NoSuchKey' }); return {}; },
    async removeObject(_bucket: string, key: string) { if (unavailable) throw new Error('Offline'); files.delete(key); },
    async bucketExists() { return !unavailable; },
  };
  return { objects: new NativeObjectStorage(client as never, 'test-photos'), files, offline() { unavailable = true; } };
}

test('native storage rejects traversal, foreign namespaces and invalid shard references', async () => {
  const { objects, files } = fixture();
  for (const ref of ['minio://../../secret', `minio://results/aa/${id}.png`, `minio://uploads/ab/${id}.png`, 'minio://other/ab/file.png', '/srv/photobooth/results/x']) {
    await assert.rejects(objects.read(ref)); await assert.rejects(objects.remove(ref)); await assert.rejects(objects.exists(ref));
  }
  assert.equal(files.size, 0);
  const ref = objects.reference('results', id);
  await objects.put(ref, Buffer.from('image'), 'image/png');
  assert.equal(await objects.exists(ref), true);
  assert.deepEqual(await objects.read(ref), Buffer.from('image'));
  await objects.remove(ref); assert.equal(await objects.exists(ref), false);
  const eventUpload=objects.reference('uploads',id,'eid-alfitri-1448');
  const eventResult=objects.reference('results',id,'eid-alfitri-1448');
  assert.match(eventUpload,/^minio:\/\/uploads\/events\/eid-alfitri-1448\/images\//);
  assert.match(eventResult,/^minio:\/\/results\/events\/eid-alfitri-1448\/results\//);
  assert.equal(objects.matchesReference('results',id,eventResult),true);
  assert.equal(objects.matchesReference('results','cd'+'2'.repeat(30),eventResult),false);
  await objects.put(eventUpload,Buffer.from('event photo'),'image/jpeg');
  assert.deepEqual(await objects.read(eventUpload),Buffer.from('event photo'));
  assert.throws(()=>objects.reference('uploads',id,'../private'));
});

test('native upload stores canonical bytes in MinIO, enforces ownership and keeps old files readable', async () => {
  const { objects, files } = fixture();
  const root = await mkdtemp(join(tmpdir(), 'nxbooth-storage-test-'));
  try {
    let row: any;
    const bytes = Buffer.from('synthetic canonical photo');
    const model = { async create(data: any) { row = { ...data, created_at: new Date() }; return row; }, async find() { return row; } };
    const service = new CustomerUploadService(model as never, { async normalize() { return { bytes, width: 10, height: 20 }; } } as never, { uploadsDir: root, retentionHours: 24 }, objects);
    const response = await service.create({ originalname: 'photo.jpg', buffer: bytes, mimetype: 'image/jpeg' } as never, identity);
    assert.equal(response.validation_status, 'VALID'); assert.match(row.storage_path, /^minio:\/\/uploads\//);
    assert.equal(files.size, 1);
    const found = await service.owned(row.id, identity);
    assert.deepEqual(await service.read(found.path), bytes);
    await assert.rejects(service.owned(row.id, { account: null, guest: { id: 'other' } }), /unavailable/);
    const old = join(root, 'legacy.jpg'); await writeFile(old, bytes);
    row.storage_path = old; assert.deepEqual(await service.read((await service.owned(row.id, identity)).path), bytes);
    await assert.rejects(service.read('/etc/passwd'), /unavailable/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('upload DB failure removes its object; retention skips active work and stops on storage outages', async () => {
  const { objects, files, offline } = fixture();
  const service = new CustomerUploadService({ async create() { throw new Error('DB failed'); } } as never, { async normalize() { return { bytes: Buffer.from('photo'), width: 10, height: 20 }; } } as never, { uploadsDir: '/unused', retentionHours: 24 }, objects);
  await assert.rejects(service.create({ originalname: 'photo.jpg' } as never, identity), /temporarily store/);
  assert.equal(files.size, 0);
  const ref = objects.reference('uploads', id); await objects.put(ref, Buffer.from('photo'), 'image/jpeg');
  let active = true; let removed = false;
  const cleanup = new CustomerUploadService({ async expired() { return [{ id, storage_path: ref }]; }, async jobs() { return active ? [{ state: 'PROCESSING' }] : []; }, async remove() { removed = true; } } as never, {} as never, { uploadsDir: '/unused', retentionHours: 24 }, objects);
  assert.equal((await cleanup.cleanup()).active_jobs_skipped, 1); assert.equal(files.size, 1);
  active = false; offline(); await assert.rejects(cleanup.cleanup()); assert.equal(removed, false);
});

test('MinIO result supports owner/claim rendition and safe deletion with legacy disk compatibility', async () => {
  const { objects, files } = fixture();
  const root = await mkdtemp(join(tmpdir(), 'nxbooth-result-storage-test-'));
  try {
    const bytes = await sharp({ create: { width: 1200, height: 3600, channels: 3, background: 'blue' } }).png().toBuffer();
    const result = { id, storage_path: objects.reference('results', id), deleted_at: null } as any;
    const found = { result, job: { mode: 'CLASSIC', guest_id: 'guest', account_id: null } };
    let deleted = false;
    const service = new CustomerResultService({ async result() { return found; }, async markDeleted() { deleted = true; } } as never, { resultsDir: root, claimHours: 24, publicOrigin: 'http://localhost', production: false }, objects);
    await objects.put(result.storage_path, bytes, 'image/png');
    assert.deepEqual(await service.rendition(found as never, false, true), bytes);
    const print = await sharp(await service.rendition(found as never, true, true)).metadata(); assert.equal(print.width, 600); assert.equal(print.height, 1800);
    const assets = new CatalogAssetsService([root], root, objects); assert.equal(await assets.exists(result.storage_path), true);
    await assert.rejects(service.owned(id, { account: null, guest: { id: 'other' } } as never));
    await service.delete(id, identity); assert.equal(deleted, true); assert.equal(files.size, 0);
    await assert.rejects(service.bytes(result, true), /load this photo/);
    const directory = join(root, id.slice(0, 2)); await mkdir(directory); result.storage_path = join(directory, `${id}.png`); await writeFile(result.storage_path, bytes);
    assert.deepEqual(await service.bytes(result), bytes);
    result.storage_path = objects.reference('uploads', id); await assert.rejects(service.delete(id, identity), /delete/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native worker stores MinIO Result and preserves object on ambiguous database completion', async () => {
  const bytes = await sharp({ create: { width: 1200, height: 3600, channels: 3, background: 'green' } }).png().toBuffer();
  for (const outcome of ['success', 'lost-lease', 'ambiguous', 'storage-failure']) {
    const { objects, files, offline } = fixture(); let failed = false; let result: any;
    if (outcome === 'storage-failure') offline();
    const model = { async claim() { return { id, mode: 'CLASSIC', layout_id: 'layout' }; }, async complete(_id: string, row: any) { result = row; if (outcome === 'ambiguous') throw new Error('Lost after commit'); return outcome !== 'lost-lease'; }, async fail() { failed = true; } };
    const worker = new CustomerGenerationWorkerService(model as never, { async generate() { return { bytes, provider: 'classic', model: 'pillow' }; } }, '/unused', objects);
    if (outcome === 'ambiguous') { await assert.rejects(worker.process(id), /reconciliation/); assert.equal(files.size, 1); assert.equal(failed, false); }
    else { assert.equal(await worker.process(id), outcome === 'success'); assert.equal(files.size, outcome === 'success' ? 1 : 0); assert.equal(failed, outcome === 'storage-failure'); }
    if (result) assert.match(result.storage_path, /^minio:\/\/results\//);
  }
});

test('MinIO config fails early without credentials; missing bucket fails readiness', async () => {
  assert.equal(migrationConfigSchema.safeParse({ DATABASE_URL: 'test', STORAGE_BACKEND: 'minio' }).success, false);
  assert.equal(migrationConfigSchema.safeParse({ DATABASE_URL: 'test' }).success, true);
  const { objects, offline } = fixture(); await objects.health(); offline(); await assert.rejects(objects.health());
});

test('real MinIO: synthetic private object roundtrip, legacy Result delivery and deletion', { skip: !process.env.TEST_MINIO_ENDPOINT }, async () => {
  const client = new Client({ endPoint: process.env.TEST_MINIO_ENDPOINT!, port: Number(process.env.TEST_MINIO_PORT || 9000), useSSL: false, accessKey: process.env.TEST_MINIO_ACCESS_KEY!, secretKey: process.env.TEST_MINIO_SECRET_KEY! });
  const bucket = `nxbooth-storage-test-${randomBytes(8).toString('hex')}`;
  const objects = new NativeObjectStorage(client, bucket, { client,origin: `http://${process.env.TEST_MINIO_ENDPOINT}:${Number(process.env.TEST_MINIO_PORT || 9000)}`,ttlSeconds: 30 });
  await client.makeBucket(bucket);
  try {
    await objects.health();
    const catalog = objects.catalogReference('_validation/template.json');
    await objects.put(catalog, Buffer.from('{"width":1200,"height":3600}'), 'application/json', 1700000000000);
    assert.equal((await objects.info(catalog))?.metaData['nxbooth-source-mtime'], '1700000000000');
    assert.equal((await objects.read(catalog)).toString(), '{"width":1200,"height":3600}');
    const bytes = await sharp({ create: { width: 1200, height: 3600, channels: 3, background: 'purple' } }).png().toBuffer();
    const ref = objects.reference('results', id); await objects.put(ref, bytes, 'image/png');
    assert.equal(await objects.exists(ref), true); assert.deepEqual(await objects.read(ref), bytes);
    const signed = await objects.signedUrl(ref);
    assert.ok(signed);
    const response = await fetch(signed.url);
    assert.equal(response.status,200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    assert.match(response.headers.get('cache-control') || '',/no-store/);
    const tampered = new URL(signed.url); tampered.searchParams.set('X-Amz-Signature','0'.repeat(64));
    assert.equal((await fetch(tampered)).status,403);
    await assert.rejects(objects.signedUrl(catalog),/Only customer images/);
    const result = { id, storage_path: ref } as never;
    const service = new CustomerResultService({} as never, { resultsDir: '/unused', claimHours: 24, publicOrigin: 'http://localhost', production: false }, objects);
    assert.deepEqual(await service.bytes(result, true), bytes);
    await objects.remove(ref); assert.equal(await objects.exists(ref), false);
    assert.equal((await fetch(signed.url)).status,404);
    await assert.rejects(service.bytes(result, true));
  } finally {
    await client.removeObject(bucket, 'catalog/_validation/template.json');
    await client.removeObject(bucket, `results/ab/${id}.png`);
    await client.removeBucket(bucket);
  }
});
