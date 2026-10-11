ALTER TABLE "User" ADD COLUMN "activeOrganizationId" UUID;

ALTER TABLE "User" ADD CONSTRAINT "User_activeOrganizationId_fkey"
  FOREIGN KEY ("activeOrganizationId") REFERENCES "Organization"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
