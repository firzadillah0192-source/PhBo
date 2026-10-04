-- Additive retry protection for the existing jobs and credit ledger.
-- Validate on a disposable database before any production application.
CREATE TABLE IF NOT EXISTS generation_requests (
  owner_scope VARCHAR(96) NOT NULL,
  request_key VARCHAR(128) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  job_id VARCHAR(32) NOT NULL REFERENCES generation_jobs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_scope, request_key)
);
CREATE INDEX IF NOT EXISTS ix_generation_requests_job ON generation_requests(job_id);
