import type pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export async function extendCatalogFixture(sql: pg.Client) {
  await sql.query(`
    ALTER TABLE admin_templates ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_by varchar(128) NOT NULL DEFAULT 'test';
    ALTER TABLE admin_experiences ADD COLUMN internal_prompt text NOT NULL DEFAULT 'Test experience authority', ADD COLUMN provider varchar(64) NOT NULL DEFAULT '9router', ADD COLUMN model varchar(128) NOT NULL DEFAULT 'test-model', ADD COLUMN reference_mode varchar(64) NOT NULL DEFAULT 'SINGLE_USER_IMAGE', ADD COLUMN output_format varchar(16) NOT NULL DEFAULT 'PNG', ADD COLUMN preview_status varchar(16) NOT NULL DEFAULT 'MISSING', ADD COLUMN preview_error text, ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_by varchar(128) NOT NULL DEFAULT 'test';
    ALTER TABLE classic_layouts ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE advanced_frame_styles ADD COLUMN prompt_fragment text NOT NULL DEFAULT 'Test frame direction';
    ALTER TABLE advanced_ornaments ADD COLUMN prompt_fragment text NOT NULL DEFAULT '';
  `);
}
export async function extendApplicationFixture(sql: pg.Client) {
  const root = fileURLToPath(new URL('../../backend/migrations/', import.meta.url));
  for (const file of ['003_control_plane.sql', '005_preview_factory.sql', '008_provider_usage_operations.sql', '010_provider_router_telemetry.sql', '015_native_worker_leases.sql']) {
    await sql.query(await readFile(join(root, file), 'utf8'));
  }
}
