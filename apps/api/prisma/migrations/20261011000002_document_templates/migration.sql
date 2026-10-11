CREATE TYPE "DocumentType" AS ENUM ('PRESCRIPTION', 'CERTIFICATE', 'REPORT', 'EXAM_REQUEST');

CREATE TYPE "TemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "DocumentTemplate" (
  "id" UUID NOT NULL,
  "organizationId" UUID,
  "title" TEXT NOT NULL,
  "type" "DocumentType" NOT NULL,
  "bodyTemplate" TEXT NOT NULL,
  "status" "TemplateStatus" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "archivedById" UUID,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentTemplate_organizationId_status_type_idx"
  ON "DocumentTemplate"("organizationId", "status", "type");

CREATE INDEX "DocumentTemplate_organizationId_createdAt_idx"
  ON "DocumentTemplate"("organizationId", "createdAt");

ALTER TABLE "DocumentTemplate"
  ADD CONSTRAINT "DocumentTemplate_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
