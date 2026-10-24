-- Persiste o resultado da transcrição: texto integral e tópicos extraídos.
ALTER TABLE "TranscriptionJob" ADD COLUMN "text" TEXT;
ALTER TABLE "TranscriptionJob" ADD COLUMN "topics" JSONB;
