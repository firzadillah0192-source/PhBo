-- Usage/auth metadata only. Image binaries remain in the existing filesystem.
CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(32) PRIMARY KEY,
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash VARCHAR(512) NOT NULL,
  ai_quota_total INTEGER NOT NULL DEFAULT 5,
  ai_quota_used INTEGER NOT NULL DEFAULT 0,
  ai_quota_reserved INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS guest_sessions (
  id VARCHAR(64) PRIMARY KEY,
  ai_quota_total INTEGER NOT NULL DEFAULT 2,
  ai_quota_used INTEGER NOT NULL DEFAULT 0,
  ai_quota_reserved INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id VARCHAR(64) PRIMARY KEY,
  account_id VARCHAR(32) REFERENCES accounts(id),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS quota_reservations (
  id VARCHAR(32) PRIMARY KEY,
  job_id VARCHAR(32) NOT NULL UNIQUE REFERENCES generation_jobs(id),
  account_id VARCHAR(32) REFERENCES accounts(id),
  guest_id VARCHAR(64) REFERENCES guest_sessions(id),
  amount INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'RESERVED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS account_id VARCHAR(32) REFERENCES accounts(id);
ALTER TABLE uploads ADD COLUMN IF NOT EXISTS guest_id VARCHAR(64) REFERENCES guest_sessions(id);
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS account_id VARCHAR(32) REFERENCES accounts(id);
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS guest_id VARCHAR(64) REFERENCES guest_sessions(id);
