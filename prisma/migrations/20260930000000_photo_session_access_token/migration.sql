ALTER TABLE "PhotoSession" ADD COLUMN "accessTokenHash" TEXT;
CREATE UNIQUE INDEX "PhotoSession_accessTokenHash_key" ON "PhotoSession"("accessTokenHash");
