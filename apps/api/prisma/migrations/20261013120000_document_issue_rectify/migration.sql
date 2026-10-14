ALTER TABLE "ClinicalDocument"
  ADD COLUMN "preparedRevisionId" UUID,
  ADD COLUMN "replacesDocumentId" UUID,
  ADD COLUMN "chainVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "snapshotHash" TEXT,
  ADD COLUMN "pdfObjectKey" TEXT,
  ADD COLUMN "issuedById" UUID;

CREATE UNIQUE INDEX "ClinicalDocument_replacesDocumentId_key"
  ON "ClinicalDocument"("replacesDocumentId");

ALTER TABLE "ClinicalDocument" ADD CONSTRAINT "ClinicalDocument_replacesDocumentId_fkey"
  FOREIGN KEY ("replacesDocumentId") REFERENCES "ClinicalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
