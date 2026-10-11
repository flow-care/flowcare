ALTER TABLE "User"
  ADD COLUMN "profilePhotoKey" TEXT,
  ADD COLUMN "profilePhotoContentType" TEXT,
  ADD COLUMN "profilePhotoSizeBytes" INTEGER;

CREATE UNIQUE INDEX "User_profilePhotoKey_key" ON "User"("profilePhotoKey");
