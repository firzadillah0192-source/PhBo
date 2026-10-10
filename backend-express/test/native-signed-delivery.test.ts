import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeObjectStorage } from '../src/services/native-object-storage.service.js';
import { CustomerUploadService } from '../src/services/customer-upload.service.js';
import { CustomerResultService } from '../src/services/customer-result.service.js';
import { migrationConfigSchema } from '../src/config/migration-env.js';

const id='a'.repeat(32),ref=`minio://uploads/aa/${id}.jpg`;

test('signed URLs are scoped, use the configured public host, and respect owner expiry', async () => {
  const calls: unknown[][] = [];
  const client = { presignedGetObject: async (...args: unknown[]) => { calls.push(args); return 'https://photos.example/private-bucket/uploads/photo?X-Amz-Signature=synthetic'; } };
  const objects = new NativeObjectStorage({} as never,'private-bucket',{ client: client as never,origin: 'https://photos.example',ttlSeconds: 300 });
  const signed = await objects.signedUrl(ref,new Date(Date.now()+60000));
  assert.ok(signed); assert.equal(new URL(signed.url).host,'photos.example');
  assert.ok(Number(calls[0][2])<=60); assert.ok(Number(calls[0][2])>=58);
  assert.deepEqual(calls[0][3],{ 'response-cache-control': 'private, no-store' });
  assert.equal(await objects.signedUrl(ref,new Date(Date.now()-1)),null);
  await assert.rejects(objects.signedUrl('minio://catalog/template.json'));
  await assert.rejects(objects.signedUrl('minio://uploads/zz/../secret.jpg'));
  assert.equal(await new NativeObjectStorage({} as never,'private-bucket').signedUrl(ref),null);
});

test('signed delivery rejects unexpected hosts and sanitizes signing errors', async () => {
  for (const result of ['https://other.example/object','https://username:password@photos.example/object',null]) {
    const objects = new NativeObjectStorage({} as never,'private-bucket',{ origin: 'https://photos.example',ttlSeconds: 300,
      client: { presignedGetObject: async () => { if (!result) throw new Error('private-key-and-secret'); return result; } } as never });
    await assert.rejects(objects.signedUrl(ref),error => error instanceof Error && error.message==='Signed image delivery unavailable');
  }
});

test('photo/result delivery checks ownership and uses API fallback for legacy storage', async () => {
  let signedCalls=0;
  const signer = { signedUrl: async () => { signedCalls++; return { url: 'https://photos.example/object',expires_at: new Date() }; } };
  const uploads = new CustomerUploadService({} as never,{} as never,{ uploadsDir: '/unused',retentionHours: 24 },signer as never);
  uploads.owned = async (_id,identity) => { if (!identity.guest) throw new Error('No owner'); return { upload: { id,storage_path: ref,created_at: new Date() },path: ref } as never; };
  const identity = { guest: { id: 'owner' },account: null } as never;
  assert.equal((await uploads.delivery(id,identity,new Date(Date.now()+30000),'/api/v1/photos')).delivery,'minio');
  await assert.rejects(uploads.delivery(id,{ guest: null } as never)); assert.equal(signedCalls,1);
  const results = new CustomerResultService({} as never,{ resultsDir: '/unused',claimHours: 24,publicOrigin: '',production: false },signer as never);
  results.owned = async () => ({ result: { id,storage_path: 'legacy-file',created_at:new Date() } }) as never;
  assert.deepEqual(await results.delivery(id,identity),{ url: `/api/results/${id}/image`,expires_at: null,delivery: 'api' });
});

test('production signing requires explicit enablement, MinIO and HTTPS public hostname', () => {
  const base = { DATABASE_URL: 'test',NODE_ENV: 'production',SESSION_SECRET_KEY: 'test-key',STORAGE_BACKEND: 'minio',MINIO_ENDPOINT: 'private-minio',MINIO_ACCESS_KEY: 'test-access',MINIO_SECRET_KEY: 'test-secret',MINIO_BUCKET: 'private-bucket' };
  assert.equal(migrationConfigSchema.parse(base).MINIO_SIGNED_URLS_ENABLED,false);
  for (const invalid of [{},{ MINIO_PUBLIC_ENDPOINT: 'localhost' },{ MINIO_PUBLIC_ENDPOINT: '127.0.0.1' },{ MINIO_PUBLIC_ENDPOINT: 'https://photos.example' },{ MINIO_PUBLIC_ENDPOINT: 'photos.example',MINIO_PUBLIC_USE_SSL: 'false' }])
    assert.equal(migrationConfigSchema.safeParse({ ...base,MINIO_SIGNED_URLS_ENABLED: 'true',...invalid }).success,false);
  assert.equal(migrationConfigSchema.safeParse({ ...base,MINIO_SIGNED_URLS_ENABLED: 'true',MINIO_PUBLIC_ENDPOINT: 'photos.example' }).success,true);
});
