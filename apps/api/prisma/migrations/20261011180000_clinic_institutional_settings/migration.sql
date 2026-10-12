ALTER TABLE "Organization"
  ADD COLUMN "logoObjectKey" TEXT,
  ADD COLUMN "logoContentType" TEXT,
  ADD COLUMN "logoSizeBytes" INTEGER,
  ADD COLUMN "logoUpdatedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Organization_logoObjectKey_key" ON "Organization"("logoObjectKey");

CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX "AuditLog_organizationId_action_idx" ON "AuditLog"("organizationId", "action");

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
