import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerGenerationService } from '../src/services/customer-generation.service.js';
import { composeBasicPrompt, composeAdvancedPrompt } from '../src/services/advanced-prompt.service.js';
import { basicVariant, composeFastBasicPrompt } from '../src/services/fast-basic-prompt.service.js';
import { parseGenerationSnapshot } from '../src/services/generation-snapshot.js';

const timestamp = new Date('2026-10-20T08:00:00Z');
const owner = { account: { id: 'owner' }, guest: null } as never;
const template = { id: 'aviation-captain-man-001', enabled: true, image_path: 'frozen.png', name: 'Aviation Captain', description: 'A captain in a hangar at sunrise.' };
const frozen = { asset: 'frozen.png', sha256: 'a'.repeat(64), width: 1024, height: 1536 };
function fixture() {
  const writes: any[] = [], enqueued: string[] = [], selected: string[] = [];
  const model = {
    template: async () => template,
    experience: async () => ({ enabled: true, status: 'published', model: 'cx/gpt-image-2.5', internal_prompt: 'Synthetic experience', compatible_frame_style_ids_json: null, compatible_ornament_ids_json: null, max_ornaments: 0 }),
    frame: async () => ({ enabled: true, prompt_fragment: 'Synthetic frame' }), ornaments: async () => [],
    create: async (data: any, lane: string) => { writes.push({ data, lane }); return { ...data, created_at: timestamp }; },
  };
  const service = new CustomerGenerationService(model as never, { owned: async () => ({ upload: { id: 'photo', created_at: timestamp } }) } as never,
    { file: async () => 'frozen.png', freezeBasicTemplate: async () => frozen } as never, { enqueue: async id => { enqueued.push(id); } }, 'basic-model',
    { provider: async (lane: string) => { selected.push(lane); return {}; } } as never);
  return { service, writes, enqueued, selected };
}

test('every Basic lane (Fast, Standard, default) freezes the same likeness prompt', async () => {
  const { service, writes, enqueued, selected } = fixture();
  for (const lane of ['fast', 'standard', undefined]) {
    await service.create({ mode: 'BASIC', upload_id: 'photo', template_id: template.id, ...(lane ? { lane } : {}) }, owner);
  }
  const snapshots = writes.map(({ data }) => { const snapshot = parseGenerationSnapshot(data.engine_config_json, 'BASIC'); assert.ok(snapshot?.mode === 'BASIC'); return snapshot; });
  for (const snapshot of snapshots) assert.equal(snapshot!.prompt, composeFastBasicPrompt(template.name, template.description, snapshot!.personalization, template.id));
  for (const snapshot of snapshots) assert.match(snapshot!.prompt, /PLATE TEXT/);
  assert.notEqual(snapshots[0]!.prompt, composeBasicPrompt(template.name, template.description));
  for (const snapshot of snapshots) {
    assert.equal(snapshot!.version, 2);
    if (snapshot!.version === 2) assert.deepEqual(snapshot!.template, frozen);
  }
  assert.deepEqual(selected, ['fast', 'standard', 'standard']);
  assert.deepEqual(writes.map(row => row.lane), ['fast', 'standard', 'standard']);
  assert.equal(enqueued.length, 3);
});

test('Fast Advanced keeps the existing Advanced prompt', async () => {
  const { service, writes } = fixture();
  await service.create({ mode: 'ADVANCED', lane: 'fast', upload_id: 'photo', experience_id: 'scene' }, owner);
  const snapshot = parseGenerationSnapshot(writes[0].data.engine_config_json, 'ADVANCED');
  assert.ok(snapshot?.mode === 'ADVANCED');
  assert.equal(snapshot.prompt, composeAdvancedPrompt('Synthetic experience', 'Synthetic frame', snapshot.personalization));
  assert.match(snapshot.prompt, /FOOTER EVENT LINE\n/);
});

test('retrying a saved Fast Basic job does not rewrite its prompt, reserve another job or enqueue', async () => {
  const saved = { id: 'previous-job', mode: 'BASIC', upload_id: 'photo', state: 'COMPLETED', ornament_ids_json: null,
    engine_config_json: JSON.stringify({ version: 2, mode: 'BASIC', model: 'cx/gpt-image-2.5', prompt: 'Previously approved frozen prompt', template: frozen }) };
  const service = new CustomerGenerationService({ findRequest: async () => saved } as never,
    { owned: async () => assert.fail('retry must not read upload') } as never, {} as never,
    { enqueue: async () => assert.fail('retry must not enqueue') }, 'basic-model',
    { provider: async () => assert.fail('retry must not resolve another route') } as never);
  const before = saved.engine_config_json;
  assert.equal((await service.create({ mode: 'BASIC', lane: 'fast', upload_id: 'photo', template_id: template.id }, owner, 'previous-key')).job_id, 'previous-job');
  assert.equal(saved.engine_config_json, before);
});

test('the prompt follows the template: male/neutral, female and hijab woman', () => {
  const male = composeFastBasicPrompt('Aviation Captain · Man', 'Man. Head-to-mid-thigh flight captain in a navy uniform.');
  const female = composeFastBasicPrompt('Aviation Captain · Woman', 'Woman with dark hair. Head-to-mid-thigh flight captain in a navy uniform.');
  const hijab = composeFastBasicPrompt('Aviation Captain · Hijab Woman', 'Woman wearing a neatly styled hijab covering all hair. Head-to-mid-thigh flight captain.');
  const neutral = composeFastBasicPrompt('Sci-Fi Space Commander', 'Cinematic sci-fi portrait of a starship commander on a command deck.');
  assert.deepEqual(['Aviation Captain · Man', 'Aviation Captain · Woman', 'Aviation Captain · Hijab Woman', 'Sci-Fi Space Commander'].map((name, i) => basicVariant(name, ['Man.', 'Woman with dark hair.', 'Woman wearing a neatly styled hijab', 'Cinematic sci-fi portrait'][i]!)), ['male', 'female', 'hijab', 'male']);
  for (const prompt of [male, female, hijab]) {
    assert.match(prompt, /does not have to copy the angle of Image 1/);
    assert.match(prompt, /never enlarge or widen the head/);
    assert.match(prompt, /The face in Image 1 is blurred on purpose/);
  }
  assert.match(male, /clean defined jaw and chin/);
  assert.doesNotMatch(male, /feminine|hijab/i);
  for (const prompt of [female, hijab]) {
    assert.match(prompt, /soft feminine features/);
    assert.doesNotMatch(prompt, /clean defined jaw/);
  }
  assert.match(male, /HAIR\nRestyle the customer's own hair from Image 2 into the hairstyle of Image 1/);
  assert.match(female, /even when the customer's hair in Image 2 is short, thin or shaved, or the customer is bald/);
  assert.match(hijab, /HIJAB\nThe hijab of Image 1/);
  assert.match(hijab, /never reveal hair/);
  assert.doesNotMatch(hijab, /into the hairstyle of Image 1/);
  assert.equal(neutral.replace(/PORTRAIT THEME\n[^\n]*/, ''), male.replace(/PORTRAIT THEME\n[^\n]*/, ''));
  assert.throws(() => composeFastBasicPrompt('', 'x'));
});

test('plate text: event name left, date right; date only when there is no event name; none for kiosk', () => {
  const named = composeFastBasicPrompt('Aviation Captain · Man', 'Man. Flight captain.', { event_name: 'Ulang Tahun Budi', captured_at: '2026-10-21T02:00:00.000Z' });
  assert.match(named, /"Ulang Tahun Budi" on the left half of the plate, and the date "21 Oktober 2026" on the right half/);
  assert.match(named, /do not draw any QR code/);
  const dateOnly = composeFastBasicPrompt('Aviation Captain · Man', 'Man. Flight captain.', { captured_at: '2026-12-31T20:00:00.000Z' });
  assert.match(dateOnly, /one centered line of text: the date "01 Januari 2027"/);
  assert.doesNotMatch(composeFastBasicPrompt('Aviation Captain · Man', 'Man. Flight captain.'), /PLATE TEXT/);
});

test('every theme has its own light note; unknown templates and calls without an id stay unchanged', () => {
  const base = composeFastBasicPrompt('X · Man', 'Man.');
  assert.doesNotMatch(base, /TEMPLATE LIGHT/);
  for (const id of ['aviation-captain-man-001', 'sci-fi-space-commander-framed-001', 'royal-nusantara-hijab-001', 'cyberpunk-neon-001', 'arctic-expedition-man-001']) {
    const prompt = composeFastBasicPrompt('X · Man', 'Man.', undefined, id);
    assert.match(prompt, /TEMPLATE LIGHT\n/);
    assert.equal(prompt.replace(/TEMPLATE LIGHT\n[^\n]*\n\n/, ''), base);
  }
  assert.doesNotMatch(composeFastBasicPrompt('X', 'Man.', undefined, 'unknown-theme-001'), /TEMPLATE LIGHT/);
  assert.match(composeFastBasicPrompt('X · Man', 'Man.', undefined, 'royal-nusantara-man-001'), /warm skin of the neck and hands/);
});

test('Advanced footer line: event name and date, date only without a name, none for kiosk', () => {
  const named = composeAdvancedPrompt('Experience', 'Frame', { event_name: 'Wedding of R&R', captured_at: '2026-10-22T02:00:00.000Z' });
  assert.match(named, /the event name "Wedding of R&R" and the date "22 Oktober 2026", separated by a thin divider/);
  assert.match(named, /Do not draw any QR code or barcode/);
  assert.match(composeAdvancedPrompt('Experience', 'Frame', { captured_at: '2026-10-22T02:00:00.000Z' }), /one line with the date "22 Oktober 2026"/);
  assert.doesNotMatch(composeAdvancedPrompt('Experience', 'Frame'), /FOOTER EVENT LINE/);
});
