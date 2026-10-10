import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import type { NxGenerationJob } from '@prisma/client';
import { NativeGenerationRunner } from '../src/services/native-generation-runner.service.js';

async function runnerFor(root: string, available = true, expectedModel = 'private/image-model', outputSize = { width: 120, height: 180 }) {
  const source = await sharp({ create: { width: 120, height: 180, channels: 3, background: 'purple' } }).png().toBuffer();
  const providerImage = await sharp({ create: { ...outputSize, channels: 3, background: 'orange' } }).png().toBuffer();
  const sourcePath = join(root, 'source.jpg');
  await writeFile(sourcePath, source);
  const templatePath = join(root, 'template.png');
  await writeFile(templatePath, source);
  const frozen = { asset: templatePath, sha256: createHash('sha256').update(source).digest('hex'), width: 120, height: 180 };
  const calls: { input: Buffer | null; prompt: string; model: string; template?: { bytes: Buffer; width: number; height: number } }[] = [];
  const finishes: { image: unknown; error: unknown }[] = [];
  const model = {
    async template(id: string) { assert.equal(id, 'space-template'); return { id, name: 'Space Commander', description: 'A cinematic sci-fi commander portrait.', enabled: true }; },
    async experience(id: string) { assert.equal(id, 'basic-model'); return { id, status: 'published', enabled: true, model: 'private/image-model' }; },
  };
  const runs = { async start(_job: NxGenerationJob, provider: string, modelId: string) { assert.equal(provider, '9router'); assert.equal(modelId, expectedModel); return { id: 'provider-run' }; },
    async finish(_run: unknown, _job: NxGenerationJob, image: unknown, error?: unknown) { finishes.push({ image, error }); } };
  const uploads = { async owned() { return { path: sourcePath }; }, async read(path: string) { assert.equal(path, sourcePath); return source; } };
  const classic = { async generate() { assert.fail('BASIC must not use the local Classic compositor'); } };
  const images = { async basicIdentity(bytes: Buffer) { return bytes; }, async basicTemplate(bytes: Buffer) { return bytes; }, async basicResult() { assert.fail('Basic must expose the AI edit without post-generation landmark rejection or local blending'); }, async advancedResult() { assert.fail('Basic cannot add Advanced footer'); } };
  const assets = { async file(path: string) { assert.equal(path, templatePath); return path; }, async freezeBasicTemplate() { return frozen; } };
  const provider = { name: '9router', available: () => available, async generate(input: Buffer | null, prompt: string, modelId: string, template?: { bytes: Buffer; width: number; height: number }) {
    calls.push({ input, prompt, model: modelId, template });
    return { bytes: providerImage, provider: '9router', model: modelId, meta: { usage_available: 'true' } };
  } };
  const runner = new NativeGenerationRunner(model as never, runs as never, uploads as never, classic as never, images as never, provider as never, 'basic-model', assets as never);
  return { runner, calls, finishes, source, providerImage, frozen };
}

test('BASIC returns the AI edit unchanged without post-generation landmark rejection or blending', async () => {
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
    assert.deepEqual(calls[0].template, { bytes: source, width: 120, height: 180 });
    assert.deepEqual(result.canvas, { width: 120, height: 180 });
    assert.equal(calls[0].model, 'private/image-model');
    assert.match(calls[0].prompt, /Space Commander/);
    assert.match(calls[0].prompt, /subtle template-dominant facial resemblance/);
    assert.match(calls[0].prompt, /Preserve the facial skin tone and complexion exactly as Image 1/);
    assert.match(calls[0].prompt, /Preserve the hair exactly as Image 1/);
    assert.match(calls[0].prompt, /Adopt the source nose gently and naturally/);
    assert.match(calls[0].prompt, /If Image 2 visibly contains eyeglasses/);
    assert.match(calls[0].prompt, /Do not add a second pair of glasses/);
    assert.doesNotMatch(calls[0].prompt, /Transfer the person's recognizable facial structure and age/);
    assert.match(calls[0].prompt, /Perform a localized identity edit of Image 1/);
    assert.match(calls[0].prompt, /Image 2 supplies recognizable personal resemblance cues/);
    assert.match(calls[0].prompt, /Preserve the original framing and all four edges/);
    assert.match(calls[0].prompt, /Never add a black panel/);
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

test('queued BASIC job uses its frozen prompt and model after registry changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nxbooth-ai-basic-snapshot-'));
  try {
    const { runner,calls,providerImage,frozen } = await runnerFor(root,true,'frozen/provider-model');
    const snapshot={version:2,mode:'BASIC',template:frozen,prompt:'Frozen curated scene prompt.',model:'frozen/provider-model'};
    const job={id:'job-snapshot',mode:'BASIC',account_id:null,guest_id:'guest',upload_id:'upload',template_id:'space-template',
      engine_config_json:JSON.stringify(snapshot)} as NxGenerationJob;
    const generated=await runner.generate(job);
    assert.deepEqual(generated.bytes,providerImage);
    assert.equal(calls.length,1);
    assert.equal(calls[0].prompt,snapshot.prompt);
    assert.equal(calls[0].model,snapshot.model);
  } finally { await rm(root,{recursive:true,force:true}); }
});


test('BASIC fits a different provider canvas without cropping, stretching or a black footer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nxbooth-ai-basic-fit-'));
  try {
    const { runner } = await runnerFor(root, true, 'private/image-model', { width: 150, height: 150 });
    const job = { id: 'job-fit', mode: 'BASIC', account_id: null, guest_id: 'guest', upload_id: 'upload', template_id: 'space-template' } as NxGenerationJob;
    const result = await runner.generate(job);
    const image = sharp(result.bytes);
    const metadata = await image.metadata();
    assert.deepEqual([metadata.width, metadata.height], [120, 180]);
    const pixel = async (top: number) => [...await sharp(result.bytes).extract({ left: 60, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
    assert.deepEqual(await pixel(0), [255, 255, 255]);
    assert.deepEqual(await pixel(90), [255, 165, 0]);
    assert.deepEqual(await pixel(179), [255, 255, 255]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
