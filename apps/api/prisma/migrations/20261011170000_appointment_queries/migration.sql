CREATE TYPE "AppointmentStatus" AS ENUM (
  'RESERVED',
  'CONFIRMED',
  'CANCELLED',
  'COMPLETED',
  'NO_SHOW'
);

CREATE TABLE "Appointment" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "professionalId" UUID NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "status" "AppointmentStatus" NOT NULL DEFAULT 'RESERVED',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfessionalSchedulePause" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "professionalId" UUID NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfessionalSchedulePause_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Appointment_organizationId_scheduledAt_id_idx"
  ON "Appointment"("organizationId", "scheduledAt", "id");
CREATE INDEX "Appointment_organizationId_professionalId_scheduledAt_idx"
  ON "Appointment"("organizationId", "professionalId", "scheduledAt");
CREATE INDEX "Appointment_organizationId_status_scheduledAt_idx"
  ON "Appointment"("organizationId", "status", "scheduledAt");
CREATE INDEX "ProfessionalSchedulePause_organizationId_professionalId_startsAt_endsAt_idx"
  ON "ProfessionalSchedulePause"("organizationId", "professionalId", "startsAt", "endsAt");

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProfessionalSchedulePause"
  ADD CONSTRAINT "ProfessionalSchedulePause_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfessionalSchedulePause"
  ADD CONSTRAINT "ProfessionalSchedulePause_professionalId_fkey"
  FOREIGN KEY ("professionalId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_durationMinutes_check"
  CHECK ("durationMinutes" > 0 AND "durationMinutes" <= 1440);
ALTER TABLE "ProfessionalSchedulePause"
  ADD CONSTRAINT "ProfessionalSchedulePause_interval_check"
  CHECK ("startsAt" < "endsAt");
