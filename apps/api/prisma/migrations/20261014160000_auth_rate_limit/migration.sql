-- CreateTable
CREATE TABLE "AuthRateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");

-- Public auth attempts may not have an authenticated/user actor. The subject
-- and origin are kept only as keyed digests in targetId/metadata.
ALTER TABLE "AuditLog" ALTER COLUMN "actorUserId" DROP NOT NULL;
