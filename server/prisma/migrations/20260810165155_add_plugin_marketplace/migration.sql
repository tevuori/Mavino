-- CreateTable
CREATE TABLE "Plugin" (
    "id" TEXT NOT NULL,
    "pluginKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT 'Puzzle',
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "author" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "entryUrl" TEXT NOT NULL,
    "manifest" TEXT NOT NULL DEFAULT '{}',
    "minTier" TEXT NOT NULL DEFAULT 'paid',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plugin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPlugin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pluginKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPlugin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plugin_pluginKey_key" ON "Plugin"("pluginKey");

-- CreateIndex
CREATE INDEX "Plugin_published_featured_idx" ON "Plugin"("published", "featured");

-- CreateIndex
CREATE INDEX "Plugin_category_idx" ON "Plugin"("category");

-- CreateIndex
CREATE INDEX "UserPlugin_userId_idx" ON "UserPlugin"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPlugin_userId_pluginKey_key" ON "UserPlugin"("userId", "pluginKey");

-- AddForeignKey
ALTER TABLE "UserPlugin" ADD CONSTRAINT "UserPlugin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPlugin" ADD CONSTRAINT "UserPlugin_pluginKey_fkey" FOREIGN KEY ("pluginKey") REFERENCES "Plugin"("pluginKey") ON DELETE CASCADE ON UPDATE CASCADE;
