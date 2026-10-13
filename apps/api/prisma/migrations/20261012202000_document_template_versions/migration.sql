CREATE TABLE "DocumentTemplateVersion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "templateId" UUID NOT NULL,
  "organizationId" UUID,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "type" "DocumentType" NOT NULL,
  "bodyTemplate" TEXT NOT NULL,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentTemplateVersion_templateId_version_key"
  ON "DocumentTemplateVersion"("templateId", "version");

CREATE INDEX "DocumentTemplateVersion_organizationId_templateId_idx"
  ON "DocumentTemplateVersion"("organizationId", "templateId");

ALTER TABLE "DocumentTemplateVersion"
  ADD CONSTRAINT "DocumentTemplateVersion_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentTemplateVersion"
  ADD CONSTRAINT "DocumentTemplateVersion_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "DocumentTemplateVersion" (
  "id",
  "templateId",
  "organizationId",
  "version",
  "title",
  "type",
  "bodyTemplate",
  "createdById",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  "id",
  "organizationId",
  "version",
  "title",
  "type",
  "bodyTemplate",
  "createdById",
  "createdAt"
FROM "DocumentTemplate"
ON CONFLICT ("templateId", "version") DO NOTHING;
