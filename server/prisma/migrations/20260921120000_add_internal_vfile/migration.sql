ALTER TABLE "VFile" ADD COLUMN "internal" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "VFile_userId_internal_idx" ON "VFile"("userId", "internal");
