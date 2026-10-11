CREATE TABLE "SessionRevocationAudit" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "actorSessionId" UUID NOT NULL,
    "targetSessionId" UUID,
    "action" TEXT NOT NULL,
    "revokedCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionRevocationAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SessionRevocationAudit_userId_createdAt_idx" ON "SessionRevocationAudit"("userId", "createdAt");
