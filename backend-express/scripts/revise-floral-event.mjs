// Run via stdin from /app in the deployed API. Assets and audit files live under /srv/photobooth.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'minio';
import { readFile, writeFile } from 'node:fs/promises';
import { migrationConfigSchema } from './dist/config/migration-env.js';
import { NativeObjectStorage } from './dist/services/native-object-storage.service.js';
import { CatalogAssetsService } from './dist/services/catalog-assets.service.js';

const config = migrationConfigSchema.parse(process.env);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
const directory = process.env.FLORAL_RELEASE_DIR;
const action = process.env.FLORAL_ACTION;
const id = 'classic-floral-event-001';
if (!directory?.startsWith('/srv/photobooth/releases/floral-frame-') || !['snapshot', 'publish', 'rollback'].includes(action)) throw Error('Explicit managed release directory/action required');
const keys = ['frame_asset_path', 'layout_config_json', 'canvas_width', 'canvas_height', 'shot_count'];
const fields = row => Object.fromEntries(keys.map(key => [key, row[key]]));
try {
  const existing = await db.nxClassicLayout.findUniqueOrThrow({ where: { id } });
  if (action === 'snapshot') {
    await writeFile(directory + '/before.json', JSON.stringify(existing, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'PASS', snapshot: true, id }));
  } else {
    const before = JSON.parse(await readFile(directory + '/before.json', 'utf8'));
    let expected = before;
    let replacement;
    if (action === 'rollback') {
      expected = JSON.parse(await readFile(directory + '/after.json', 'utf8'));
      replacement = fields(before);
    } else {
      if (JSON.stringify(fields(existing)) !== JSON.stringify(fields(before))) throw Error('Catalog changed since snapshot');
      const data = JSON.parse(await readFile(directory + '/assets/layout.json', 'utf8'));
      if (data.id !== id || data.canvas_width !== 1200 || data.canvas_height !== 3600 || data.shot_count !== 3) throw Error('Unexpected template contract');
      const revision = directory.split('/').at(-1);
      const objects = new NativeObjectStorage(new Client({ endPoint: config.MINIO_ENDPOINT, port: config.MINIO_PORT, useSSL: config.MINIO_USE_SSL, accessKey: config.MINIO_ACCESS_KEY, secretKey: config.MINIO_SECRET_KEY, region: config.MINIO_REGION }), config.MINIO_BUCKET);
      const service = new CatalogAssetsService([config.RUNTIME_DIR, config.TEMPLATES_DIR, directory], config.TEMPLATES_DIR, objects);
      replacement = { frame_asset_path: objects.catalogReference(`${id}/${revision}/blank.png`), layout_config_json: JSON.stringify({ slots: data.slots, theme_slug: 'personalized-events', theme_name: 'Event Kamu' }), canvas_width: 1200, canvas_height: 3600, shot_count: 3 };
      // Validate local files before uploading; never overwrite the previous objects.
      await service.validateLayout({ ...existing, ...replacement, frame_asset_path: directory + '/assets/blank.png' });
      await objects.put(replacement.frame_asset_path, await readFile(directory + '/assets/blank.png'), 'image/png');
      await objects.put(replacement.frame_asset_path.replace('/blank.png', '/previews/blank.png'), await readFile(directory + '/assets/preview.png'), 'image/png');
      await service.validateLayout({ ...existing, ...replacement });
    }
    const after = await db.$transaction(async tx => {
      const changed = await tx.nxClassicLayout.updateMany({ where: { id, ...fields(expected) }, data: replacement });
      if (changed.count !== 1) throw Error('Catalog changed concurrently; no row replaced');
      return tx.nxClassicLayout.findUniqueOrThrow({ where: { id } });
    });
    await writeFile(directory + (action === 'publish' ? '/after.json' : '/rollback.json'), JSON.stringify(after, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ status: 'PASS', action, id, frame: after.frame_asset_path, slots: JSON.parse(after.layout_config_json).slots }));
  }
} finally { await db.$disconnect(); }
