import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CustomerIdentity } from '../src/services/customer-account.service.js';
import { generationInput } from '../src/services/customer-generation-input.js';
import { generationRequest } from '../src/services/generation-request.js';
import { CustomerGenerationService } from '../src/services/customer-generation.service.js';
import { customerGenerationController } from '../src/controllers/customer-generation.controller.js';

const owner = { account: null, guest: { id: 'owner' } } as CustomerIdentity;
const body = { mode: 'ADVANCED', upload_id: 'photo', experience_id: 'world' };

test('request keys are optional, validated, owner scoped and normalized', () => {
  const input = generationInput.parse(body);
  assert.equal(generationRequest(undefined, input, owner), undefined);
  for (const key of ['', 'a'.repeat(129), 'with spaces', [], null]) assert.throws(() => generationRequest(key, input, owner));
  const first = generationRequest('retry-1', input, owner)!;
  const defaults = generationRequest('retry-1', generationInput.parse({ ...body, frame_style_id: 'natural', ornament_ids: [] }), owner)!;
  assert.deepEqual(first, defaults);
  assert.equal(first.scope, 'guest:owner');
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.scope, generationRequest('retry-1', input, { ...owner, guest: { id: 'other' } } as CustomerIdentity)!.scope);
  assert.notEqual(first.hash, generationRequest('retry-1', generationInput.parse({ ...body, frame_style_id: 'modern' }), owner)!.hash);
  assert.throws(() => generationRequest('retry-1', input, { account: null, guest: null } as CustomerIdentity));
});

test('a replay returns persisted job without upload access, reserving credit or enqueuing again', async () => {
  const job = { id: 'persisted', mode: 'ADVANCED', state: 'COMPLETED', upload_id: 'photo', ornament_ids_json: '[]' };
  const service = new CustomerGenerationService({ findRequest: async () => job } as never,
    { owned: async () => assert.fail('expired input must not invalidate a completed retry') } as never,
    {} as never, { enqueue: async () => assert.fail('replay must not enqueue again') });
  const response = await service.create(body, owner, 'retry-1');
  assert.equal(response.job_id, 'persisted');
  assert.equal(response.state, 'COMPLETED');
});

test('racing creation reuses winner without queueing or failing it', async () => {
  const job = { id: 'winner', mode: 'BASIC', state: 'QUEUED', upload_id: 'photo', ornament_ids_json: null };
  const model = { findRequest: async () => null, template: async () => ({ enabled: true, image_path: 'template', name: 'Fixture', description: 'Synthetic template' }),
    experience: async () => ({ enabled: true, status: 'published', model: 'fixture-model' }),
    createOnce: async () => ({ job, reused: true }), queueFailed: async () => assert.fail('replay must not refund winner') };
  const service = new CustomerGenerationService(model as never,
    { owned: async () => ({ upload: { id: 'photo' } }) } as never,
    { file: async () => 'template' } as never, { enqueue: async () => assert.fail('winner already enqueued') });
  assert.equal((await service.create({ mode: 'BASIC', upload_id: 'photo', template_id: 'template' }, owner, 'race')).job_id, 'winner');
});

test('new keyed requests enqueue once and unkeyed clients keep existing behavior', async () => {
  let keyed = 0, unkeyed = 0, queued = 0;
  const job = { id: 'new', mode: 'BASIC', state: 'QUEUED', upload_id: 'photo', ornament_ids_json: null };
  const model = { findRequest: async () => null, template: async () => ({ enabled: true, image_path: 'template', name: 'Fixture', description: 'Synthetic template' }),
    experience: async () => ({ enabled: true, status: 'published', model: 'fixture-model' }),
    createOnce: async () => { keyed++; return { job, reused: false }; }, create: async () => { unkeyed++; return job; } };
  const service = new CustomerGenerationService(model as never, { owned: async () => ({ upload: { id: 'photo' } }) } as never,
    { file: async () => 'template' } as never, { enqueue: async () => { queued++; } });
  const basic = { mode: 'BASIC', upload_id: 'photo', template_id: 'template' };
  await service.create(basic, owner, 'new-request');
  await service.create(basic, owner);
  assert.deepEqual([keyed, unkeyed, queued], [1, 1, 2]);
});

test('controller forwards optional Idempotency-Key without changing the response contract', async () => {
  const handler = customerGenerationController({ create: async (...args: unknown[]) => {
    assert.equal(args[2], 'retry-123'); return { job_id: 'job', state: 'QUEUED' };
  } } as never, { resolve: async () => owner, config: {} } as never).create;
  const response = { status: (value: number) => { assert.equal(value, 202); return response; },
    json: (value: unknown) => assert.deepEqual(value, { job_id: 'job', state: 'QUEUED' }) };
  await handler({ body, cookies: {}, get: () => 'retry-123' } as never, response as never, () => {});
});
