CREATE TABLE "WeeklyScheduleRule" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "dayOfWeek" TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "slotDurationMinutes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WeeklyScheduleRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WeeklyScheduleRule_organizationId_dayOfWeek_idx"
  ON "WeeklyScheduleRule"("organizationId", "dayOfWeek");

ALTER TABLE "WeeklyScheduleRule"
  ADD CONSTRAINT "WeeklyScheduleRule_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
