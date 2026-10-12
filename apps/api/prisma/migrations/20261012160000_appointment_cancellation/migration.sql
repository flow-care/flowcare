ALTER TABLE "Appointment"
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledById" UUID;
