BEGIN;

CREATE TYPE "WhatsAppMessageAttemptOrigin" AS ENUM ('AUTOMATIC', 'MANUAL');

-- Expansion phase: organizationId remains nullable so the #296 worker can
-- continue inserting automatic attempts with only messageId and number.
ALTER TABLE "WhatsAppMessageAttempt"
  ADD COLUMN "organizationId" UUID,
  ADD COLUMN "origin" "WhatsAppMessageAttemptOrigin" NOT NULL DEFAULT 'AUTOMATIC',
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestedById" UUID,
  ADD COLUMN "dispatchedAt" TIMESTAMP(3);

ALTER TABLE "WhatsAppWebhookEvent"
  ADD COLUMN "attemptId" UUID;

-- messageId already has a foreign key, so this copies only a proven tenant
-- association and does not infer any historical dispatch or operator data.
UPDATE "WhatsAppMessageAttempt" AS attempt
SET "organizationId" = message."organizationId"
FROM "WhatsAppMessage" AS message
WHERE attempt."messageId" = message."id"
  AND attempt."organizationId" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "WhatsAppMessageAttempt"
    WHERE "organizationId" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill WhatsAppMessageAttempt.organizationId from WhatsAppMessage';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "WhatsAppMessageAttempt"
    WHERE "providerMessageHash" IS NOT NULL
    GROUP BY "organizationId", "providerMessageHash"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate WhatsAppMessageAttempt provider hashes exist within an organization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "WhatsAppMessageAttempt"
    WHERE "number" <= 0
      OR ("completedAt" IS NOT NULL AND "completedAt" < "startedAt")
  ) THEN
    RAISE EXCEPTION
      'Invalid historical WhatsAppMessageAttempt numbering or timestamps';
  END IF;
END
$$;

CREATE UNIQUE INDEX "WhatsAppMessageAttempt_organizationId_id_key"
  ON "WhatsAppMessageAttempt"("organizationId", "id");
CREATE UNIQUE INDEX "WhatsAppMessageAttempt_organizationId_idempotencyKey_key"
  ON "WhatsAppMessageAttempt"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "WhatsAppMessageAttempt_organizationId_providerMessageHash_key"
  ON "WhatsAppMessageAttempt"("organizationId", "providerMessageHash");
CREATE INDEX "WhatsAppMessageAttempt_organizationId_messageId_completedAt_idx"
  ON "WhatsAppMessageAttempt"("organizationId", "messageId", "completedAt");
CREATE INDEX "WhatsAppWebhookEvent_organizationId_attemptId_idx"
  ON "WhatsAppWebhookEvent"("organizationId", "attemptId");

-- Keep the original messageId foreign key and Prisma relation during expansion.
-- They protect and expose rows inserted by the current worker while
-- organizationId is still nullable. The composite key additionally enforces
-- tenant consistency whenever organizationId is set.
ALTER TABLE "WhatsAppMessageAttempt"
  ADD CONSTRAINT "WhatsAppMessageAttempt_organizationId_messageId_fkey"
  FOREIGN KEY ("organizationId", "messageId")
  REFERENCES "WhatsAppMessage"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID,
  ADD CONSTRAINT "WhatsAppMessageAttempt_manual_metadata_check"
  CHECK (
    (
      "origin" = 'AUTOMATIC'::"WhatsAppMessageAttemptOrigin"
      AND "idempotencyKey" IS NULL
      AND "requestedById" IS NULL
    )
    OR
    (
      "origin" = 'MANUAL'::"WhatsAppMessageAttemptOrigin"
      AND "organizationId" IS NOT NULL
      AND "idempotencyKey" IS NOT NULL
      AND BTRIM("idempotencyKey") <> ''
      AND "requestedById" IS NOT NULL
    )
  ) NOT VALID,
  ADD CONSTRAINT "WhatsAppMessageAttempt_number_check"
  CHECK ("number" > 0) NOT VALID,
  ADD CONSTRAINT "WhatsAppMessageAttempt_timestamps_check"
  CHECK (
    ("dispatchedAt" IS NULL OR "dispatchedAt" >= "startedAt")
    AND ("completedAt" IS NULL OR "completedAt" >= "startedAt")
    AND (
      "completedAt" IS NULL
      OR "dispatchedAt" IS NULL
      OR "completedAt" >= "dispatchedAt"
    )
  ) NOT VALID;

ALTER TABLE "WhatsAppMessageAttempt"
  VALIDATE CONSTRAINT "WhatsAppMessageAttempt_organizationId_messageId_fkey",
  VALIDATE CONSTRAINT "WhatsAppMessageAttempt_manual_metadata_check",
  VALIDATE CONSTRAINT "WhatsAppMessageAttempt_number_check",
  VALIDATE CONSTRAINT "WhatsAppMessageAttempt_timestamps_check";

-- A webhook is linked only when organization + provider hash identify exactly
-- one attempt and an existing message association does not contradict it.
UPDATE "WhatsAppWebhookEvent" AS event
SET
  "attemptId" = attempt."id",
  "messageId" = COALESCE(event."messageId", attempt."messageId")
FROM "WhatsAppMessageAttempt" AS attempt
WHERE event."organizationId" = attempt."organizationId"
  AND event."providerMessageHash" = attempt."providerMessageHash"
  AND attempt."providerMessageHash" IS NOT NULL
  AND (
    event."messageId" IS NULL
    OR event."messageId" = attempt."messageId"
  );

ALTER TABLE "WhatsAppWebhookEvent"
  ADD CONSTRAINT "WhatsAppWebhookEvent_organizationId_attemptId_fkey"
  FOREIGN KEY ("organizationId", "attemptId")
  REFERENCES "WhatsAppMessageAttempt"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "WhatsAppWebhookEvent"
  VALIDATE CONSTRAINT "WhatsAppWebhookEvent_organizationId_attemptId_fkey";

-- Future contraction, after every API/worker instance writes organizationId:
-- 1. Backfill and verify any attempts created by the old worker during rollout.
-- 2. Mark organizationId NOT NULL.
-- 3. Finalize or classify legacy attempts whose completedAt is still NULL.
-- 4. Add the partial unique index that permits only one open attempt per
--    message after the worker manages that invariant explicitly.
-- 5. Drop the legacy WhatsAppMessageAttempt_messageId_fkey and its Prisma
--    relation; the scoped relation then becomes the sole parent link.

COMMIT;
