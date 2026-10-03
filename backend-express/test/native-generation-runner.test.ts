import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import type { NxGenerationJob } from '@prisma/client';
import { NativeGenerationRunner } from '../src/services/native-generation-runner.service.js';

async function runnerFor(root: string, available = true) {
  const source = await sharp({ create: { width: 120, height: 180, channels: 3, background: 'purple' } }).png().toBuffer();
  const providerImage = await sharp({ create: { width: 100, height: 150, channels: 3, background: 'orange' } }).png().toBuffer();
  const sourcePath = join(root, 'source.jpg');
  await writeFile(sourcePath, source);
  const calls: { input: Buffer | null; prompt: string; model: string }[] = [];
  const finishes: { image: unknown; error: unknown }[] = [];
  const model = {
    async template(id: string) { assert.equal(id, 'space-template'); return { id, name: 'Space Commander', description: 'A cinematic sci-fi commander portrait.', enabled: true }; },
    async experience(id: string) { assert.equal(id, 'basic-model'); return { id, status: 'published', enabled: true, model: 'private/image-model' }; },
  };
  const runs = { async start(_job: NxGenerationJob, provider: string, modelId: string) { assert.equal(provider, '9router'); assert.equal(modelId, 'private/image-model'); return { id: 'provider-run' }; },
    async finish(_run: unknown, _job: NxGenerationJob, image: unknown, error?: unknown) { finishes.push({ image, error }); } };
  const uploads = { async owned() { return { path: sourcePath }; } };
  const classic = { async generate() { assert.fail('BASIC must not use the local Classic compositor'); } };
  const images = { async providerInput(bytes: Buffer) { return bytes; }, async advancedResult(bytes: Buffer) { assert.deepEqual(bytes, providerImage); return providerImage; } };
  const provider = { name: '9router', available: () => available, async generate(input: Buffer | null, prompt: string, modelId: string) {
    calls.push({ input, prompt, model: modelId });
    return { bytes: providerImage, provider: '9router', model: modelId, meta: { usage_available: 'true' } };
  } };
  const runner = new NativeGenerationRunner(model as never, runs as never, uploads as never, classic as never, images as never, provider as never, 'basic-model');
  return { runner, calls, finishes, source, providerImage };
}

test('BASIC sends the customer photo and private template prompt through the AI provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nxbooth-ai-basic-'));
  try {
    const { runner, calls, finishes, source, providerImage } = await runnerFor(root);
    const job = { id: 'job', mode: 'BASIC', account_id: null, guest_id: 'guest', upload_id: 'upload', template_id: 'space-template' } as NxGenerationJob;
    const result = await runner.generate(job);
    assert.deepEqual(result.bytes, providerImage);
    assert.equal(result.provider, '9router');
    assert.equal(result.model, 'private/image-model');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].input, source);
    assert.equal(calls[0].model, 'private/image-model');
    assert.match(calls[0].prompt, /Space Commander/);
    assert.match(calls[0].prompt, /recognizable facial structure/);
    assert.equal(finishes.length, 1);
    assert.equal(finishes[0].error, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('BASIC reports a disconnected AI provider instead of falling back to local generation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nxbooth-ai-basic-'));
  try {
    const { runner, calls, finishes } = await runnerFor(root, false);
    const job = { id: 'job', mode: 'BASIC', account_id: null, guest_id: 'guest', upload_id: 'upload', template_id: 'space-template' } as NxGenerationJob;
    await assert.rejects(runner.generate(job), { code: 'AI_PROVIDER_NOT_CONNECTED' });
    assert.equal(calls.length, 0);
    assert.equal(finishes.length, 1);
    assert.equal((finishes[0].error as { code: string }).code, 'AI_PROVIDER_NOT_CONNECTED');
  } finally { await rm(root, { recursive: true, force: true }); }
});
