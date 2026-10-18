ALTER TYPE "WhatsAppMessageStatus" ADD VALUE 'UNCERTAIN' BEFORE 'FAILED';

ALTER TABLE "WhatsAppMessage"
  ADD COLUMN "templateVersionId" UUID;

CREATE INDEX "WhatsAppMessage_templateVersionId_idx"
  ON "WhatsAppMessage"("templateVersionId");

ALTER TABLE "WhatsAppMessage"
  ADD CONSTRAINT "WhatsAppMessage_templateVersionId_fkey"
  FOREIGN KEY ("templateVersionId") REFERENCES "WhatsAppTemplateVersion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
