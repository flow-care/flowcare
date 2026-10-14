-- CreateEnum
CREATE TYPE "TranscriptionJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "TranscriptionJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "consultationId" UUID NOT NULL,
    "audioId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "status" "TranscriptionJobStatus" NOT NULL DEFAULT 'PROCESSING',
    "errorReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "providerJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptionJob_organizationId_idempotencyKey_key" ON "TranscriptionJob"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "TranscriptionJob_organizationId_consultationId_createdAt_idx" ON "TranscriptionJob"("organizationId", "consultationId", "createdAt");

-- CreateIndex
CREATE INDEX "TranscriptionJob_organizationId_status_idx" ON "TranscriptionJob"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "TranscriptionJob" ADD CONSTRAINT "TranscriptionJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptionJob" ADD CONSTRAINT "TranscriptionJob_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptionJob" ADD CONSTRAINT "TranscriptionJob_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "ConsultationAudio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
