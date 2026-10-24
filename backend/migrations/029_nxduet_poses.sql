-- Draft only. Apply manually with explicit owner approval after verified backup.
-- Requires 028_nxduet.sql. Additive and idempotent: existing templates keep working
-- (a template without pose rows is a legacy single-pose template).
BEGIN;
ALTER TABLE nxduet_templates ADD COLUMN IF NOT EXISTS pose_keys jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS nxduet_template_poses (
 template_id varchar(32) NOT NULL REFERENCES nxduet_templates(id),
 slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 3),
 pose_key varchar(32) NOT NULL,
 overlay_path text NOT NULL,
 width integer NOT NULL CHECK(width>0),
 height integer NOT NULL CHECK(height>0),
 size_bytes integer NOT NULL CHECK(size_bytes>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(template_id,slot)
);
COMMIT;
