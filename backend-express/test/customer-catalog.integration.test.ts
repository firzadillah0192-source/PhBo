import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { CustomerCatalogModel } from '../src/models/customer-catalog.model.js';
import { CatalogAssetsService } from '../src/services/catalog-assets.service.js';
import { CustomerCatalogService } from '../src/services/customer-catalog.service.js';
import { createMigrationApp } from '../src/migration-app.js';
import { extendCatalogFixture } from './migration-fixture-schema.js';

test('real PostgreSQL: existing catalog tables, stable IDs, all 35 Classic masters, 10 styles and published previews', async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString && /^nxbooth_express_[a-z0-9_]*test$/.test(decodeURIComponent(new URL(connectionString).pathname.slice(1))), 'Use a dedicated nxbooth_express_*test database');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const assetsRoot = join(root, 'templates');
  const sql = new pg.Client({ connectionString });
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  await sql.connect();
  try {
    // Disposable fixture mirrors only the columns read from existing registries.
    // Do not apply the upstream replacement-schema migrations to legacy tables.
    await sql.query(`
      CREATE TABLE admin_templates (id varchar(128) PRIMARY KEY, name varchar(255) NOT NULL, description text NOT NULL, image_path varchar(512) NOT NULL, marketing_preview_path varchar(512), metadata_path varchar(512), enabled boolean NOT NULL, sort_order integer NOT NULL);
      CREATE TABLE admin_experiences (id varchar(128) PRIMARY KEY, name varchar(255) NOT NULL, description text NOT NULL, category varchar(64) NOT NULL, thumbnail_path varchar(512), status varchar(16) NOT NULL, enabled boolean NOT NULL, sort_order integer NOT NULL, compatible_frame_style_ids_json text, compatible_ornament_ids_json text, max_ornaments integer NOT NULL);
      CREATE TABLE classic_layouts (id varchar(32) PRIMARY KEY, slug varchar(128) NOT NULL UNIQUE, name varchar(255) NOT NULL, canvas_width integer NOT NULL, canvas_height integer NOT NULL, shot_count integer NOT NULL, layout_config_json text NOT NULL, frame_asset_path varchar(512), active boolean NOT NULL, sort_order integer NOT NULL);
      CREATE TABLE advanced_frame_styles (id varchar(128) PRIMARY KEY, slug varchar(128) NOT NULL UNIQUE, name varchar(255) NOT NULL, description text NOT NULL, enabled boolean NOT NULL, sort_order integer NOT NULL);
      CREATE TABLE advanced_ornaments (id varchar(128) PRIMARY KEY, slug varchar(128) NOT NULL UNIQUE, name varchar(255) NOT NULL, description text NOT NULL, enabled boolean NOT NULL, sort_order integer NOT NULL);
    `);
    await extendCatalogFixture(sql);
    const original = JSON.parse(await readFile(join(root, 'backend/app/data/classic_original_strip_frames.json'), 'utf8')).frames;
    const event = JSON.parse(await readFile(join(root, 'backend/app/data/classic_event_frames.json'), 'utf8')).frames;
    for (const [frames, base] of [[original, join(assetsRoot, '_classic')], [event, join(assetsRoot, '_classic/events')]] as const) {
      for (const item of frames) await sql.query('INSERT INTO classic_layouts VALUES ($1::text,$1::text,$2,$3,$4,$5,$6,$7,true,$8)', [item.id, item.name, item.canvas_width, item.canvas_height, item.shot_count, JSON.stringify(item), join(base, item.filename), item.sort_order]);
    }
    const template = 'sci-fi-space-commander-framed-001';
    const preview = join(assetsRoot, template, 'preview.png');
    await sql.query('INSERT INTO admin_templates VALUES ($1,$2,$3,$4,$5,NULL,true,-1)', [template, 'Sci-Fi Space Commander', 'Framed Basic Template', join(assetsRoot, template, 'template.png'), preview]);
    await sql.query('INSERT INTO admin_templates VALUES ($1,$2,$3,$4,NULL,NULL,false,0)', ['sci-fi-space-commander-001', 'Old template', 'Rollback', join(assetsRoot, 'sci-fi-space-commander-001/template.png')]);
    await sql.query('INSERT INTO admin_experiences VALUES ($1,$2,$3,$4,$5,$6,false,0,$7,$8,3)', ['mini-me', 'Mini Me', 'Published', 'Playful', preview, 'published', '["modern"]', '["sparkles"]']);
    await sql.query('INSERT INTO admin_experiences VALUES ($1,$2,$3,$4,NULL,$5,true,1,NULL,NULL,3)', ['unpublished', 'Private', 'Draft', 'Design', 'draft']);
    const styles = ['natural', 'modern', 'minimal', 'luxury', 'retro', 'film', 'cute', 'editorial', 'futuristic', 'artistic'];
    for (const [index, id] of styles.entries()) await sql.query('INSERT INTO advanced_frame_styles VALUES ($1::text,$1::text,$1::text,$1::text,true,$2)', [id, index]);
    await sql.query("INSERT INTO advanced_frame_styles VALUES ('disabled','disabled','Disabled','Disabled',false,11)");
    await sql.query("INSERT INTO advanced_ornaments VALUES ('sparkles','sparkles','Sparkles','Sparkles',true,0)");
    const catalog = new CustomerCatalogService(new CustomerCatalogModel(db), new CatalogAssetsService([assetsRoot], assetsRoot));
    const app = createMigrationApp(catalog, { corsOrigins: [] });
    const templates = (await request(app).get('/api/templates').expect(200)).body;
    assert.equal(templates.count, 1); assert.equal(templates.templates[0].id, template);
    assert.deepEqual([templates.templates[0].width, templates.templates[0].height], [1024, 1536]);
    assert.equal(templates.templates[0].basic_available, true);
    await request(app).get(templates.templates[0].preview_url).expect(200);
    const experiences = (await request(app).get('/api/experiences').expect(200)).body;
    assert.equal(experiences.count, 1); assert.equal(experiences.experiences[0].id, 'mini-me');
    assert.equal(experiences.experiences[0].enabled, true);
    assert.deepEqual(experiences.experiences[0].compatible_ornament_ids, ['sparkles']);
    const layouts = (await request(app).get('/api/classic/layouts').expect(200)).body;
    assert.equal(layouts.length, 35);
    for (const item of layouts) {
      assert.deepEqual([item.canvas_width, item.canvas_height], [1200, 3600]);
      assert.equal(item.shot_count, item.slots.length);
      const expected = [...original, ...event].find(row => row.id === item.id);
      assert.deepEqual(item.slots, expected.slots);
    }
    await request(app).get(layouts[0].preview_url).expect(200);
    assert.deepEqual((await request(app).get('/api/advanced/frame-styles').expect(200)).body.map((row: { id: string }) => row.id), styles);
    assert.equal((await request(app).get('/api/advanced/ornaments').expect(200)).body[0].id, 'sparkles');
    await request(app).get('/api/experiences/unpublished/thumbnail').expect(404);
  } finally {
    await db.$disconnect();
    await sql.query('DROP TABLE IF EXISTS admin_templates, admin_experiences, classic_layouts, advanced_frame_styles, advanced_ornaments');
    await sql.end();
  }
});
