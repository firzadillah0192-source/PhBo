import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ADAPTERS } from '../src/lab/adapters/index.js';
import { LabVault } from '../src/lab/crypto.js';
import { MemoryLabFiles } from '../src/lab/files.js';
import { LabService, type Actor } from '../src/lab/service.js';
import { MemoryLabStore } from '../src/lab/store.js';
import { NxScenarios } from '../src/lab-bridge/nx-scenarios.js';
import { composeAdvancedPrompt, composeBasicPrompt } from '../src/services/advanced-prompt.service.js';
import type { HttpRequest, HttpResponse, LabHttp, NxScenarioSource, ScenarioPlan } from '../src/lab/types.js';

const admin: Actor = { actor_id: 'a1', role: 'superadmin' };
const png = (w = 128, h = 96, c = '#c44') => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();
const json = (body: unknown, status = 200): HttpResponse => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });
function fakeOpenAI() {
  const calls: HttpRequest[] = [];
  const http: LabHttp = { async request(req) { calls.push(req); if (req.url.endsWith('/models')) return json({ data: [] });
    return json({ data: [{ b64_json: (await png(64, 64, '#2a6')).toString('base64') }], usage: { input_tokens: 1000, output_tokens: 500, total_tokens: 1500 } }); } };
  return { http, calls };
}
async function setup(plan: Partial<ScenarioPlan> = {}) {
  const fake = fakeOpenAI(), planned: unknown[] = [];
  const scenarios: NxScenarioSource = {
    async catalog() { return { basic: [], advanced: { experiences: [], frame_styles: [] } }; },
    async plan(selection, face) { planned.push([selection, face.length]);
      return { kind: 'basic', label: 'Basic · Test', production_model: 'prod-model', meta: { template_id: 't' }, prompt: 'SERVER OWNED PROMPT', production_size: { width: 1024, height: 1536 },
        images: [{ bytes: await png(1024, 1536, '#123'), role: 'template' }, { bytes: await png(512, 512, '#456'), role: 'reference' }], ...plan }; } };
  const lab = new LabService({ store: new MemoryLabStore(), files: new MemoryLabFiles(), vault: new LabVault('lab-test-encryption-key-123'), adapters: ADAPTERS, scenarios, http: () => fake.http,
    now: () => new Date('2026-10-12T10:00:00Z'), sleep: async () => undefined, audit: async () => undefined });
  const provider = await lab.createProvider({ name: 'Together', type: 'openai_compatible', base_url: 'https://api.example-ai.com/v1' }, admin);
  await lab.setCredential(provider.id, 'compat-key-1234567890', admin); await lab.updateProvider(provider.id, { enabled: true }, admin);
  const model = await lab.saveModel(null, { provider_id: provider.id, model_id: 'flux-kontext', display_name: 'Flux Kontext', tasks: ['multi-reference-edit'], max_reference_images: 2, sizes: [],
    supports: { size: true, quality: [], output_format: [], seed: false, negative_prompt: false },
    pricing: { method: 'tokens', currency: 'USD', input_usd_per_million_tokens: 5, output_usd_per_million_tokens: 40, assumed_input_tokens: 1000, assumed_output_tokens: 500, source: 'fixture', verified_at: null, assumptions: 'fixture' } }, admin);
  return { lab, model, fake, planned, provider };
}

test('openai_compatible providers accept any public HTTPS host but still reject unsafe ones', async () => {
  const { lab } = await setup();
  await assert.rejects(lab.createProvider({ name: 'Bad', type: 'openai_compatible', base_url: 'http://api.example-ai.com' }, admin), /HTTPS/);
  await assert.rejects(lab.createProvider({ name: 'Bad', type: 'openai_compatible', base_url: 'https://10.0.0.5/v1' }, admin), /IP-literal/);
  await assert.rejects(lab.createProvider({ name: 'Bad', type: 'openai_compatible' }, admin));
});
test('Basic scenario: production prompt and template+identity images reach the provider with the production canvas size', async () => {
  const { lab, model, fake, planned } = await setup();
  const plan = await lab.planScenario({ kind: 'basic', template_id: 't' }, await png(300, 300));
  const est = await lab.estimateFor({ model_ref: model.id, reference_images: 1, size: '1024x1536' });
  const { runs, done } = await lab.createRuns([{ model_ref: model.id, prompt: plan.prompt, images: plan.images, scenario: plan }], admin, { confirm: true, total_usd: est.estimate.usd });
  await done; const run = await lab.getRun(runs[0]!.id);
  assert.equal(planned.length, 1); assert.equal(run.status, 'SUCCEEDED');
  assert.equal(run.prompt, 'SERVER OWNED PROMPT'); assert.deepEqual(run.scenario, { kind: 'basic', label: 'Basic · Test', production_model: 'prod-model', meta: { template_id: 't' } });
  assert.deepEqual(run.inputs.map(i => i.slot), ['template', 'reference']);
  const call = fake.calls.find(c => c.url.endsWith('/images/edits'))!;
  assert.match(String(call.body), /1024x1536/); assert.equal(run.params.size, '1024x1536');
  assert.equal(run.cost.calculated_usd, 0.025); // measured usage priced with the configured token schedule
});
test('scenario post-processing is applied and the raw provider image is kept; a failing finish keeps the paid image', async () => {
  const finished = await png(1024, 1536, '#fff');
  const ok = await setup({ finish: async () => finished });
  let plan = await ok.lab.planScenario({ kind: 'basic', template_id: 't' }, await png(300, 300));
  let created = await ok.lab.createRuns([{ model_ref: ok.model.id, prompt: plan.prompt, images: plan.images, scenario: plan }], admin, { confirm: true, total_usd: 0.025 }); await created.done;
  let run = await ok.lab.getRun(created.runs[0]!.id);
  assert.deepEqual([run.output!.width, run.output!.height], [1024, 1536]); assert.ok(run.raw_output); assert.equal((await ok.lab.runFile(run.id, 'raw')).bytes.length > 0, true);
  const bad = await setup({ finish: async () => { throw new Error('helper down'); } });
  plan = await bad.lab.planScenario({ kind: 'basic', template_id: 't' }, await png(300, 300));
  created = await bad.lab.createRuns([{ model_ref: bad.model.id, prompt: plan.prompt, images: plan.images, scenario: plan }], admin, { confirm: true, total_usd: 0.025 }); await created.done;
  run = await bad.lab.getRun(created.runs[0]!.id);
  assert.equal(run.status, 'SUCCEEDED'); assert.equal(run.params.finish_failed, true); assert.equal(run.raw_output, null);
});
test('scenario planning validates the face photo before anything else runs', async () => {
  const { lab, planned } = await setup();
  await assert.rejects(lab.planScenario({ kind: 'basic', template_id: 't' }, Buffer.from('not an image')), /Image could not be read|IMAGE/i);
  assert.equal(planned.length, 0);
});

// ---- bridge against fake production catalog ---------------------------------------------------------------------
test('bridge builds the exact production prompts and image preparation, and is read-only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lab-bridge-')), templatePath = join(dir, 't.png'), original = await png(1024, 1536, '#789'); await writeFile(templatePath, original);
  const calls: string[] = [];
  const catalogModel = {
    templates: async () => [{ id: 'royal-nusantara-hijab-001', name: 'Royal', description: 'Palace scene', image_path: 't.png', enabled: true }],
    template: async (id: string) => id === 'royal-nusantara-hijab-001' ? { id, name: 'Royal', description: 'Palace scene', image_path: 't.png', enabled: true } : null,
    experiences: async () => [{ id: 'space', name: 'Space', description: 'd', category: 'Fun', status: 'published', compatible_frame_style_ids_json: null }],
    experience: async (id: string) => id === 'mini-me' ? { model: 'basic-model' } : id === 'space' ? { id, name: 'Space', status: 'published', model: 'adv-model', internal_prompt: 'Astronaut world', compatible_frame_style_ids_json: null, compatible_ornament_ids_json: null, max_ornaments: 2 } : null,
    styles: async () => [{ id: 'gold', name: 'Gold', description: 'd', prompt_fragment: 'Gold frame', enabled: true }],
  };
  const assets = { file: async () => templatePath, templateMetadata: async () => ({ width: 1024, height: 1536 }), freezeBasicTemplate: async () => { calls.push('freeze'); throw new Error('must not be called'); } };
  const images = { basicIdentity: async (b: Buffer) => { calls.push('identity'); return b; }, basicTemplate: async (b: Buffer) => { calls.push('template'); return b; },
    providerInput: async (b: Buffer) => { calls.push('providerInput'); return b; }, advancedResult: async (b: Buffer) => { calls.push('advancedResult'); return b; } };
  const bridge = new NxScenarios(catalogModel as never, assets as never, images as never, 'mini-me'), face = await png(400, 400);
  const catalog = await bridge.catalog();
  assert.equal(catalog.basic[0]!.variant, 'hijab'); assert.equal(catalog.basic[0]!.theme, 'royal-nusantara'); assert.equal(catalog.advanced.frame_styles[0]!.id, 'gold');
  const basic = await bridge.plan({ kind: 'basic', template_id: 'royal-nusantara-hijab-001' }, face);
  assert.equal(basic.prompt, composeBasicPrompt('Royal', 'Palace scene')); assert.deepEqual(basic.images.map(i => i.role), ['template', 'reference']);
  assert.equal(basic.production_model, 'basic-model'); assert.deepEqual(basic.production_size, { width: 1024, height: 1536 });
  const advanced = await bridge.plan({ kind: 'advanced', experience_id: 'space', frame_style_id: 'gold' }, face);
  assert.equal(advanced.prompt, composeAdvancedPrompt('Astronaut world', 'Gold frame')); assert.equal(advanced.images.length, 1); assert.equal(advanced.production_model, 'adv-model');
  await advanced.finish!(face); assert.ok(calls.includes('advancedResult')); assert.ok(!calls.includes('freeze'));
  await assert.rejects(bridge.plan({ kind: 'basic', template_id: 'nope' }, face), /unavailable/);
  await assert.rejects(bridge.plan({ kind: 'advanced', experience_id: 'space', frame_style_id: 'missing' }, face), /Frame style/);
});
test('the bridge imports only read paths of the production code (no queue, credits, runner, provider or wallet)', () => {
  const source = readFileSync('src/lab-bridge/nx-scenarios.ts', 'utf8');
  for (const m of source.matchAll(/from '([^']+)'/g)) assert.ok(!/queue|credit|runner|native-provider|ninerouter|wallet|worker|customer-generation\.service|provider-run/.test(m[1]!), m[1]);
  assert.ok(!/\.(create|update|delete|upsert)\(/.test(source) && !/freezeBasicTemplate\(/.test(source));
});

test('condensed Basic prompt fits 800 characters and keeps the production directives', async () => {
  const { compactBasicPrompt } = await import('../src/lab-bridge/nx-scenarios.js');
  for (const name of ['Cyberpunk Neon · Man', 'X'.repeat(200)]) {
    const text = compactBasicPrompt(name);
    assert.ok(text.length <= 800, String(text.length));
    for (const needle of ['Image 1', 'Image 2', 'subtle, template-dominant', 'not a literal replacement', 'lettering', 'NXBooth']) assert.ok(text.includes(needle), needle);
  }
});
