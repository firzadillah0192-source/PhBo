import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import type { NxGenerationJob } from '@prisma/client';
import type { CustomerGenerationModel } from '../src/models/customer-generation.model.js';
import { CustomerGenerationWorkerService } from '../src/services/customer-generation-worker.service.js';
import { ClassicImageEngineService } from '../src/services/classic-image-engine.service.js';

test('native worker refuses malformed images and wrong Classic/Advanced master dimensions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nxbooth-express-worker-test-'));
  try {
    const png = await sharp({ create: { width: 32, height: 48, channels: 3, background: 'red' } }).png().toBuffer();
    for (const [mode, bytes, code] of [['BASIC', Buffer.from('broken'), 'INTERNAL_ERROR'], ['BASIC', png, 'GENERATION_IMAGE_INVALID'], ['CLASSIC', png, 'CLASSIC_LAYOUT_INVALID'], ['ADVANCED', png, 'GENERATION_IMAGE_INVALID']] as const) {
      let failed: string | null = null;
      const model = { async claim() { return { id: 'job', mode } as NxGenerationJob; }, async fail(_id: string, errorCode: string) { failed = errorCode; }, async complete() { assert.fail('Invalid image must never create a Result'); } } as unknown as CustomerGenerationModel;
      const worker = new CustomerGenerationWorkerService(model, { async generate() { return { bytes, provider: 'test', model: 'test' }; } }, root);
      assert.equal(await worker.process('job'), false); assert.equal(failed, code);
    }
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('ambiguous native completion retains the image and does not contradict committed credit state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nxbooth-express-worker-test-'));
  try {
    const png = await sharp({ create: { width: 2160, height: 3240, channels: 3, background: 'blue' } }).png().toBuffer();
    const model = { async claim() { return { id: 'job', mode: 'BASIC', template_id: 'template' } as NxGenerationJob; },
      async fail() { assert.fail('Ambiguous commit must not mark failed or refund'); }, async complete() { throw new Error('Connection lost after COMMIT'); } } as unknown as CustomerGenerationModel;
    const worker = new CustomerGenerationWorkerService(model, { async generate() { return { bytes: png, provider: 'test', model: 'test', canvas: { width: 2160, height: 3240 } }; } }, root);
    await assert.rejects(worker.process('job'), error => error instanceof Error && 'code' in error && error.code === 'GENERATION_COMPLETION_UNCERTAIN');
    const directories = await readdir(root); assert.equal(directories.length, 1);
    assert.equal((await readdir(join(root, directories[0]))).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Classic adapter fails explicitly when private image engine is unconfigured', async () => {
  const engine = new ClassicImageEngineService('', '', async () => { assert.fail('No AI/provider request is allowed'); });
  await assert.rejects(engine.generate({} as never, [], Buffer.alloc(0)), error => error instanceof Error && 'code' in error && error.code === 'CLASSIC_ENGINE_NOT_CONNECTED');
});

test('Basic creates a shared Result at authoritative template dimensions instead of Advanced master', async () => {
  const root=await mkdtemp(join(tmpdir(),'nxbooth-basic-canvas-test-'));
  try {
    const bytes=await sharp({create:{width:1024,height:1536,channels:3,background:'gold'}}).png().toBuffer();
    let result:any;
    const model={async claim(){return {id:'basic-job',mode:'BASIC',template_id:'framed-template'} as NxGenerationJob;},
      async fail(){assert.fail('Valid Basic template canvas must complete');},async complete(_id:string,row:any){result=row;return true;}};
    const worker=new CustomerGenerationWorkerService(model as never,{async generate(){return {bytes,provider:'9router',model:'same-model',canvas:{width:1024,height:1536}};}},root);
    assert.equal(await worker.process('basic-job'),true);
    assert.equal(result.template_id,'framed-template');assert.equal(result.width,1024);assert.equal(result.height,1536);
    assert.equal(result.content_type,'image/png');assert.equal(result.provider,'9router');
  } finally {await rm(root,{recursive:true,force:true});}
});
