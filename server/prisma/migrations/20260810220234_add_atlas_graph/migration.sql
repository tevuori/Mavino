-- CreateTable
CREATE TABLE "AtlasGraph" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error" TEXT NOT NULL DEFAULT '',
    "sourceSnapshot" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtlasGraph_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AtlasGraph_userId_key" ON "AtlasGraph"("userId");

-- CreateIndex
CREATE INDEX "AtlasGraph_userId_idx" ON "AtlasGraph"("userId");

-- AddForeignKey
ALTER TABLE "AtlasGraph" ADD CONSTRAINT "AtlasGraph_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
