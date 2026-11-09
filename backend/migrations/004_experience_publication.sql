-- Explicit customer publication lifecycle for Admin-managed experiences.
-- Existing rows default to draft; no seeded experience is auto-published.
ALTER TABLE admin_experiences ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'draft';
ALTER TABLE admin_experiences ADD COLUMN IF NOT EXISTS category VARCHAR(64) NOT NULL DEFAULT 'Design';
