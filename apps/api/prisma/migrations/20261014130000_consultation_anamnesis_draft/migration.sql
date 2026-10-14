-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN "chiefComplaint" TEXT;
ALTER TABLE "Consultation" ADD COLUMN "clinicalNotes" TEXT;
ALTER TABLE "Consultation" ADD COLUMN "anamnesisDraft" JSONB DEFAULT '{}';
ALTER TABLE "Consultation" ADD COLUMN "draftSavedAt" TIMESTAMP(3);
ALTER TABLE "Consultation" ADD COLUMN "draftSavedById" UUID;
