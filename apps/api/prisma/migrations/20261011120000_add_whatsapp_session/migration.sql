-- Each provider session is privately bound to exactly one clinic.
CREATE TABLE "WhatsAppSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "providerSessionName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppSession_organizationId_key" ON "WhatsAppSession"("organizationId");
CREATE UNIQUE INDEX "WhatsAppSession_providerSessionName_key" ON "WhatsAppSession"("providerSessionName");

ALTER TABLE "WhatsAppSession" ADD CONSTRAINT "WhatsAppSession_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
