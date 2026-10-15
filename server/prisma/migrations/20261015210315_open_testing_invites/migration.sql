-- CreateTable
CREATE TABLE "OpenTestingInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "userId" TEXT,

    CONSTRAINT "OpenTestingInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpenTestingInvite_codeHash_key" ON "OpenTestingInvite"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "OpenTestingInvite_userId_key" ON "OpenTestingInvite"("userId");

-- CreateIndex
CREATE INDEX "OpenTestingInvite_email_idx" ON "OpenTestingInvite"("email");

-- CreateIndex
CREATE INDEX "OpenTestingInvite_status_idx" ON "OpenTestingInvite"("status");

-- AddForeignKey
ALTER TABLE "OpenTestingInvite" ADD CONSTRAINT "OpenTestingInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
