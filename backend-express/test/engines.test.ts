import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { NineRouterService } from '../src/services/ninerouter.service.js';
import { GenerationEngineService } from '../src/services/generation-engine.service.js';
import { experiencePresets } from '../src/services/experience-presets.js';
import { AiEngineService } from '../src/services/ai-engine.service.js';

const preset = { id: 'test', name: 'Test', description: '', model: 'preset/model', prompt: 'Original preset prompt' };
const config = { NINEROUTER_BASE_URL: 'https://router.example/v1', NINEROUTER_API_KEY: 'secret', AI_ENGINE_TIMEOUT_MS: 1000 };
const png = () => sharp({ create: { width: 4, height: 6, channels: 3, background: 'red' } }).png().toBuffer();

test('CLASSIC adapter posts ordered photos and frame without a BASIC template', async () => {
  const engine = new AiEngineService({ AI_ENGINE_URL: 'https://python.example/generate', AI_ENGINE_TIMEOUT_MS: 1000 }, async (_url, options) => {
    const body = options?.body as FormData;
    assert.equal(body.get('mode'), 'CLASSIC');
    assert.equal(body.get('templateId'), null);
    assert.equal(body.get('image'), null);
    assert.equal(await (body.get('frame') as Blob).text(), 'frame');
    const photos = body.getAll('images') as Blob[];
    assert.deepEqual(await Promise.all(photos.map(photo => photo.text())), ['first', 'second']);
    return new Response(new Uint8Array(await png()), { headers: { 'content-type': 'image/png' } });
  });
  await engine.generate(Buffer.from('first'), 'CLASSIC', 'job', undefined,
    { photos: [Buffer.from('first'), Buffer.from('second')], frame: Buffer.from('frame') });
});

test('NineRouter uses original JSON contract, preset model, JPEG reference, and PNG result', async () => {
  const output = await png();
  const engine = new NineRouterService(config, async (url, options) => {
    assert.equal(url, 'https://router.example/v1/images/generations');
    assert.equal(options?.method, 'POST');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer secret');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, preset.model); assert.equal(body.prompt, preset.prompt);
    assert.equal(body.size, '1024x1024'); assert.equal(body.n, 1); assert.equal(body.response_format, 'b64_json');
    assert.ok(body.image.startsWith('data:image/jpeg;base64,'));
    const metadata = await sharp(Buffer.from(body.image.split(',')[1], 'base64')).metadata();
    assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.width, 1536);
    return Response.json({ data: [{ b64_json: output.toString('base64') }] });
  });
  const original = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: 'blue' } }).png().toBuffer();
  assert.equal((await sharp(await engine.generate(original, preset)).metadata()).format, 'png');
});

test('NineRouter parses SSE and rejects empty, malformed, oversized and corrupt output', async () => {
  const source = await png();
  const sse = new NineRouterService(config, async () => new Response(`: ping\ndata: ${JSON.stringify({ data: [{ b64_json: source.toString('base64') }] })}\n\ndata: [DONE]\n`, { headers: { 'content-type': 'text/event-stream' } }));
  assert.ok((await sse.generate(source, preset)).length);
  for (const response of [Response.json({ data: [] }), new Response('bad'),
    Response.json({ data: [{ b64_json: Buffer.from('not image').toString('base64') }] }),
    new Response('failed', { status: 429 }),
    Response.json({ data: [{ url: 'http://127.0.0.1/secrets' }] }),
    new Response(new Uint8Array(36 * 1024 * 1024 + 1)),
  ]) {
    await assert.rejects(new NineRouterService(config, async () => response).generate(source, preset));
  }
  assert.throws(() => new NineRouterService({ AI_ENGINE_TIMEOUT_MS: 1000 }).assertConfigured());
});

test('CLASSIC uses compositor while BASIC and ADVANCED use saved NineRouter prompts', async () => {
  const calls: unknown[][] = [];
  const aiCalls: { prompt: string; model: string }[] = [];
  const mutable = { ...preset };
  const router = new GenerationEngineService({ assertConfigured() {}, async generate(...args) { calls.push(args); return Buffer.from('python'); } },
    { assertConfigured() {}, async generate(_source, saved) { aiCalls.push({ prompt: saved.prompt, model: saved.model }); return Buffer.from(saved.prompt); } },
    { BASIC_TEMPLATE_ID: 'original-template', ADVANCED_EXPERIENCE_ID: 'test' }, [mutable]);
  const snapshot = router.snapshot({ mode: 'ADVANCED' });
  mutable.prompt = 'Changed after enqueue';
  for (const mode of ['CLASSIC', 'BASIC'] as const) {
    await router.generate(Buffer.from('source'), mode, mode);
  }
  assert.deepEqual(calls.map(args => args.slice(1, 4)), [['CLASSIC', 'CLASSIC', undefined]]);
  assert.equal(aiCalls.length, 1);
  assert.match(aiCalls[0].prompt, /Original template/i);
  assert.equal(aiCalls[0].model, 'preset/model');
  assert.match((await router.generate(Buffer.from('source'), 'ADVANCED', 'job', snapshot)).toString(), /Original preset prompt/);
  assert.equal(aiCalls.length, 2);
  const basicSnapshot = router.snapshot({ mode: 'BASIC', templateId: 'original-template' });
  assert.equal(basicSnapshot.kind, '9router-basic');
  assert.equal((await router.generate(Buffer.from('source'), 'BASIC', 'basic-job', basicSnapshot)).toString(), basicSnapshot.experience.prompt);
  await assert.rejects(router.generate(Buffer.from('source'), 'BASIC', 'job', snapshot));
  assert.throws(() => router.snapshot({ mode: 'ADVANCED', experienceId: 'missing' }));
  const noModel = new GenerationEngineService({ assertConfigured() {}, async generate() { return Buffer.alloc(0); } },
    { assertConfigured() {}, async generate() { return Buffer.alloc(0); } },
    { BASIC_TEMPLATE_ID: 'template', ADVANCED_EXPERIENCE_ID: 'missing' }, []);
  assert.throws(() => noModel.snapshot({ mode: 'BASIC' }), { code: 'AI_MODEL_NOT_CONFIGURED' });
  assert.deepEqual(Object.keys(router.listExperiences()[0]).sort(), ['description', 'id', 'name']);
  assert.equal(experiencePresets.length, 44);
});

test('NineRouter downloads trusted result URLs without forwarding provider credentials', async () => {
  const source = await png();
  let calls = 0;
  const engine = new NineRouterService({ ...config, NINEROUTER_RESULT_ORIGINS: ['https://cdn.example'] }, async (url, options) => {
    calls++;
    if (calls === 1) return Response.json({ data: [{ url: 'https://cdn.example/image.png?signature=test' }] });
    assert.equal(String(url), 'https://cdn.example/image.png?signature=test');
    assert.equal(options?.headers, undefined); assert.equal(options?.redirect, 'error');
    return new Response(new Uint8Array(source));
  });
  assert.ok((await engine.generate(source, preset)).length);
  assert.equal(calls, 2);
});
