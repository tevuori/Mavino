-- CreateTable
CREATE TABLE "PulseForecast" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error" TEXT NOT NULL DEFAULT '',
    "lastAlertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PulseForecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PulseForecast_userId_key" ON "PulseForecast"("userId");

-- CreateIndex
CREATE INDEX "PulseForecast_userId_idx" ON "PulseForecast"("userId");

-- AddForeignKey
ALTER TABLE "PulseForecast" ADD CONSTRAINT "PulseForecast_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
