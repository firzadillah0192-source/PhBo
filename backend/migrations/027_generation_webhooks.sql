-- Additive only. Apply manually after reviewed backup and explicit owner approval.
BEGIN;
CREATE TABLE IF NOT EXISTS integration_webhook_endpoints (
 id varchar(32) PRIMARY KEY, account_id varchar(32) NOT NULL REFERENCES accounts(id),
 key_id varchar(16) NOT NULL UNIQUE REFERENCES integration_api_keys(id),
 url varchar(2048) NOT NULL, enabled boolean NOT NULL DEFAULT false,
 events text[] NOT NULL, encrypted_secret text NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS integration_webhook_deliveries (
 id varchar(32) PRIMARY KEY, endpoint_id varchar(32) NOT NULL REFERENCES integration_webhook_endpoints(id),
 account_id varchar(32) NOT NULL REFERENCES accounts(id), key_id varchar(16) NOT NULL REFERENCES integration_api_keys(id),
 job_id varchar(32) NOT NULL REFERENCES generation_jobs(id), event_type text NOT NULL CHECK(event_type IN ('generation.completed','generation.failed')),
 endpoint_version integer NOT NULL, target_url varchar(2048) NOT NULL, payload text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','IN_FLIGHT','DELIVERED','EXHAUSTED','CANCELLED')),
 attempt_count integer NOT NULL DEFAULT 0, cycle_attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_token varchar(32), lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(job_id,event_type,endpoint_id)
);
CREATE INDEX IF NOT EXISTS integration_webhook_due ON integration_webhook_deliveries(next_attempt_at) WHERE state IN ('PENDING','IN_FLIGHT');
CREATE INDEX IF NOT EXISTS integration_webhook_history ON integration_webhook_deliveries(account_id,key_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS integration_webhook_attempts (
 id varchar(32) PRIMARY KEY, delivery_id varchar(32) NOT NULL REFERENCES integration_webhook_deliveries(id) ON DELETE CASCADE,
 attempt_number integer NOT NULL, http_status integer, error_code varchar(40), duration_ms integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(delivery_id,attempt_number)
);
COMMIT;
