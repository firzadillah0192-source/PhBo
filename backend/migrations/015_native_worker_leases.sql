-- Additive Express worker coordination only. Existing jobs/results/credits keep
-- their IDs and tables. Apply only after isolated validation and operator cutover.
CREATE TABLE IF NOT EXISTS generation_worker_leases (
  queue_kind VARCHAR(16) NOT NULL,
  job_id VARCHAR(32) NOT NULL,
  owner_token VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (queue_kind, job_id),
  CONSTRAINT worker_queue_kind CHECK (queue_kind IN ('customer', 'preview'))
);
CREATE INDEX IF NOT EXISTS ix_worker_leases_expiry ON generation_worker_leases(expires_at);
