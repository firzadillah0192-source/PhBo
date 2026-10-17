-- AI Provider Lab (admin-only experimentation). Additive and isolated: one new table, no foreign keys to
-- customer, credit, generation or provider-run tables. Not applied automatically; see docs/MIGRATIONS.md.
-- Collections: provider, model, run, settings, session, candidate. Provider credentials are stored AES-256-GCM
-- encrypted inside the document (key: LAB_ENCRYPTION_KEY), never in plaintext.
CREATE TABLE IF NOT EXISTS lab_docs (
  collection varchar(32) NOT NULL CHECK (collection IN ('provider','model','run','settings','session','candidate')),
  id varchar(64) NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX IF NOT EXISTS ix_lab_docs_collection_created ON lab_docs (collection, created_at DESC);
