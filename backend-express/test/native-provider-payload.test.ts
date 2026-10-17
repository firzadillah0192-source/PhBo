import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeNineRouterProvider, ProviderFailure } from '../src/services/native-provider.service.js';

// gpt-image models reject the legacy `response_format` field with HTTP 400 ("Unknown parameter").
const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function providerWith(respond: (body: Record<string, unknown>) => Response) {
  const bodies: Record<string, unknown>[] = [];
  const fetcher = (async (_url: unknown, init: { body: string }) => { const body = JSON.parse(init.body) as Record<string, unknown>; bodies.push(body); return respond(body); }) as unknown as typeof fetch;
  return { bodies, provider: new NativeNineRouterProvider({ baseUrl: 'http://router.test/v1', key: 'secret-key', timeoutMs: 5000, resultOrigins: [] }, fetcher) };
}
const okImage = () => new Response(JSON.stringify({ data: [{ b64_json: onePixelPng.toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const template = { bytes: onePixelPng, width: 1, height: 1 };

test('gpt-image models are called without response_format, other models keep b64_json', async () => {
  for (const [model, expectField] of [['cx/gpt-image-2.5', false], ['openai/gpt-image-2.5', false], ['gpt-image-2.5', false], ['openai/chatgpt-image-latest', false], ['ag/nano-banana-pro', true]] as const) {
    const { bodies, provider } = providerWith(okImage);
    await provider.generate(onePixelPng, 'prompt', model, template);
    assert.equal('response_format' in bodies[0], expectField, model);
    assert.equal((bodies[0].images as string[]).length, 2, 'template + photo are still sent');
  }
  const advanced = providerWith(okImage);
  await advanced.provider.generate(onePixelPng, 'prompt', 'cx/gpt-image-2.5');
  assert.ok(!('response_format' in advanced.bodies[0]) && typeof advanced.bodies[0].image === 'string', 'Advanced (single photo) uses the same rule');
});

test('provider HTTP errors keep a redacted excerpt of the upstream message in meta only', async () => {
  const { provider } = providerWith(() => new Response(JSON.stringify({ error: { message: 'Unknown parameter: response_format. Authorization: Bearer sk-abcdefghijkl1234 ' + 'A'.repeat(200) } }), { status: 400, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(() => provider.generate(onePixelPng, 'prompt', 'cx/gpt-image-2.5', template), (error: unknown) => {
    assert.ok(error instanceof ProviderFailure);
    assert.equal(error.message, 'The AI provider returned HTTP 400.', 'customer-facing text stays generic');
    const detail = String(error.meta.upstream_detail);
    assert.match(detail, /Unknown parameter: response_format/);
    assert.ok(!detail.includes('sk-abcdefghijkl1234') && !/A{80}/.test(detail) && detail.length <= 300);
    return true;
  });
  const empty = providerWith(() => new Response('', { status: 400 }));
  await assert.rejects(() => empty.provider.generate(onePixelPng, 'prompt', 'cx/gpt-image-2.5', template), (error: unknown) => error instanceof ProviderFailure && error.meta.upstream_detail === undefined);
});
