-- Prepared only. Apply manually after explicit owner approval and verified backup.
-- Preserves legacy wallets, prices, subscriptions, payments and existing results.
BEGIN;
CREATE TABLE IF NOT EXISTS subscription_v2_wallets (
  owner_scope varchar(80) PRIMARY KEY,
  account_id varchar(32) REFERENCES accounts(id),
  guest_id varchar(64) REFERENCES guest_sessions(id),
  plan_code varchar(16) NOT NULL DEFAULT 'free' CHECK (plan_code IN ('free','starter','plus','pro','max')),
  subscription_id varchar(32) REFERENCES subscriptions(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  ai_monthly integer NOT NULL DEFAULT 0 CHECK (ai_monthly>=0),
  ai_top_up integer NOT NULL DEFAULT 0 CHECK (ai_top_up>=0),
  classic_monthly integer NOT NULL DEFAULT 500 CHECK (classic_monthly>=0),
  classic_top_up integer NOT NULL DEFAULT 0 CHECK (classic_top_up>=0),
  legacy_converted integer NOT NULL DEFAULT 0 CHECK (legacy_converted>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((account_id IS NOT NULL)::integer + (guest_id IS NOT NULL)::integer = 1),
  CHECK (period_end>period_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_v2_account ON subscription_v2_wallets(account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_v2_guest ON subscription_v2_wallets(guest_id) WHERE guest_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS subscription_v2_ledger (
  id bigserial PRIMARY KEY,
  owner_scope varchar(80) NOT NULL REFERENCES subscription_v2_wallets(owner_scope),
  currency varchar(8) NOT NULL CHECK (currency IN ('AI','CLASSIC')),
  amount integer NOT NULL,
  reason varchar(255) NOT NULL,
  idempotency_key varchar(255) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscription_v2_jobs (
  job_id varchar(32) PRIMARY KEY REFERENCES generation_jobs(id),
  owner_scope varchar(80) NOT NULL REFERENCES subscription_v2_wallets(owner_scope),
  lane varchar(16) NOT NULL CHECK (lane IN ('classic','standard','fast')),
  currency varchar(8) NOT NULL CHECK (currency IN ('AI','CLASSIC')),
  credits integer NOT NULL CHECK (credits>0),
  monthly_part integer NOT NULL CHECK (monthly_part>=0),
  top_up_part integer NOT NULL CHECK (top_up_part>=0),
  period_start timestamptz NOT NULL,
  day_wib date NOT NULL,
  retention_days integer NOT NULL CHECK (retention_days>0),
  storage_reserved bigint NOT NULL DEFAULT 26214400 CHECK (storage_reserved>=0),
  status varchar(16) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','CONSUMED','REFUNDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK (monthly_part+top_up_part=credits)
);
CREATE INDEX IF NOT EXISTS subscription_v2_jobs_owner_day ON subscription_v2_jobs(owner_scope,day_wib,status);
CREATE TABLE IF NOT EXISTS subscription_v2_results (
  result_id varchar(32) PRIMARY KEY REFERENCES results(id),
  owner_scope varchar(80) NOT NULL REFERENCES subscription_v2_wallets(owner_scope),
  expires_at timestamptz NOT NULL,
  retention_days integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscription_v2_results_expiry ON subscription_v2_results(expires_at);
CREATE TABLE IF NOT EXISTS generation_api_routes (
  lane varchar(16) PRIMARY KEY CHECK (lane IN ('standard','fast')),
  enabled boolean NOT NULL DEFAULT false,
  encrypted_key text,
  model varchar(128) NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Product snapshots keep historical Sandbox invoices at their original prices.
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS product_kind varchar(32);
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS product_code varchar(64);
ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS policy_version integer;
-- Replace the old fixed Rp100/credit constraint with explicit versioned rules.
-- All historical rows remain valid at their original amount; no invoice repricing.
ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_amount_rupiah_check;
-- PostgreSQL names the multi-column CHECK from migration 023 "..._check".
ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='payment_transactions'::regclass AND conname='payment_transactions_product_amount_check') THEN
    ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_product_amount_check CHECK (COALESCE(
      (policy_version IS NULL AND product_kind IS NULL AND product_code IS NULL AND amount_rupiah=credits*100)
      OR (policy_version=2 AND product_kind='ai_topup' AND product_code='ai' AND amount_rupiah=credits*10)
      OR (policy_version=2 AND product_kind='subscription' AND
        ((product_code='starter' AND amount_rupiah=25000 AND credits=2500)
        OR (product_code='plus' AND amount_rupiah=45000 AND credits=5000)
        OR (product_code='pro' AND amount_rupiah=69000 AND credits=8000)
        OR (product_code='max' AND amount_rupiah=99000 AND credits=12000))),false));
  END IF;
END $$;
-- Use separate versioned IDs: never overwrite a plan already assigned to a user.
INSERT INTO subscription_plans(id,code,name,description,monthly_ai_credits,billing_period,price_amount,currency,is_active)
VALUES
 ('nx-v2-starter','v2_starter','Starter','1.250 Classic Credit; 5 Classic/hari; 500 MB; 14 hari',2500,'month',25000,'IDR',true),
 ('nx-v2-plus','v2_plus','Plus','2.750 Classic Credit; 10 Classic/hari; 1 GB; 30 hari',5000,'month',45000,'IDR',true),
 ('nx-v2-pro','v2_pro','Pro','4.250 Classic Credit; 15 Classic/hari; 2 GB; 60 hari',8000,'month',69000,'IDR',true),
 ('nx-v2-max','v2_max','Max','6.250 Classic Credit; 20 Classic/hari; 4 GB; 90 hari',12000,'month',99000,'IDR',true)
ON CONFLICT(id) DO NOTHING;
COMMIT;
