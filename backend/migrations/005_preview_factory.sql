-- Admin-owned marketing preview factory. No customer quota or generation job
-- is involved in this workflow.
ALTER TABLE admin_experiences ADD COLUMN IF NOT EXISTS preview_status VARCHAR(16) NOT NULL DEFAULT 'MISSING';
ALTER TABLE admin_experiences ADD COLUMN IF NOT EXISTS preview_error TEXT;
UPDATE admin_experiences SET preview_status = 'READY' WHERE thumbnail_path IS NOT NULL AND preview_status = 'MISSING';

CREATE TABLE IF NOT EXISTS preview_sources (
  id VARCHAR(128) PRIMARY KEY,
  source_type VARCHAR(32) NOT NULL DEFAULT 'portrait',
  storage_path VARCHAR(512),
  content_type VARCHAR(64),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by VARCHAR(128) NOT NULL DEFAULT 'admin'
);

CREATE TABLE IF NOT EXISTS preview_generation_jobs (
  id VARCHAR(32) PRIMARY KEY,
  experience_id VARCHAR(128) NOT NULL,
  source_id VARCHAR(128) NOT NULL,
  purpose VARCHAR(64) NOT NULL DEFAULT 'admin_preview_generation',
  state VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
  provider VARCHAR(64),
  model VARCHAR(128),
  output_path VARCHAR(512),
  error_message TEXT,
  requested_by VARCHAR(128) NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_preview_generation_jobs_experience_id ON preview_generation_jobs(experience_id);
CREATE INDEX IF NOT EXISTS ix_preview_generation_jobs_state ON preview_generation_jobs(state);
