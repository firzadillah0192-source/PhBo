import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import sharp from 'sharp';
import type { PrismaClient, NxTemplate, NxExperience, NxClassicLayout, NxFrameStyle } from '@prisma/client';
import { CustomerCatalogModel } from '../src/models/customer-catalog.model.js';
import { CatalogAssetsService, reviewedSlots } from '../src/services/catalog-assets.service.js';
import { CustomerCatalogService } from '../src/services/customer-catalog.service.js';
import { createMigrationApp } from '../src/migration-app.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nxbooth-express-catalog-'));
  const png = await sharp({ create: { width: 24, height: 72, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } })
    .composite([{ input: await sharp({ create: { width: 18, height: 16, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(), left: 3, top: 3, blend: 'dest-out' }]).png().toBuffer();
  // Use explicit opaque alpha mask for dest-out to make a real photo opening.
  const frame = await sharp(png).composite([{ input: await sharp({ create: { width: 18, height: 16, channels: 4, background: 'white' } }).png().toBuffer(), left: 3, top: 3, blend: 'dest-out' }]).png().toBuffer();
  const image = join(root, 'frame.png');
  await writeFile(image, frame);
  const templateDir = join(root, 'sci-fi-space-commander-framed-001');
  await mkdir(templateDir);
  await writeFile(join(templateDir, 'template.json'), JSON.stringify({ width: 1024, height: 1536, face_region: [402, 350, 194, 194] }));
  const template: NxTemplate = { created_at: new Date(), updated_at: new Date(), updated_by: "test", id: 'sci-fi-space-commander-framed-001', name: 'Sci-Fi Space Commander', description: 'Framed Basic Template', image_path: image, marketing_preview_path: image, metadata_path: null, enabled: true, sort_order: -1 };
  const experience: NxExperience = { created_at: new Date(), updated_at: new Date(), updated_by: "test", internal_prompt: "private", provider: "9router", model: "test", reference_mode: "SINGLE_USER_IMAGE", output_format: "PNG", preview_status: "READY", preview_error: null, id: 'mini-me', name: 'Mini Me', description: 'Published world', category: 'Playful', thumbnail_path: image, status: 'published', enabled: false, sort_order: 0, compatible_frame_style_ids_json: '["modern"]', compatible_ornament_ids_json: '["sparkles"]', max_ornaments: 3 };
  const layout: NxClassicLayout = { created_at: new Date(), updated_at: new Date(), id: 'classic-frame-001', slug: 'classic-frame-001', name: 'Classic', canvas_width: 24, canvas_height: 72, shot_count: 1, layout_config_json: JSON.stringify({ slots: [{ x: 3, y: 3, width: 18, height: 16, fit: 'cover' }], theme_slug: 'birthday', theme_name: 'Birthday' }), frame_asset_path: image, active: true, sort_order: 0 };
  const style: NxFrameStyle = { prompt_fragment: "private direction", id: 'modern', slug: 'modern', name: 'Modern', description: 'Clean geometry', enabled: true, sort_order: 0 };
  const model = {
    async templates() { return template.enabled ? [template] : []; }, async template(id: string) { return id === template.id ? template : null; },
    async experiences() { return experience.status === 'published' ? [experience] : []; }, async experience(id: string) { return id === experience.id ? experience : null; },
    async layouts() { return layout.active ? [layout] : []; }, async layout(id: string) { return id === layout.id ? layout : null; },
    async styles() { return [style]; }, async ornaments() { return [{ ...style, id: 'sparkles', slug: 'sparkles' }]; },
  };
  const assets = new CatalogAssetsService([root], root);
  const service = new CustomerCatalogService(model, assets);
  const app = createMigrationApp(service, { corsOrigins: ['http://localhost:5173'] });
  return { root, image, template, experience, layout, assets, service, app, async close() { await rm(root, { recursive: true, force: true }); } };
}

test('native Express catalog preserves Basic framed template fields and public preview', async () => {
  const h = await fixture();
  try {
    const response = await request(h.app).get('/api/templates').expect(200);
    assert.deepEqual(response.body, { templates: [{ id: h.template.id, name: h.template.name, description: h.template.description, preview_url: `/api/templates/${h.template.id}/preview`, width: 1024, height: 1536, basic_available: true, enabled: true, sort_order: -1 }], count: 1 });
    assert.match(response.headers['cache-control'], /no-store/);
    await request(h.app).get(response.body.templates[0].preview_url).expect('Content-Type', /image\/png/).expect(200);
    h.template.enabled = false;
    await request(h.app).get(`/api/templates/${h.template.id}/preview`).expect(404);
  } finally { await h.close(); }
});

test('native experience catalog preserves publication, preview and compatibility without exposing prompts', async () => {
  const h = await fixture();
  try {
    const response = await request(h.app).get('/api/experiences').expect(200);
    assert.equal(response.body.count, 1);
    assert.equal(response.body.experiences[0].enabled, true);
    assert.deepEqual(response.body.experiences[0].compatible_frame_style_ids, ['modern']);
    assert.deepEqual(response.body.experiences[0].compatible_ornament_ids, ['sparkles']);
    assert.equal(response.body.experiences[0].max_ornaments, 3);
    assert.equal(response.body.experiences[0].internal_prompt, undefined);
    await request(h.app).get(response.body.experiences[0].thumbnail).expect(200);
    h.experience.status = 'draft';
    assert.equal((await request(h.app).get('/api/experiences')).body.count, 0);
    await request(h.app).get('/api/experiences/mini-me/thumbnail').expect(404);
  } finally { await h.close(); }
});

test('Classic preserves IDs, reviewed slots, dimensions, photo count, theme and overlay preview', async () => {
  const h = await fixture();
  try {
    const response = await request(h.app).get('/api/classic/layouts').expect(200);
    assert.equal(response.body.length, 1);
    const layout = response.body[0];
    assert.equal(layout.id, h.layout.id);
    assert.equal(layout.canvas_width, 24); assert.equal(layout.canvas_height, 72);
    assert.equal(layout.shot_count, layout.slots.length);
    assert.equal(layout.theme_slug, 'birthday');
    const preview = await request(h.app).get(layout.preview_url).expect(200);
    assert.equal((await sharp(preview.body).metadata()).height, 72);
    h.layout.shot_count = 4;
    assert.deepEqual((await request(h.app).get('/api/classic/layouts')).body, []);
    await request(h.app).get(layout.preview_url).expect(404);
  } finally { await h.close(); }
});

test('Classic validation rejects bounds, stretching, opaque openings and asset changes', async () => {
  const h = await fixture();
  try {
    await h.assets.validateLayout(h.layout);
    for (const slot of [{ x: -1, y: 0, width: 18, height: 16 }, { x: 20, y: 0, width: 18, height: 16 }, { x: 0, y: 0, width: 0, height: 16 }, { x: 0, y: 0, width: 18, height: 16, fit: 'stretch' }]) {
      assert.throws(() => reviewedSlots({ ...h.layout, layout_config_json: JSON.stringify({ slots: [slot] }) }));
    }
    await writeFile(h.image, await sharp({ create: { width: 24, height: 72, channels: 4, background: 'red' } }).png().toBuffer());
    await assert.rejects(h.assets.validateLayout(h.layout));
  } finally { await h.close(); }
});

test('managed asset resolution rejects files and symlinks outside allowed roots', async () => {
  const h = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'nxbooth-express-outside-'));
  try {
    const secret = join(outside, 'unmanaged.png');
    await writeFile(secret, 'unmanaged');
    await symlink(secret, join(h.root, 'link.png'));
    assert.equal(await h.assets.file(secret), null);
    assert.equal(await h.assets.file(join(h.root, 'link.png')), null);
    await request(h.app).get('/api/templates/%2e%2e/preview').expect(404);
  } finally { await h.close(); await rm(outside, { recursive: true, force: true }); }
});

test('Advanced frame and ornament routes retain the existing array contract', async () => {
  const h = await fixture();
  try {
    assert.equal((await request(h.app).get('/api/advanced/frame-styles').expect(200)).body[0].id, 'modern');
    assert.equal((await request(h.app).get('/api/advanced/ornaments').expect(200)).body[0].id, 'sparkles');
    await request(h.app).post('/api/generations').expect(404);
    await request(h.app).get('/health').expect(200);
  } finally { await h.close(); }
});

test('Prisma catalog model uses existing tables and preserves publication and sorting rules', async () => {
  const calls: unknown[] = [];
  const delegate = { async findMany(input: unknown) { calls.push(input); return []; } };
  const model = new CustomerCatalogModel({ nxTemplate: delegate, nxExperience: delegate, nxClassicLayout: delegate, nxFrameStyle: delegate, nxOrnament: delegate } as unknown as PrismaClient);
  await model.templates(); await model.experiences(); await model.layouts(); await model.styles(); await model.ornaments();
  assert.deepEqual(calls, [
    { where: { enabled: true }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] },
    { where: { status: 'published' }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] },
    { where: { active: true }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] },
    { where: { enabled: true }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] },
    { where: { enabled: true }, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] },
  ]);
});
