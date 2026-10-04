-- Freeze job configuration at submission and bound expired-lease recovery.
-- Existing jobs retain NULL snapshots and use the legacy registry fallback.
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS engine_config_json TEXT;
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS worker_attempts INTEGER NOT NULL DEFAULT 0;
