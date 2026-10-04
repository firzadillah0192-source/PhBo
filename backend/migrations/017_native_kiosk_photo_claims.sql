-- Add upstream Kiosk photo-claim metadata to existing sessions, uploads and jobs.
-- Eventless sessions are permitted, matching the upstream optional event field.
-- Some installations did not apply the earlier Kiosk migration 011. Reuse its
-- table names/contracts, but do not insert its historical Classic layout seed.
CREATE TABLE IF NOT EXISTS events (
  id VARCHAR(32) PRIMARY KEY,slug VARCHAR(128) NOT NULL UNIQUE,name VARCHAR(255) NOT NULL,
  description TEXT,status VARCHAR(16) NOT NULL DEFAULT 'draft',starts_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,
  logo_path VARCHAR(512),theme_config_json TEXT,
  classic_enabled BOOLEAN NOT NULL DEFAULT FALSE,basic_enabled BOOLEAN NOT NULL DEFAULT FALSE,advanced_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  classic_layout_id VARCHAR(32) REFERENCES classic_layouts(id) ON DELETE RESTRICT,classic_frame_path VARCHAR(512),
  classic_shot_count INTEGER NOT NULL DEFAULT 4 CHECK (classic_shot_count>0),
  qr_enabled BOOLEAN NOT NULL DEFAULT TRUE,print_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  result_timeout_seconds INTEGER NOT NULL DEFAULT 90 CHECK (result_timeout_seconds BETWEEN 15 AND 3600),
  claim_ttl_hours INTEGER NOT NULL DEFAULT 24 CHECK (claim_ttl_hours BETWEEN 1 AND 168),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS kiosk_sessions (
  id VARCHAR(64) PRIMARY KEY,event_id VARCHAR(32) REFERENCES events(id) ON DELETE RESTRICT,
  mode VARCHAR(16),status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),closed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS event_basic_templates (
  event_id VARCHAR(32) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  template_id VARCHAR(128) NOT NULL REFERENCES admin_templates(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,sort_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(event_id,template_id)
);
CREATE TABLE IF NOT EXISTS event_advanced_experiences (
  event_id VARCHAR(32) NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  experience_id VARCHAR(128) NOT NULL REFERENCES admin_experiences(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,sort_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(event_id,experience_id)
);
CREATE INDEX IF NOT EXISTS ix_events_status ON events(status);
CREATE INDEX IF NOT EXISTS ix_kiosk_sessions_event_status ON kiosk_sessions(event_id,status,last_activity_at);
ALTER TABLE kiosk_sessions ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE kiosk_sessions ADD COLUMN IF NOT EXISTS public_code VARCHAR(24);
ALTER TABLE kiosk_sessions ADD COLUMN IF NOT EXISTS claim_token_hash VARCHAR(64);
ALTER TABLE kiosk_sessions ADD COLUMN IF NOT EXISTS access_token_hash VARCHAR(64);
ALTER TABLE kiosk_sessions ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE kiosk_sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE kiosk_sessions ADD COLUMN IF NOT EXISTS guest_id VARCHAR(64) REFERENCES guest_sessions(id);
ALTER TABLE kiosk_sessions ADD COLUMN IF NOT EXISTS capture_upload_ids_json TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kiosk_public_code ON kiosk_sessions(public_code) WHERE public_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kiosk_access_token_hash ON kiosk_sessions(access_token_hash) WHERE access_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_kiosk_claim_expiry ON kiosk_sessions(expires_at) WHERE public_code IS NOT NULL;
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS kiosk_session_id VARCHAR(64) REFERENCES kiosk_sessions(id) ON DELETE SET NULL;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS event_id VARCHAR(32) REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS kiosk_session_id VARCHAR(64) REFERENCES kiosk_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_uploads_kiosk_session_id ON uploads(kiosk_session_id);
CREATE INDEX IF NOT EXISTS ix_generation_jobs_event_id ON generation_jobs(event_id);
CREATE INDEX IF NOT EXISTS ix_generation_jobs_kiosk_session_id ON generation_jobs(kiosk_session_id);
