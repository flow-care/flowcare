ALTER TABLE "ClinicalDocument"
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "voidedById" UUID;
