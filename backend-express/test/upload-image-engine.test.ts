import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { UploadImageEngineService } from '../src/services/upload-image-engine.service.js';

test('native upload adapter delegates image decoding only and accepts real normalized JPEG bytes', async () => {
  const jpeg = await sharp({ create: { width: 320, height: 480, channels: 3, background: 'green' } }).jpeg().toBuffer();
  const engine = new UploadImageEngineService('http://image-engine.test/normalize-upload', 'test-only-key', 1000, async (url, options) => {
    assert.equal(String(url), 'http://image-engine.test/normalize-upload');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-only-key');
    assert.equal(options?.redirect, 'error');
    const form = options?.body as FormData;
    assert.equal(form.get('mode'), null); assert.equal(form.get('account_id'), null);
    const image = form.get('image') as Blob;
    assert.equal(image.type, 'image/heic');
    assert.equal(await image.text(), 'synthetic-heic-input');
    return new Response(new Uint8Array(jpeg), { headers: { 'content-type': 'image/jpeg' } });
  });
  const result = await engine.normalize(Buffer.from('synthetic-heic-input'), 'image/heic');
  assert.deepEqual([result.width, result.height], [320, 480]);
  assert.deepEqual(result.bytes, jpeg);
});

test('native upload adapter preserves validation errors and fails clearly when image engine is unavailable', async () => {
  await assert.rejects(new UploadImageEngineService('', '').normalize(Buffer.from('test'), ''), error => error instanceof Error && 'status' in error && error.status === 503);
  const invalid = new UploadImageEngineService('http://image.test', 'test-only-key', 1000, async () => Response.json({ detail: { error_code: 'IMAGE_DECODE_FAILED', message: 'Cannot decode this photo.' } }, { status: 422 }));
  await assert.rejects(invalid.normalize(Buffer.from('test'), ''), error => error instanceof Error && 'code' in error && error.code === 'IMAGE_DECODE_FAILED');
  const broken = new UploadImageEngineService('http://image.test', 'test-only-key', 1000, async () => new Response('not an image'));
  await assert.rejects(broken.normalize(Buffer.from('test'), ''), error => error instanceof Error && 'status' in error && error.status === 503);
});
