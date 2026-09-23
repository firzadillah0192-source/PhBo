-- Secure, expiring public result delivery grants. The raw token is never stored.
CREATE TABLE IF NOT EXISTS result_claims (
    id VARCHAR(32) PRIMARY KEY,
    result_id VARCHAR(32) NOT NULL REFERENCES results(id),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    first_accessed_at TIMESTAMPTZ NULL,
    last_accessed_at TIMESTAMPTZ NULL,
    download_count INTEGER NOT NULL DEFAULT 0,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_session_id VARCHAR(128) NULL,
    created_by_kiosk_session_id VARCHAR(128) NULL,
    metadata_json TEXT NULL
);

CREATE INDEX IF NOT EXISTS ix_result_claims_result_id ON result_claims(result_id);
CREATE INDEX IF NOT EXISTS ix_result_claims_expires_at ON result_claims(expires_at);
CREATE INDEX IF NOT EXISTS ix_result_claims_is_revoked ON result_claims(is_revoked);
