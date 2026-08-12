-- CreateTable
CREATE TABLE "EchoSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "language" TEXT NOT NULL DEFAULT 'en',
    "transcript" TEXT NOT NULL DEFAULT '[]',
    "concepts" TEXT NOT NULL DEFAULT '[]',
    "newTerms" TEXT NOT NULL DEFAULT '[]',
    "noteId" TEXT,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "meta" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EchoSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EchoSession_userId_idx" ON "EchoSession"("userId");

-- CreateIndex
CREATE INDEX "EchoSession_userId_status_idx" ON "EchoSession"("userId", "status");

-- AddForeignKey
ALTER TABLE "EchoSession" ADD CONSTRAINT "EchoSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
