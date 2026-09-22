-- DropIndex
DROP INDEX "StudyGroupMember_groupId_userId_key";

-- AlterTable
ALTER TABLE "Podcast" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "FolderSync" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteFolderId" TEXT NOT NULL,
    "vFolderId" TEXT NOT NULL,

    CONSTRAINT "FolderSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FolderSync_noteFolderId_key" ON "FolderSync"("noteFolderId");

-- CreateIndex
CREATE UNIQUE INDEX "FolderSync_vFolderId_key" ON "FolderSync"("vFolderId");

-- CreateIndex
CREATE INDEX "FolderSync_userId_idx" ON "FolderSync"("userId");

-- AddForeignKey
ALTER TABLE "FolderSync" ADD CONSTRAINT "FolderSync_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderSync" ADD CONSTRAINT "FolderSync_noteFolderId_fkey" FOREIGN KEY ("noteFolderId") REFERENCES "NoteFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderSync" ADD CONSTRAINT "FolderSync_vFolderId_fkey" FOREIGN KEY ("vFolderId") REFERENCES "VFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "StudyGroupMember_groupId_userId_key1" RENAME TO "StudyGroupMember_groupId_userId_key";
