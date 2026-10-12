CREATE TYPE "ReceptionQueueStatus" AS ENUM (
  'WAITING',
  'ARRIVED',
  'CALLED',
  'IN_SERVICE',
  'COMPLETED',
  'NO_SHOW'
);

ALTER TABLE "Appointment"
  ADD COLUMN "queueStatus" "ReceptionQueueStatus" NOT NULL DEFAULT 'WAITING',
  ADD COLUMN "arrivedAt" TIMESTAMP(3),
  ADD COLUMN "queueUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "queueUpdatedById" UUID,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Appointment_organizationId_queueStatus_scheduledAt_idx"
  ON "Appointment"("organizationId", "queueStatus", "scheduledAt");
