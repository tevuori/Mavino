-- CreateTable
CREATE TABLE "CrunchPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error" TEXT NOT NULL DEFAULT '',
    "lastAlertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrunchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrunchPlan_userId_key" ON "CrunchPlan"("userId");

-- CreateIndex
CREATE INDEX "CrunchPlan_userId_idx" ON "CrunchPlan"("userId");

-- AddForeignKey
ALTER TABLE "CrunchPlan" ADD CONSTRAINT "CrunchPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
