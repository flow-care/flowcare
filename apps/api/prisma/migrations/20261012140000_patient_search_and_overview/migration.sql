-- AlterTable
ALTER TABLE "Patient"
  ADD COLUMN "normalizedName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "email" TEXT,
  ADD COLUMN "healthInsurance" TEXT,
  ADD COLUMN "insuranceNumber" TEXT,
  ADD COLUMN "allergies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "comorbidities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "clinicalAlerts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "medicalNotes" TEXT;

-- Backfill normalizedName for existing patients
UPDATE "Patient"
SET "normalizedName" = regexp_replace(
  translate(
    lower(trim("fullName")),
    'áàâãäéèêëíìîïóòôõöúùûüçñýÿ',
    'aaaaaeeeeiiiiooooouuuucnyy'
  ),
  '\s+',
  ' ',
  'g'
)
WHERE "normalizedName" = '';

-- CreateIndex
CREATE INDEX "Patient_organizationId_normalizedName_idx" ON "Patient"("organizationId", "normalizedName");
CREATE INDEX "Patient_organizationId_phone_idx" ON "Patient"("organizationId", "phone");
CREATE INDEX "Patient_organizationId_createdAt_id_idx" ON "Patient"("organizationId", "createdAt", "id");
