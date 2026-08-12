-- CreateTable
CREATE TABLE "CompassProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "researchQuestion" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompassProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompassPaper" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT NOT NULL DEFAULT '[]',
    "year" INTEGER,
    "venue" TEXT NOT NULL DEFAULT '',
    "doi" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "fileId" TEXT,
    "abstract" TEXT NOT NULL DEFAULT '',
    "fullText" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'to_read',
    "annotations" TEXT NOT NULL DEFAULT '',
    "keyConcepts" TEXT NOT NULL DEFAULT '[]',
    "extracted" BOOLEAN NOT NULL DEFAULT false,
    "extractStatus" TEXT NOT NULL DEFAULT 'idle',
    "extractError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompassPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompassCitation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourcePaperId" TEXT NOT NULL,
    "targetPaperId" TEXT,
    "targetTitle" TEXT NOT NULL,
    "context" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompassCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompassReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error" TEXT NOT NULL DEFAULT '',
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompassReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompassProject_userId_idx" ON "CompassProject"("userId");

-- CreateIndex
CREATE INDEX "CompassPaper_projectId_idx" ON "CompassPaper"("projectId");

-- CreateIndex
CREATE INDEX "CompassPaper_userId_idx" ON "CompassPaper"("userId");

-- CreateIndex
CREATE INDEX "CompassCitation_projectId_idx" ON "CompassCitation"("projectId");

-- CreateIndex
CREATE INDEX "CompassCitation_sourcePaperId_idx" ON "CompassCitation"("sourcePaperId");

-- CreateIndex
CREATE INDEX "CompassCitation_targetPaperId_idx" ON "CompassCitation"("targetPaperId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "CompassReview_projectId_key" ON "CompassReview"("projectId");

-- AddForeignKey
ALTER TABLE "CompassProject" ADD CONSTRAINT "CompassProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompassPaper" ADD CONSTRAINT "CompassPaper_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CompassProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompassPaper" ADD CONSTRAINT "CompassPaper_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompassCitation" ADD CONSTRAINT "CompassCitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CompassProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompassCitation" ADD CONSTRAINT "CompassCitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompassCitation" ADD CONSTRAINT "CompassCitation_sourcePaperId_fkey" FOREIGN KEY ("sourcePaperId") REFERENCES "CompassPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompassCitation" ADD CONSTRAINT "CompassCitation_targetPaperId_fkey" FOREIGN KEY ("targetPaperId") REFERENCES "CompassPaper"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompassReview" ADD CONSTRAINT "CompassReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CompassProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
