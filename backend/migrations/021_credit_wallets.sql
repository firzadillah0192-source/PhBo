-- Additive wallet tables. Existing account quota fields remain compatibility counters.
CREATE TABLE IF NOT EXISTS credit_wallets (
  account_id varchar(32) PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  free_remaining integer NOT NULL DEFAULT 50 CHECK (free_remaining >= 0 AND free_remaining <= 50),
  top_up_remaining integer NOT NULL DEFAULT 0 CHECK (top_up_remaining >= 0),
  cycle_started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS credit_wallet_reservations (
  job_id varchar(32) PRIMARY KEY REFERENCES quota_reservations(job_id) ON DELETE CASCADE,
  account_id varchar(32) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  free_amount integer NOT NULL CHECK (free_amount >= 0),
  top_up_amount integer NOT NULL CHECK (top_up_amount >= 0),
  cycle_started_at timestamptz NOT NULL,
  CHECK (free_amount + top_up_amount > 0)
);
CREATE INDEX IF NOT EXISTS ix_credit_wallet_reservations_account ON credit_wallet_reservations(account_id);
CREATE TABLE IF NOT EXISTS generation_credit_charges (
  job_id varchar(32) PRIMARY KEY REFERENCES generation_jobs(id) ON DELETE CASCADE,
  status varchar(32) NOT NULL CHECK (status IN ('PENDING_RESULT','PENDING_USAGE','NEEDS_TOP_UP','PAID','REFUNDED')),
  credits integer CHECK (credits >= 0),
  calculation_json text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
