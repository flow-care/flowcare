CREATE TYPE "ConfirmationDecisionStatus" AS ENUM (
  'PENDING',
  'CONFIRMED',
  'DECLINED'
);

CREATE TYPE "ConfirmationDecisionOrigin" AS ENUM (
  'PHONE_CALL',
  'WHATSAPP_MANUAL',
  'IN_PERSON',
  'OTHER'
);

CREATE TABLE "AppointmentConfirmation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "appointmentId" UUID NOT NULL,
  "status" "ConfirmationDecisionStatus" NOT NULL DEFAULT 'PENDING',
  "origin" "ConfirmationDecisionOrigin",
  "originalMessage" TEXT,
  "originalMessageId" TEXT,
  "originalMessageAt" TIMESTAMP(3),
  "note" TEXT,
  "decidedById" UUID,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppointmentConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConfirmationDecision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "appointmentId" UUID NOT NULL,
  "confirmationId" UUID NOT NULL,
  "decision" "ConfirmationDecisionStatus" NOT NULL,
  "origin" "ConfirmationDecisionOrigin" NOT NULL,
  "note" TEXT,
  "decidedById" UUID NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idempotencyKey" TEXT,
  "requestHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConfirmationDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppointmentConfirmation_appointmentId_key"
  ON "AppointmentConfirmation"("appointmentId");
CREATE INDEX "AppointmentConfirmation_organizationId_status_createdAt_idx"
  ON "AppointmentConfirmation"("organizationId", "status", "createdAt");
CREATE INDEX "AppointmentConfirmation_organizationId_appointmentId_idx"
  ON "AppointmentConfirmation"("organizationId", "appointmentId");

CREATE UNIQUE INDEX "ConfirmationDecision_organizationId_idempotencyKey_key"
  ON "ConfirmationDecision"("organizationId", "idempotencyKey");
CREATE INDEX "ConfirmationDecision_organizationId_appointmentId_decidedAt_idx"
  ON "ConfirmationDecision"("organizationId", "appointmentId", "decidedAt");
CREATE INDEX "ConfirmationDecision_confirmationId_decidedAt_idx"
  ON "ConfirmationDecision"("confirmationId", "decidedAt");

ALTER TABLE "AppointmentConfirmation"
  ADD CONSTRAINT "AppointmentConfirmation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentConfirmation"
  ADD CONSTRAINT "AppointmentConfirmation_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentConfirmation"
  ADD CONSTRAINT "AppointmentConfirmation_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConfirmationDecision"
  ADD CONSTRAINT "ConfirmationDecision_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConfirmationDecision"
  ADD CONSTRAINT "ConfirmationDecision_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConfirmationDecision"
  ADD CONSTRAINT "ConfirmationDecision_confirmationId_fkey"
  FOREIGN KEY ("confirmationId") REFERENCES "AppointmentConfirmation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConfirmationDecision"
  ADD CONSTRAINT "ConfirmationDecision_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
