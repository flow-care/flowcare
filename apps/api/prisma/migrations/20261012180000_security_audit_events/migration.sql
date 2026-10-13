ALTER TABLE "AuditLog" ALTER COLUMN "organizationId" DROP NOT NULL;

CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");
