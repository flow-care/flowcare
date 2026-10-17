CREATE TYPE "WhatsAppTemplateType" AS ENUM (
  'APPOINTMENT_CONFIRMATION',
  'APPOINTMENT_CANCELLATION',
  'APPOINTMENT_REMINDER_24H'
);

CREATE TABLE "WhatsAppTemplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "type" "WhatsAppTemplateType" NOT NULL,
  "content" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "approvedById" UUID NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppTemplateVersion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "templateId" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "type" "WhatsAppTemplateType" NOT NULL,
  "content" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "approvedById" UUID NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppTemplate_organizationId_type_key"
  ON "WhatsAppTemplate"("organizationId", "type");

CREATE INDEX "WhatsAppTemplate_organizationId_updatedAt_idx"
  ON "WhatsAppTemplate"("organizationId", "updatedAt");

CREATE UNIQUE INDEX "WhatsAppTemplateVersion_templateId_version_key"
  ON "WhatsAppTemplateVersion"("templateId", "version");

CREATE INDEX "WhatsAppTemplateVersion_organizationId_templateId_idx"
  ON "WhatsAppTemplateVersion"("organizationId", "templateId");

ALTER TABLE "WhatsAppTemplate"
  ADD CONSTRAINT "WhatsAppTemplate_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppTemplateVersion"
  ADD CONSTRAINT "WhatsAppTemplateVersion_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "WhatsAppTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WhatsAppTemplateVersion"
  ADD CONSTRAINT "WhatsAppTemplateVersion_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
