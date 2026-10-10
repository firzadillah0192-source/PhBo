import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NxExperience, NxFrameStyle, NxOrnament } from '@prisma/client';
import { generationInput, validateAdvancedSelection } from '../src/services/customer-generation-input.js';
import { composeAdvancedPrompt, composeBasicPrompt, STYLE_PRINCIPLE, COMPOSITION_RULES, BRANDING_RULES } from '../src/services/advanced-prompt.service.js';
import { AdminUsageService } from '../src/services/admin-usage.service.js';
import { requiresEventName } from '../src/services/catalog-assets.service.js';
import { CustomerGenerationService } from '../src/services/customer-generation.service.js';

test('Themed personalization freezes the name/time/claim for web and native kiosk jobs',async()=>{
  const timestamp=new Date('2026-10-10T07:00:00.000Z');
  const layout={id:'classic-wedding-jawa-001',active:true,shot_count:3,layout_config_json:'{"event_personalization":true}'};
  let writes=0,saved:any,context:any;
  const model={layout:async()=>layout,findRequest:async()=>null,createOnce:async(data:any,_request:any,kiosk:any)=>{writes++;saved=data;context=kiosk;return {job:{...data,created_at:timestamp},reused:false}}};
  const uploads={owned:async(id:string)=>({upload:{id,created_at:timestamp}})};
  const assets={validateLayout:async()=>{},freezeLayout:async()=>layout};
  const service=new CustomerGenerationService(model as never,uploads as never,assets as never,{enqueue:async()=>{}});
  const identity={account:null,guest:{id:'guest'},clearAccount:false,newGuest:null,sessionId:null} as never;
  const body={mode:'CLASSIC',upload_id:'a',layout_id:layout.id,capture_upload_ids:['a','b','c'],event_name:'Pernikahan Sarah & Arif',captured_at:'2026-10-10T06:59:00.000Z'};
  await assert.rejects(service.create({...body,event_name:undefined},identity,'missing'),(error:any)=>error.code==='EVENT_NAME_REQUIRED');
  await assert.rejects(service.create({...body,captured_at:'2020-01-01T00:00:00.000Z'},identity,'bad-time'),(error:any)=>error.code==='CAPTURE_TIME_INVALID');
  assert.equal(writes,0);
  for(const kiosk of [undefined,{id:'kiosk-session',guestId:'guest'}]){
    await service.create(body,identity,'request-'+writes,kiosk);
    const snapshot=JSON.parse(saved.engine_config_json);
    assert.equal(snapshot.personalization.event_name,body.event_name);assert.equal(snapshot.personalization.captured_at,body.captured_at);
    assert.match(snapshot.personalization.claim_token,/^[A-Za-z0-9_-]{43}$/);assert.deepEqual(context,kiosk);
  }
  layout.layout_config_json='{}';
  await assert.rejects(service.create(body,identity,'legacy'),(error:any)=>error.code==='CLASSIC_PERSONALIZATION_UNAVAILABLE');
  assert.equal(writes,2);
});

test('Personalization is enabled by reviewed metadata across themed frames, not by an ID prefix', () => {
  assert.equal(requiresEventName({ id:'classic-wedding-jawa-001',layout_config_json:'{"event_personalization":true}' }),true);
  assert.equal(requiresEventName({ id:'classic-birthday-001',layout_config_json:'{}' }),false);
  assert.equal(requiresEventName({ id:'classic-floral-event-001',layout_config_json:'{}' }),true);
  const body={mode:'CLASSIC',upload_id:'a',layout_id:'classic-wedding-jawa-001',capture_upload_ids:['a','b','c'],event_name:'Pernikahan Sarah & Arif',captured_at:'2026-10-10T07:00:00.000Z'};
  assert.equal(generationInput.safeParse(body).success,true);
  for(const name of ['', 'A\nB', 'x'.repeat(81)])assert.equal(generationInput.safeParse({...body,event_name:name}).success,false);
  assert.equal(generationInput.safeParse({...body,mode:'BASIC',template_id:'t'}).success,false);
});

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

test('Basic prompt creates subtle resemblance with template-dominant contours and natural visual merging', () => {
  const prompt = composeBasicPrompt('Space Commander', 'A cinematic sci-fi commander portrait.');
  assert.match(prompt, /Space Commander/);
  assert.match(prompt, /A cinematic sci-fi commander portrait\./);
  assert.match(prompt, /subtle template-dominant facial resemblance/);
  assert.match(prompt, /Preserve the hair exactly as Image 1/);
  assert.match(prompt, /Preserve the facial skin tone and complexion exactly as Image 1/);
  assert.match(prompt, /Adopt the source nose gently and naturally/);
  assert.match(prompt, /If Image 2 visibly contains eyeglasses/);
  assert.match(prompt, /Render lens transparency, reflections, highlights, and contact shadows using the lighting of Image 1/);
  assert.match(prompt, /If Image 2 has no eyeglasses, do not introduce new eyewear/);
  assert.doesNotMatch(prompt, /recognizable facial structure|Preserve natural complexion/);
  assert.equal(prompt, composeBasicPrompt('  Space Commander  ', '  A cinematic sci-fi commander portrait.  '));
  assert.match(prompt, /Preserve the source eye shape without enlarging, narrowing, lifting, beautifying/);
  assert.match(prompt, /Do not copy the source cheek width, jaw width, chin outline/);
  assert.match(prompt, /Retain the template overall facial silhouette and broad proportions/);
  assert.match(prompt, /NATURAL VISUAL MERGE/);
  assert.match(prompt, /Avoid a sharply outlined transplanted face/);
  assert.doesNotMatch(prompt, /sole authority for facial identity|source facial contours and feature proportions to replace|SOURCE FACIAL ANATOMY/);
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

test('native prompt composition is deterministic for all ten editable style IDs', () => {
  const presets = [
    ['natural','Create a subtle organic photobooth frame.'],['modern','Create a sophisticated contemporary photobooth frame.'],
    ['minimal','Create a refined minimal composition.'],['luxury','Create a premium luxury treatment.'],
    ['retro','Create a tasteful retro composition.'],['film','Create a premium film-inspired treatment.'],
    ['cute','Create a polished playful frame.'],['editorial','Create a high-end editorial composition.'],
    ['futuristic','Create a premium futuristic treatment.'],['artistic','Create an expressive art-directed frame.'],
  ];
  assert.equal(presets.length,10);assert.equal(new Set(presets.map(([id])=>id)).size,10);
  for (const [id,fragment] of presets) {
    const actual=composeAdvancedPrompt('  Experience authority  ',fragment);
    assert.equal(actual,composeAdvancedPrompt('Experience authority',fragment));
    assert.match(actual,/^EXPERIENCE — PRIMARY VISUAL AUTHORITY\nExperience authority/);
    assert.ok(actual.indexOf('FRAME STYLE\n'+fragment)<actual.indexOf('PRINT AND COMPOSITION\n'));
    assert.ok(actual.includes(STYLE_PRINCIPLE));assert.ok(actual.includes(COMPOSITION_RULES));assert.ok(actual.includes(BRANDING_RULES));
    assert.match(id,/^[a-z]+$/);
  }
  assert.throws(() => composeAdvancedPrompt('', 'frame')); assert.throws(() => composeAdvancedPrompt('experience', ' '));
});
