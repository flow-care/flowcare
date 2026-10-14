-- AlterTable
ALTER TABLE "TranscriptionJob" ADD COLUMN "durationSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "finishedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TranscriptionJob_organizationId_finishedAt_idx" ON "TranscriptionJob"("organizationId", "finishedAt");
