-- CreateTable
CREATE TABLE "ConceptGraph" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceIds" TEXT NOT NULL DEFAULT '[]',
    "sourceKey" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConceptGraph_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConceptGraph_userId_idx" ON "ConceptGraph"("userId");

-- CreateIndex
CREATE INDEX "ConceptGraph_userId_sourceKey_idx" ON "ConceptGraph"("userId", "sourceKey");

-- AddForeignKey
ALTER TABLE "ConceptGraph" ADD CONSTRAINT "ConceptGraph_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
