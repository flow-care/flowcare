CREATE TYPE "WhatsAppMessageType" AS ENUM ('APPOINTMENT_CREATED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_REMINDER');
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

CREATE TABLE "WhatsAppPreference" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "optedIn" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL,
  "recordedById" UUID NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppPreference_patientId_key" ON "WhatsAppPreference"("patientId");
CREATE INDEX "WhatsAppPreference_organizationId_optedIn_idx" ON "WhatsAppPreference"("organizationId", "optedIn");
ALTER TABLE "WhatsAppPreference" ADD CONSTRAINT "WhatsAppPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppPreference" ADD CONSTRAINT "WhatsAppPreference_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WhatsAppMessage" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "patientId" UUID NOT NULL,
  "appointmentId" UUID NOT NULL,
  "eventId" TEXT NOT NULL,
  "type" "WhatsAppMessageType" NOT NULL,
  "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'QUEUED',
  "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "providerMessageHash" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "uncertainAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppMessage_providerMessageHash_key" ON "WhatsAppMessage"("providerMessageHash");
CREATE UNIQUE INDEX "WhatsAppMessage_organizationId_eventId_type_key" ON "WhatsAppMessage"("organizationId", "eventId", "type");
CREATE INDEX "WhatsAppMessage_organizationId_sentAt_id_idx" ON "WhatsAppMessage"("organizationId", "sentAt", "id");
CREATE INDEX "WhatsAppMessage_organizationId_status_sentAt_id_idx" ON "WhatsAppMessage"("organizationId", "status", "sentAt", "id");
CREATE INDEX "WhatsAppMessage_organizationId_patientId_sentAt_id_idx" ON "WhatsAppMessage"("organizationId", "patientId", "sentAt", "id");
CREATE INDEX "WhatsAppMessage_status_nextAttemptAt_idx" ON "WhatsAppMessage"("status", "nextAttemptAt");
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WhatsAppMessageAttempt" (
  "id" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "providerMessageHash" TEXT,
  "errorCode" TEXT,
  "errorReason" TEXT,
  CONSTRAINT "WhatsAppMessageAttempt_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppMessageAttempt_messageId_number_key" ON "WhatsAppMessageAttempt"("messageId", "number");
ALTER TABLE "WhatsAppMessageAttempt" ADD CONSTRAINT "WhatsAppMessageAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WhatsAppMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WhatsAppWebhookEvent" (
  "id" UUID NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "messageId" UUID NOT NULL,
  "status" "WhatsAppMessageStatus" NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppWebhookEvent_providerEventId_key" ON "WhatsAppWebhookEvent"("providerEventId");
ALTER TABLE "WhatsAppWebhookEvent" ADD CONSTRAINT "WhatsAppWebhookEvent_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WhatsAppMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
