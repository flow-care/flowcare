CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "AppointmentCreationRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "appointmentId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentCreationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentCreationRequest_organizationId_idempotencyKey_key"
  ON "AppointmentCreationRequest"("organizationId", "idempotencyKey");
CREATE INDEX "AppointmentCreationRequest_appointmentId_idx"
  ON "AppointmentCreationRequest"("appointmentId");

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AppointmentCreationRequest"
  ADD CONSTRAINT "AppointmentCreationRequest_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentCreationRequest"
  ADD CONSTRAINT "AppointmentCreationRequest_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Appointment"
  ADD CONSTRAINT "Appointment_no_overlapping_active_slots"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    "professionalId" WITH =,
    tsrange(
      "scheduledAt",
      "scheduledAt" + make_interval(mins => "durationMinutes"),
      '[)'
    ) WITH &&
  )
  WHERE ("status" IN ('RESERVED', 'CONFIRMED'));
