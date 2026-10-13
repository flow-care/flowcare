-- CreateEnum
CREATE TYPE "ConsultationStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AnamnesisStatus" AS ENUM ('PENDING', 'DRAFT', 'APPROVED');

-- CreateTable
CREATE TABLE "Consultation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "appointmentId" UUID,
    "patientId" UUID NOT NULL,
    "professionalId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "status" "ConsultationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "anamnesisStatus" "AnamnesisStatus" NOT NULL DEFAULT 'PENDING',
    "anamnesisTopicRevisionId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_appointmentId_key" ON "Consultation"("appointmentId");

-- CreateIndex
CREATE INDEX "Consultation_organizationId_scheduledAt_id_idx" ON "Consultation"("organizationId", "scheduledAt", "id");

-- CreateIndex
CREATE INDEX "Consultation_organizationId_professionalId_scheduledAt_idx" ON "Consultation"("organizationId", "professionalId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Consultation_organizationId_patientId_scheduledAt_idx" ON "Consultation"("organizationId", "patientId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Consultation_organizationId_status_scheduledAt_idx" ON "Consultation"("organizationId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Consultation_organizationId_anamnesisStatus_scheduledAt_idx" ON "Consultation"("organizationId", "anamnesisStatus", "scheduledAt");

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_anamnesisTopicRevisionId_fkey" FOREIGN KEY ("anamnesisTopicRevisionId") REFERENCES "AnamnesisTopicRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
