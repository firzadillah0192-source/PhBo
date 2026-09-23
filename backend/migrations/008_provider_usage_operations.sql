-- Additive provider execution telemetry for Admin-only operations visibility.
-- Values remain NULL when 9Router does not expose them.
CREATE TABLE IF NOT EXISTS generation_provider_runs (
  id VARCHAR(32) PRIMARY KEY,
  generation_job_id VARCHAR(32) NOT NULL REFERENCES generation_jobs(id),
  account_id VARCHAR(32) REFERENCES accounts(id),
  provider_name VARCHAR(64) NOT NULL,
  provider_model VARCHAR(128),
  provider_request_id VARCHAR(255),
  provider_account_label VARCHAR(255),
  provider_account_id VARCHAR(255),
  provider_strategy_hint VARCHAR(255),
  provider_usage_raw_json TEXT,
  input_text_tokens INTEGER,
  input_image_tokens INTEGER,
  output_image_tokens INTEGER,
  total_tokens INTEGER,
  billable_units INTEGER,
  upstream_status VARCHAR(32) NOT NULL,
  upstream_error_code VARCHAR(128),
  upstream_error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  request_started_at TIMESTAMPTZ NOT NULL,
  request_completed_at TIMESTAMPTZ,
  total_duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_generation_provider_runs_generation_job_id ON generation_provider_runs(generation_job_id);
CREATE INDEX IF NOT EXISTS ix_generation_provider_runs_account_id ON generation_provider_runs(account_id);
CREATE INDEX IF NOT EXISTS ix_generation_provider_runs_created_at ON generation_provider_runs(created_at);
CREATE INDEX IF NOT EXISTS ix_generation_provider_runs_upstream_status ON generation_provider_runs(upstream_status);
CREATE INDEX IF NOT EXISTS ix_generation_provider_runs_provider_name ON generation_provider_runs(provider_name);
CREATE INDEX IF NOT EXISTS ix_generation_provider_runs_provider_model ON generation_provider_runs(provider_model);
