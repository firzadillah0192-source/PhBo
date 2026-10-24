-- Forward-only additive migration. Apply manually after backup and owner approval.
-- Sandbox payments NEVER alter credit_wallets, accounts quota, or credit_ledger.
CREATE TABLE IF NOT EXISTS payment_transactions (
  id varchar(32) PRIMARY KEY,
  account_id varchar(32) NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  request_key varchar(128) NOT NULL,
  merchant_order_id varchar(50) NOT NULL UNIQUE,
  environment varchar(16) NOT NULL DEFAULT 'sandbox' CHECK (environment = 'sandbox'),
  credits integer NOT NULL CHECK (credits BETWEEN 1 AND 100000),
  amount_rupiah integer NOT NULL CHECK (amount_rupiah = credits * 100),
  status varchar(16) NOT NULL DEFAULT 'CREATING' CHECK (status IN ('CREATING','PENDING','PAID','FAILED','EXPIRED')),
  reference varchar(128) UNIQUE,
  checkout_url text,
  error_code varchar(64),
  invoice_lease_until timestamptz,
  verification_lease_until timestamptz,
  last_checked_at timestamptz,
  callback_received_at timestamptz,
  sandbox_credited_at timestamptz,
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, request_key),
  CHECK ((status = 'PAID') = (sandbox_credited_at IS NOT NULL)),
  CHECK ((status = 'PAID') = (paid_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_payment_transactions_account_created ON payment_transactions(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_payment_transactions_status_created ON payment_transactions(status, created_at DESC);
