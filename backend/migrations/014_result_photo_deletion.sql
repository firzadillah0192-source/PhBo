-- Keep accounting metadata while removing generated photo bytes.
ALTER TABLE results ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
