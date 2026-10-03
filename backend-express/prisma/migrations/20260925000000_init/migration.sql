-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "GenerationMode" AS ENUM ('ORIGINAL', 'FRAME');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Frame" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "objectId" UUID NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Frame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoSession" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "claimTokenHash" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "generationLimit" INTEGER NOT NULL,
    "generationUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "objectId" UUID NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sessionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "frameId" UUID,
    "mode" "GenerationMode" NOT NULL,
    "status" "GenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "objectId" UUID,
    "error" TEXT,
    "requestKey" VARCHAR(128) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Frame_objectId_key" ON "Frame"("objectId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoSession_code_key" ON "PhotoSession"("code");

-- CreateIndex
CREATE INDEX "PhotoSession_expiresAt_idx" ON "PhotoSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_code_key" ON "Photo"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_objectId_key" ON "Photo"("objectId");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_sessionId_key" ON "Photo"("sessionId");

-- CreateIndex
CREATE INDEX "Generation_status_createdAt_idx" ON "Generation"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Generation_sessionId_requestKey_key" ON "Generation"("sessionId", "requestKey");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PhotoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PhotoSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_frameId_fkey" FOREIGN KEY ("frameId") REFERENCES "Frame"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
