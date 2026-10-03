-- Stop API/worker processes before applying this business-rule migration.
-- Keep old ORIGINAL rows for history; rename existing frame jobs in place.
ALTER TYPE "GenerationMode" RENAME VALUE 'FRAME' TO 'CLASSIC';
ALTER TYPE "GenerationMode" ADD VALUE 'BASIC';
ALTER TYPE "GenerationMode" ADD VALUE 'ADVANCED';

-- Previous usage was entirely local rendering, so it does not consume AI quota.
UPDATE "PhotoSession" SET "generationUsed" = 0, "generationLimit" = 3;
