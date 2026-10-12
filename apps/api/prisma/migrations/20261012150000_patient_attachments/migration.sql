-- CreateTable
CREATE TABLE "PatientAttachment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "uploadedById" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "archivedById" UUID,
    "archiveReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientAttachment_objectKey_key" ON "PatientAttachment"("objectKey");

-- CreateIndex
CREATE INDEX "PatientAttachment_organizationId_patientId_createdAt_idx" ON "PatientAttachment"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientAttachment_organizationId_patientId_archivedAt_idx" ON "PatientAttachment"("organizationId", "patientId", "archivedAt");

-- AddForeignKey
ALTER TABLE "PatientAttachment" ADD CONSTRAINT "PatientAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAttachment" ADD CONSTRAINT "PatientAttachment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAttachment" ADD CONSTRAINT "PatientAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAttachment" ADD CONSTRAINT "PatientAttachment_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
