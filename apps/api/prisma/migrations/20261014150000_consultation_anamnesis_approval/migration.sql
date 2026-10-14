-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvedById" UUID,
ADD COLUMN "signedBy" TEXT,
ADD COLUMN "anamnesisSnapshot" JSONB,
ADD COLUMN "snapshotHash" TEXT;

-- CreateIndex
CREATE INDEX "Consultation_organizationId_approvedAt_idx" ON "Consultation"("organizationId", "approvedAt");
