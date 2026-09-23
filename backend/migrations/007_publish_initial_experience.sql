-- Bootstrap one approved Advanced experience for a fresh customer catalog.
--
-- The publication lifecycle keeps seeded rows as drafts by default.  A
-- completely empty public catalog, however, makes the Advanced customer
-- flow unusable on first install.  Publish only the untouched starter row,
-- and only when no other experience has already been published.  The
-- updated_by guard preserves any explicit Admin decision on mini-me.
UPDATE admin_experiences AS starter
SET status = 'published',
    updated_by = 'bootstrap',
    updated_at = CURRENT_TIMESTAMP
WHERE starter.id = 'mini-me'
  AND starter.status = 'draft'
  AND starter.enabled IS TRUE
  AND starter.updated_by = 'seed'
  AND NOT EXISTS (
      SELECT 1
      FROM admin_experiences AS published
      WHERE published.status = 'published'
  );
