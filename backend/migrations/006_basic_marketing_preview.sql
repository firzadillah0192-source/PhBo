-- Basic customer previews are separate from processing assets.
ALTER TABLE admin_templates
  ADD COLUMN IF NOT EXISTS marketing_preview_path VARCHAR(512);
