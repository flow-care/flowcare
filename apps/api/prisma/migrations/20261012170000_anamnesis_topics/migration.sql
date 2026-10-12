CREATE TABLE "AnamnesisTopicConfig" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "professionalId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnamnesisTopicConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnamnesisTopicRevision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "configId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "topics" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnamnesisTopicRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnamnesisTopicConfig_organizationId_professionalId_key" ON "AnamnesisTopicConfig"("organizationId", "professionalId");
CREATE UNIQUE INDEX "AnamnesisTopicRevision_configId_version_key" ON "AnamnesisTopicRevision"("configId", "version");
ALTER TABLE "AnamnesisTopicConfig" ADD CONSTRAINT "AnamnesisTopicConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnamnesisTopicConfig" ADD CONSTRAINT "AnamnesisTopicConfig_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnamnesisTopicRevision" ADD CONSTRAINT "AnamnesisTopicRevision_configId_fkey" FOREIGN KEY ("configId") REFERENCES "AnamnesisTopicConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
