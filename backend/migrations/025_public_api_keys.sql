-- Prepared only. Apply manually after explicit owner approval and verified backup.
-- Additive: integration API keys for the NXBooth Public API (docs/PUBLIC_API_PROPOSAL.md).
-- Only a keyed hash of each secret is stored; the secret is shown once at issue time.
BEGIN;
CREATE TABLE IF NOT EXISTS integration_api_keys (
  id varchar(16) PRIMARY KEY,
  account_id varchar(32) NOT NULL REFERENCES accounts(id),
  name varchar(80) NOT NULL,
  prefix varchar(32) NOT NULL,
  secret_hash varchar(64) NOT NULL,
  scopes text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  rotated_from varchar(16) REFERENCES integration_api_keys(id),
  CHECK (cardinality(scopes) > 0),
  CHECK (scopes <@ ARRAY['catalog:read','inputs:write','generations:create','generations:read','results:read','usage:read']::text[])
);
CREATE INDEX IF NOT EXISTS integration_api_keys_account ON integration_api_keys(account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS integration_api_key_usage (
  key_id varchar(16) NOT NULL REFERENCES integration_api_keys(id),
  day date NOT NULL,
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  generations integer NOT NULL DEFAULT 0 CHECK (generations >= 0),
  PRIMARY KEY (key_id, day)
);
COMMIT;
