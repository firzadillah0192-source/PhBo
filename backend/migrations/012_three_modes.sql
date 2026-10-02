-- Three-mode product extension. Apply after 011_kiosk_events_classic.sql.
-- Existing result, claim, upload, experience and account tables are reused.
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
