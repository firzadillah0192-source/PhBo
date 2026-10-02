-- Additive 9Router response telemetry. Apply after 008_provider_usage_operations.sql.
-- All values remain NULL when the router omits the corresponding header.
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS requested_model VARCHAR(128);
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS provider_reported_model VARCHAR(128);
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS router_request_id VARCHAR(255);
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS upstream_request_id VARCHAR(255);
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS routing_strategy VARCHAR(255);
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS usage_available BOOLEAN;
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS input_tokens INTEGER;
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS provider_reported_cost DOUBLE PRECISION;
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS attempt_count INTEGER;
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS failover_count INTEGER;
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS router_duration_ms INTEGER;
ALTER TABLE generation_provider_runs ADD COLUMN IF NOT EXISTS application_duration_ms INTEGER;

CREATE INDEX IF NOT EXISTS ix_generation_provider_runs_router_request_id
  ON generation_provider_runs(router_request_id);
CREATE INDEX IF NOT EXISTS ix_generation_provider_runs_requested_model
  ON generation_provider_runs(requested_model);
CREATE INDEX IF NOT EXISTS ix_generation_provider_runs_routing_strategy
  ON generation_provider_runs(routing_strategy);
