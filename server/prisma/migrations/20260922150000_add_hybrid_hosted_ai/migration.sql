-- AlterTable
ALTER TABLE "User"
ADD COLUMN "ageBand" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "guardianConsentStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN "guardianConsentVerifiedAt" TIMESTAMP(3),
ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN "privacyAcceptedAt" TIMESTAMP(3),
ADD COLUMN "aiSource" TEXT NOT NULL DEFAULT 'choice_required';

-- AlterTable
ALTER TABLE "AiCredential"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN "authType" TEXT NOT NULL DEFAULT 'api_key',
ADD COLUMN "externalKeyHash" TEXT,
ADD COLUMN "lastValidatedAt" TIMESTAMP(3),
ADD COLUMN "lastError" TEXT;

-- CreateTable
CREATE TABLE "GuardianConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guardianEmailEnc" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardianConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "feature" TEXT NOT NULL DEFAULT 'unknown',
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "providerCalls" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostMicros" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmBudgetReservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "amountMicros" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmBudgetReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmOAuthState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "codeVerifierEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuardianConsent_tokenHash_key" ON "GuardianConsent"("tokenHash");
CREATE INDEX "GuardianConsent_userId_idx" ON "GuardianConsent"("userId");
CREATE INDEX "GuardianConsent_expiresAt_idx" ON "GuardianConsent"("expiresAt");

CREATE INDEX "LlmUsage_userId_createdAt_idx" ON "LlmUsage"("userId", "createdAt");
CREATE INDEX "LlmUsage_source_createdAt_idx" ON "LlmUsage"("source", "createdAt");
CREATE INDEX "LlmUsage_requestId_idx" ON "LlmUsage"("requestId");

CREATE UNIQUE INDEX "LlmBudgetReservation_requestId_key" ON "LlmBudgetReservation"("requestId");
CREATE INDEX "LlmBudgetReservation_userId_status_expiresAt_idx" ON "LlmBudgetReservation"("userId", "status", "expiresAt");
CREATE INDEX "LlmBudgetReservation_expiresAt_idx" ON "LlmBudgetReservation"("expiresAt");

CREATE UNIQUE INDEX "LlmOAuthState_stateHash_key" ON "LlmOAuthState"("stateHash");
CREATE INDEX "LlmOAuthState_userId_provider_idx" ON "LlmOAuthState"("userId", "provider");
CREATE INDEX "LlmOAuthState_expiresAt_idx" ON "LlmOAuthState"("expiresAt");

-- AddForeignKey
ALTER TABLE "GuardianConsent" ADD CONSTRAINT "GuardianConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LlmUsage" ADD CONSTRAINT "LlmUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LlmBudgetReservation" ADD CONSTRAINT "LlmBudgetReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LlmOAuthState" ADD CONSTRAINT "LlmOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security for new user-scoped tables.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['GuardianConsent', 'LlmUsage', 'LlmBudgetReservation', 'LlmOAuthState']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY user_isolation ON %I
         USING ( %I = COALESCE(current_setting(''app.current_user_id'', true), '''')
                 OR COALESCE(current_setting(''app.is_admin'', true), '''') = ''true''
                 OR COALESCE(current_setting(''app.current_user_id'', true), '''') = '''' )',
      t, 'userId');
    EXECUTE format(
      'CREATE POLICY user_isolation_write ON %I
         WITH CHECK ( %I = COALESCE(current_setting(''app.current_user_id'', true), '''')
                      OR COALESCE(current_setting(''app.is_admin'', true), '''') = ''true''
                      OR COALESCE(current_setting(''app.current_user_id'', true), '''') = '''' )',
      t, 'userId');
  END LOOP;
END $$;
