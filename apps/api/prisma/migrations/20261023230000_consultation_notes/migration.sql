-- Registro livre do atendimento (editor rico) separado da anamnese estruturada.
ALTER TABLE "Consultation"
  ADD COLUMN IF NOT EXISTS "notesRich" JSONB,
  ADD COLUMN IF NOT EXISTS "notesText" TEXT,
  ADD COLUMN IF NOT EXISTS "notesSavedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "notesSavedById" UUID;
