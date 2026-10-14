CREATE TYPE "ConsultationAudioStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED');
CREATE TYPE "AudioProcessingStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "ConsultationAudio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "consultationId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "stagingObjectKey" TEXT,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "ConsultationAudioStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "consentConfirmedAt" TIMESTAMP(3) NOT NULL,
    "uploadExpiresAt" TIMESTAMP(3),
    "objectDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConsultationAudio_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudioProcessing" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "audioId" UUID NOT NULL,
    "status" "AudioProcessingStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AudioProcessing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConsultationAudio_objectKey_key" ON "ConsultationAudio"("objectKey");
CREATE INDEX "ConsultationAudio_organizationId_consultationId_idx" ON "ConsultationAudio"("organizationId", "consultationId");
CREATE INDEX "ConsultationAudio_status_uploadExpiresAt_idx" ON "ConsultationAudio"("status", "uploadExpiresAt");
CREATE UNIQUE INDEX "AudioProcessing_audioId_key" ON "AudioProcessing"("audioId");

ALTER TABLE "ConsultationAudio" ADD CONSTRAINT "ConsultationAudio_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultationAudio" ADD CONSTRAINT "ConsultationAudio_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultationAudio" ADD CONSTRAINT "ConsultationAudio_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AudioProcessing" ADD CONSTRAINT "AudioProcessing_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "ConsultationAudio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
