-- Preserve existing UUID keys while allowing complete MinIO keys for new uploads.
ALTER TABLE "Frame" ALTER COLUMN "objectId" TYPE TEXT USING "objectId"::text;
ALTER TABLE "Photo" ALTER COLUMN "objectId" TYPE TEXT USING "objectId"::text;
ALTER TABLE "Generation" ALTER COLUMN "objectId" TYPE TEXT USING "objectId"::text;
