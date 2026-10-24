-- Draft only. Apply manually with explicit owner approval after verified backup.
-- Requires subscription v2 (024). No changes to existing modes or balances.
BEGIN;
CREATE TABLE IF NOT EXISTS nxduet_templates (
 id varchar(32) PRIMARY KEY,
 account_id varchar(32) NOT NULL REFERENCES accounts(id),
 request_key varchar(100) NOT NULL,
 fingerprint varchar(64) NOT NULL,
 name varchar(80) NOT NULL,
 state varchar(16) NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','PROCESSING','COMPLETED','FAILED')),
 enabled boolean NOT NULL DEFAULT true,
 source_path text NOT NULL,
 overlay_path text,
 model text NOT NULL,
 source_bytes integer NOT NULL CHECK(source_bytes>=0),
 size_bytes integer NOT NULL DEFAULT 0 CHECK(size_bytes>=0),
 width integer,
 height integer,
 placement jsonb NOT NULL DEFAULT '{"side":"right","scale":0.9}',
 credits integer NOT NULL DEFAULT 100 CHECK(credits=100),
 charge_status varchar(16) NOT NULL DEFAULT 'RESERVED' CHECK(charge_status IN ('RESERVED','CONSUMED','REFUNDED')),
 monthly_part integer NOT NULL CHECK(monthly_part>=0),
 top_up_part integer NOT NULL CHECK(top_up_part>=0),
 period_start timestamptz NOT NULL,
 rights_accepted_at timestamptz NOT NULL DEFAULT now(),
 lease_token varchar(32),
 lease_until timestamptz,
 error_code varchar(64),
 provider_meta jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 UNIQUE(account_id,request_key),
 CHECK(monthly_part+top_up_part=credits),
 CHECK(state<>'COMPLETED' OR deleted_at IS NOT NULL OR (overlay_path IS NOT NULL AND width>0 AND height>0 AND size_bytes>0 AND charge_status='CONSUMED'))
);
CREATE INDEX IF NOT EXISTS nxduet_templates_owner ON nxduet_templates(account_id,created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS nxduet_templates_work ON nxduet_templates(state,lease_until,created_at);
COMMIT;
