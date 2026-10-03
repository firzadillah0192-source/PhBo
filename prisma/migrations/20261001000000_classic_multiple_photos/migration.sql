DROP INDEX "Photo_sessionId_key";
ALTER TABLE "Photo" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "Photo_sessionId_position_key" ON "Photo"("sessionId", "position");
ALTER TABLE "Generation" ADD COLUMN "photoIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
