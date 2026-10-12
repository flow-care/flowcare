CREATE TABLE "ScheduleException" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "professionalId" UUID,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduleException_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ScheduleException_valid_interval" CHECK ("startsAt" < "endsAt"),
  CONSTRAINT "ScheduleException_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ScheduleException_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScheduleException_organizationId_professionalId_startsAt_endsAt_idx"
  ON "ScheduleException"("organizationId", "professionalId", "startsAt", "endsAt");
ALTER TABLE "ScheduleException"
  ADD CONSTRAINT "ScheduleException_no_clinic_overlap"
  EXCLUDE USING gist ("organizationId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE ("professionalId" IS NULL);
ALTER TABLE "ScheduleException"
  ADD CONSTRAINT "ScheduleException_no_professional_overlap"
  EXCLUDE USING gist ("organizationId" WITH =, "professionalId" WITH =, tsrange("startsAt", "endsAt", '[)') WITH &&)
  WHERE ("professionalId" IS NOT NULL);
