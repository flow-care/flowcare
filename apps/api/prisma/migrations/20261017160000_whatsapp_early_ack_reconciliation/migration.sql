BEGIN;

ALTER TABLE "WhatsAppWebhookEvent"
  ADD COLUMN "organizationId" UUID,
  ADD COLUMN "providerMessageHash" TEXT,
  ALTER COLUMN "messageId" DROP NOT NULL;

UPDATE "WhatsAppWebhookEvent" AS event
SET
  "organizationId" = message."organizationId",
  "providerMessageHash" = message."providerMessageHash"
FROM "WhatsAppMessage" AS message
WHERE event."messageId" = message."id";

ALTER TABLE "WhatsAppWebhookEvent"
  ALTER COLUMN "organizationId" SET NOT NULL,
  ALTER COLUMN "providerMessageHash" SET NOT NULL;

DROP INDEX "WhatsAppMessage_providerMessageHash_key";
CREATE UNIQUE INDEX "WhatsAppMessage_organizationId_id_key"
  ON "WhatsAppMessage"("organizationId", "id");
CREATE UNIQUE INDEX "WhatsAppMessage_organizationId_providerMessageHash_key"
  ON "WhatsAppMessage"("organizationId", "providerMessageHash");

DROP INDEX "WhatsAppWebhookEvent_providerEventId_key";
CREATE UNIQUE INDEX "WhatsAppWebhookEvent_organizationId_providerEventId_key"
  ON "WhatsAppWebhookEvent"("organizationId", "providerEventId");
CREATE INDEX "WhatsAppWebhookEvent_organizationId_providerMessageHash_messageId_idx"
  ON "WhatsAppWebhookEvent"("organizationId", "providerMessageHash", "messageId");

ALTER TABLE "WhatsAppWebhookEvent"
  DROP CONSTRAINT "WhatsAppWebhookEvent_messageId_fkey";

ALTER TABLE "WhatsAppWebhookEvent"
  ADD CONSTRAINT "WhatsAppWebhookEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppWebhookEvent_organizationId_messageId_fkey"
  FOREIGN KEY ("organizationId", "messageId")
  REFERENCES "WhatsAppMessage"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
