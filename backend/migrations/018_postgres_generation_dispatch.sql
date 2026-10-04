-- PostgreSQL dispatch for the existing customer and preview jobs.
-- Durable job state, worker leases, Results and credit ledger remain unchanged.
CREATE TABLE IF NOT EXISTS generation_dispatch (
  queue_kind VARCHAR(16) NOT NULL CHECK (queue_kind IN ('customer','preview')),
  job_id VARCHAR(32) NOT NULL CHECK (job_id ~ '^[a-f0-9]{32}$'),
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (queue_kind,job_id)
);
CREATE INDEX IF NOT EXISTS ix_generation_dispatch_order ON generation_dispatch(queue_kind,enqueued_at,job_id);
