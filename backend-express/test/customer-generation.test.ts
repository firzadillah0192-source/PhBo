import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { NxExperience, NxFrameStyle, NxOrnament } from '@prisma/client';
import { generationInput, validateAdvancedSelection } from '../src/services/customer-generation-input.js';
import { composeAdvancedPrompt, composeBasicPrompt, STYLE_PRINCIPLE, COMPOSITION_RULES, BRANDING_RULES } from '../src/services/advanced-prompt.service.js';
import { AdminUsageService } from '../src/services/admin-usage.service.js';

test('native generation accepts the three current contracts and rejects mixed selections', () => {
  const valid = [
    { mode: 'CLASSIC', upload_id: 'u', layout_id: 'l', capture_upload_ids: ['u', 'v', 'w'] },
    { mode: 'BASIC', upload_id: 'u', template_id: 't' },
    { mode: 'ADVANCED', upload_id: 'u', experience_id: 'e', frame_style_id: 'modern', ornament_ids: ['sparkles'] },
  ];
  valid.forEach(value => assert.equal(generationInput.safeParse(value).success, true));
  const invalid = [
    { ...valid[0], upload_id: 'different' }, { ...valid[0], frame_style_id: 'modern' },
    { ...valid[1], template_id: null }, { ...valid[1], experience_id: 'e' },
    { ...valid[1], ornament_ids: ['sparkles'] }, { ...valid[2], layout_id: 'l' },
    { ...valid[2], template_id: 't' }, { ...valid[2], provider: 'client-override' },
  ];
  invalid.forEach(value => assert.equal(generationInput.safeParse(value).success, false));
});

test('native Advanced selection preserves enabled flags, compatibility and maximum rules', () => {
  const experience = { compatible_frame_style_ids_json: '["modern"]', compatible_ornament_ids_json: '["sparkles"]', max_ornaments: 3 } as NxExperience;
  const frame = { id: 'modern', enabled: true } as NxFrameStyle;
  const sparkle = { id: 'sparkles', enabled: true } as NxOrnament;
  validateAdvancedSelection(experience, frame, [sparkle], ['sparkles']);
  validateAdvancedSelection(experience, frame, [], []);
  for (const disabled of [null, { ...frame, enabled: false }, { ...frame, id: 'natural' }]) assert.throws(() => validateAdvancedSelection(experience, disabled, [], []));
  assert.throws(() => validateAdvancedSelection(experience, frame, [], ['unknown']));
  assert.throws(() => validateAdvancedSelection(experience, frame, [{ ...sparkle, enabled: false }], ['sparkles']));
  assert.throws(() => validateAdvancedSelection(experience, frame, [sparkle], ['sparkles', 'sparkles']));
  assert.throws(() => validateAdvancedSelection({ ...experience, max_ornaments: 0 }, frame, [sparkle], ['sparkles']));
  assert.throws(() => validateAdvancedSelection({ ...experience, compatible_ornament_ids_json: '{}' }, frame, [sparkle], ['sparkles']));
  assert.throws(() => validateAdvancedSelection(experience, frame, [{ ...sparkle, id: 'hearts' }], ['hearts']));
});

test('Basic template prompt is server-owned and preserves identity and print branding', () => {
  const prompt = composeBasicPrompt('Space Commander', 'A cinematic sci-fi commander portrait.');
  assert.match(prompt, /Space Commander/);
  assert.match(prompt, /A cinematic sci-fi commander portrait\./);
  assert.match(prompt, /recognizable facial structure/);
  assert.match(prompt, /NXBooth/);
  assert.throws(() => composeBasicPrompt('', 'description'));
  assert.throws(() => composeBasicPrompt('Template', ''));
});

test('provider usage coverage includes both Basic and Advanced AI jobs', async () => {
  const jobs = [{ id: 'basic', state: 'COMPLETED' }, { id: 'advanced', state: 'FAILED' }];
  const runs = [
    { provider_name: '9router', provider_usage_raw_json: '{}', provider_account_id: 'a', provider_account_label: null,
      upstream_status: 'SUCCEEDED', created_at: new Date(), router_duration_ms: 100, input_tokens: 10, output_tokens: 20, total_tokens: 30,
      attempt_count: 1, provider_reported_cost: null },
    { provider_name: '9router', provider_usage_raw_json: null, provider_account_id: null, provider_account_label: null,
      upstream_status: 'FAILED', created_at: new Date(), router_duration_ms: null, input_tokens: null, output_tokens: null, total_tokens: null,
      attempt_count: null, provider_reported_cost: null },
  ];
  const db = {
    nxProviderRun: { findMany: async () => runs },
    nxGenerationJob: { count: async ({ where }: { where: { mode?: { in?: string[] } | string } }) => where.mode === 'ADVANCED' ? 1 : 2,
      findMany: async () => jobs },
    nxQuotaReservation: { aggregate: async () => ({ _sum: { amount: 0 } }), count: async () => 0 },
  };
  const model = { read: async (query: (connection: typeof db) => unknown) => query(db) };
  const operations = { model, async overview() { return { total_users: 1, active_users: 1, successful_generations: 1,
    failed_generations: 1, ai_credits_consumed: 1 }; } };
  const usage = new AdminUsageService(operations as never, {} as never);
  const summary = await usage.overview();
  assert.equal(summary.ai_jobs, 2);
  assert.equal(summary.advanced_jobs, 1);
  assert.equal(summary.usage_coverage_percent, 50);
  const providers = await usage.providerOverview();
  assert.equal(providers.total_ai_jobs, 2);
  assert.equal(providers.total_advanced_jobs, 1);
  assert.equal(providers.completed, 1);
  assert.equal(providers.failed, 1);
});

test('native prompt composition matches current Python byte-for-byte for all ten presets', () => {
  // Read constants/function via the stdlib AST, without importing application
  // settings, accessing a database, connecting a provider, or printing secrets.
  const path = fileURLToPath(new URL('../../backend/app/services/advanced_prompt.py', import.meta.url));
  const script = `import ast,json,sys
tree=ast.parse(open(sys.argv[1]).read())
names={'STYLE_PRINCIPLE','COMPOSITION_RULES','BRANDING_RULES','FRAME_STYLE_SEEDS'}
nodes=[n for n in tree.body if (isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in names) or (isinstance(n,ast.FunctionDef) and n.name=='compose_advanced_prompt')]
namespace={'AdvancedSelectionError':ValueError}
exec(compile(ast.Module(body=nodes,type_ignores=[]),'prompt-parity','exec'),namespace)
print(json.dumps({'principle':namespace['STYLE_PRINCIPLE'],'composition':namespace['COMPOSITION_RULES'],'branding':namespace['BRANDING_RULES'],'presets':[(i,p,namespace['compose_advanced_prompt']('  Experience authority  ',p)) for i,_,_,p in namespace['FRAME_STYLE_SEEDS']]}))`;
  const reference = JSON.parse(execFileSync('python3', ['-c', script, path], { encoding: 'utf8' }));
  assert.equal(STYLE_PRINCIPLE, reference.principle); assert.equal(COMPOSITION_RULES, reference.composition); assert.equal(BRANDING_RULES, reference.branding);
  assert.equal(reference.presets.length, 10);
  for (const [_id, fragment, expected] of reference.presets) {
    const actual = composeAdvancedPrompt('  Experience authority  ', fragment);
    assert.equal(actual, expected); assert.equal(actual, composeAdvancedPrompt('Experience authority', fragment));
    assert.match(actual, /^EXPERIENCE — PRIMARY VISUAL AUTHORITY\nExperience authority/);
  }
  assert.throws(() => composeAdvancedPrompt('', 'frame')); assert.throws(() => composeAdvancedPrompt('experience', ' '));
});
