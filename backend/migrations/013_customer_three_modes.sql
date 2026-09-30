-- Customer-only three-mode rollout on the existing 001-009 schema.
-- This supersedes the customer portions of unshipped 011/012; do not apply
-- 010 telemetry or 011 Kiosk as prerequisites for this rollout.
-- Run transactionally with psql --single-transaction -v ON_ERROR_STOP=1.
CREATE TABLE IF NOT EXISTS classic_layouts (
    id VARCHAR(32) PRIMARY KEY,
    slug VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    canvas_width INTEGER NOT NULL CHECK (canvas_width > 0),
    canvas_height INTEGER NOT NULL CHECK (canvas_height > 0),
    shot_count INTEGER NOT NULL CHECK (shot_count > 0),
    layout_config_json TEXT NOT NULL,
    frame_asset_path VARCHAR(512),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE classic_layouts ADD COLUMN IF NOT EXISTS frame_asset_path VARCHAR(512);
ALTER TABLE classic_layouts ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE classic_layouts SET active = FALSE WHERE slug = 'strip-4-vertical';

ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS layout_id VARCHAR(32);
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS capture_upload_ids_json TEXT;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS frame_style_id VARCHAR(128);
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS ornament_ids_json TEXT;
CREATE INDEX IF NOT EXISTS ix_generation_jobs_layout_id ON generation_jobs(layout_id);
CREATE INDEX IF NOT EXISTS ix_generation_jobs_frame_style_id ON generation_jobs(frame_style_id);

ALTER TABLE admin_experiences ADD COLUMN IF NOT EXISTS compatible_frame_style_ids_json TEXT;
ALTER TABLE admin_experiences ADD COLUMN IF NOT EXISTS compatible_ornament_ids_json TEXT;
ALTER TABLE admin_experiences ADD COLUMN IF NOT EXISTS max_ornaments INTEGER NOT NULL DEFAULT 3;

CREATE TABLE IF NOT EXISTS advanced_frame_styles (
    id VARCHAR(128) PRIMARY KEY,
    slug VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    prompt_fragment TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS advanced_ornaments (
    id VARCHAR(128) PRIMARY KEY,
    slug VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    prompt_fragment TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0
);
