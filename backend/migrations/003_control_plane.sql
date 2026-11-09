-- Forward-only Admin control plane foundation.
-- Existing accounts/jobs/registry rows are preserved.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(1024);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'active';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS ix_accounts_status ON accounts(status);
CREATE TABLE IF NOT EXISTS admin_users (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(320),
  role VARCHAR(32) NOT NULL DEFAULT 'operator',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS admin_user_id VARCHAR(64) REFERENCES admin_users(id);
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS admin_role VARCHAR(32);
CREATE INDEX IF NOT EXISTS ix_auth_sessions_admin_user_id ON auth_sessions(admin_user_id);

CREATE TABLE IF NOT EXISTS auth_identities (
  id VARCHAR(32) PRIMARY KEY,
  account_id VARCHAR(32) NOT NULL REFERENCES accounts(id),
  provider VARCHAR(32) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  email VARCHAR(320),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  CONSTRAINT uq_auth_identity_provider_subject UNIQUE(provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS ix_auth_identities_account_id ON auth_identities(account_id);
CREATE INDEX IF NOT EXISTS ix_auth_identities_provider ON auth_identities(provider);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) REFERENCES accounts(id),
  guest_id VARCHAR(64) REFERENCES guest_sessions(id),
  amount INTEGER NOT NULL,
  type VARCHAR(64) NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  related_generation_id VARCHAR(32) REFERENCES generation_jobs(id),
  admin_actor_id VARCHAR(64),
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  metadata_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_credit_ledger_user_id ON credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS ix_credit_ledger_guest_id ON credit_ledger(guest_id);
CREATE INDEX IF NOT EXISTS ix_credit_ledger_type ON credit_ledger(type);
CREATE INDEX IF NOT EXISTS ix_credit_ledger_created_at ON credit_ledger(created_at);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  monthly_ai_credits INTEGER NOT NULL DEFAULT 0,
  billing_period VARCHAR(32) NOT NULL DEFAULT 'month',
  price_amount INTEGER,
  currency VARCHAR(8),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_subscription_plans_is_active ON subscription_plans(is_active);

CREATE TABLE IF NOT EXISTS subscriptions (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL REFERENCES accounts(id),
  plan_id VARCHAR(64) NOT NULL REFERENCES subscription_plans(id),
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  external_customer_id VARCHAR(255),
  external_subscription_id VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS ix_subscriptions_plan_id ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS ix_subscriptions_status ON subscriptions(status);

CREATE TABLE IF NOT EXISTS generation_events (
  id VARCHAR(32) PRIMARY KEY,
  job_id VARCHAR(32) NOT NULL REFERENCES generation_jobs(id),
  event_type VARCHAR(64) NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  metadata_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_generation_events_job_id ON generation_events(job_id);
CREATE INDEX IF NOT EXISTS ix_generation_events_event_type ON generation_events(event_type);
CREATE INDEX IF NOT EXISTS ix_generation_events_created_at ON generation_events(created_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id VARCHAR(32) PRIMARY KEY,
  admin_actor_id VARCHAR(64) NOT NULL,
  action VARCHAR(96) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(128) NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_admin_audit_log_action ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS ix_admin_audit_log_target ON admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS ix_admin_audit_log_created_at ON admin_audit_log(created_at);

-- Baseline legacy account balances once. Future mutations are ledger-backed.
INSERT INTO credit_ledger (id, user_id, amount, type, reason, idempotency_key)
SELECT md5('legacy-balance:' || a.id), a.id,
       GREATEST(a.ai_quota_total - a.ai_quota_used - a.ai_quota_reserved, 0),
       'migration', 'Legacy account balance imported during control plane migration',
       'migration:legacy-balance:' || a.id
FROM accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM credit_ledger l WHERE l.idempotency_key = 'migration:legacy-balance:' || a.id
);
