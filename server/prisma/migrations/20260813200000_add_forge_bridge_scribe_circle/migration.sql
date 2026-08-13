-- CreateTable
CREATE TABLE "ForgeProblemSet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'mixed',
    "difficulty" TEXT NOT NULL DEFAULT 'adaptive',
    "source" TEXT NOT NULL DEFAULT '{}',
    "conceptIds" TEXT NOT NULL DEFAULT '[]',
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForgeProblemSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeProblem" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL DEFAULT 'medium',
    "prompt" TEXT NOT NULL,
    "options" TEXT NOT NULL DEFAULT '[]',
    "answer" TEXT NOT NULL,
    "solution" TEXT NOT NULL,
    "conceptIds" TEXT NOT NULL DEFAULT '[]',
    "hint" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForgeProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForgeAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "submitted" TEXT NOT NULL DEFAULT '',
    "result" TEXT NOT NULL DEFAULT 'incorrect',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feedback" TEXT NOT NULL DEFAULT '{}',
    "variantGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForgeAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptBridge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptAId" TEXT NOT NULL,
    "conceptALabel" TEXT NOT NULL,
    "conceptBId" TEXT NOT NULL,
    "conceptBLabel" TEXT NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'analogy',
    "explanation" TEXT NOT NULL DEFAULT '',
    "sourceA" TEXT NOT NULL DEFAULT '',
    "sourceB" TEXT NOT NULL DEFAULT '',
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConceptBridge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScribeDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "compassProjectId" TEXT NOT NULL DEFAULT '',
    "docType" TEXT NOT NULL DEFAULT 'essay',
    "thesisStatement" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScribeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScribeFeedback" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feedbackType" TEXT NOT NULL DEFAULT 'full',
    "content" TEXT NOT NULL DEFAULT '',
    "issues" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error" TEXT NOT NULL DEFAULT '',
    "score" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScribeFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyGroup" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "inviteCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedDeck" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "sharedBy" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'read',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedDeck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharedNoteFolder" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "sharedBy" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'read',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedNoteFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForgeProblemSet_userId_idx" ON "ForgeProblemSet"("userId");

-- CreateIndex
CREATE INDEX "ForgeProblem_setId_idx" ON "ForgeProblem"("setId");

-- CreateIndex
CREATE INDEX "ForgeProblem_userId_idx" ON "ForgeProblem"("userId");

-- CreateIndex
CREATE INDEX "ForgeAttempt_userId_idx" ON "ForgeAttempt"("userId");

-- CreateIndex
CREATE INDEX "ForgeAttempt_problemId_idx" ON "ForgeAttempt"("problemId");

-- CreateIndex
CREATE INDEX "ForgeAttempt_userId_createdAt_idx" ON "ForgeAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ConceptBridge_userId_idx" ON "ConceptBridge"("userId");

-- CreateIndex
CREATE INDEX "ConceptBridge_userId_seen_idx" ON "ConceptBridge"("userId", "seen");

-- CreateIndex
CREATE INDEX "ScribeDocument_userId_idx" ON "ScribeDocument"("userId");

-- CreateIndex
CREATE INDEX "ScribeFeedback_documentId_idx" ON "ScribeFeedback"("documentId");

-- CreateIndex
CREATE INDEX "ScribeFeedback_userId_idx" ON "ScribeFeedback"("userId");

-- CreateIndex
CREATE INDEX "StudyGroup_ownerId_idx" ON "StudyGroup"("ownerId");

-- CreateIndex
CREATE INDEX "StudyGroupMember_groupId_idx" ON "StudyGroupMember"("groupId");

-- CreateIndex
CREATE INDEX "StudyGroupMember_userId_idx" ON "StudyGroupMember"("userId");

-- CreateIndex
CREATE INDEX "SharedDeck_groupId_idx" ON "SharedDeck"("groupId");

-- CreateIndex
CREATE INDEX "SharedNoteFolder_groupId_idx" ON "SharedNoteFolder"("groupId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "ConceptBridge_userId_conceptAId_conceptBId_key" ON "ConceptBridge"("userId", "conceptAId", "conceptBId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "StudyGroup_inviteCode_key" ON "StudyGroup"("inviteCode");

-- CreateUniqueIndex
CREATE INDEX "StudyGroupMember_groupId_userId_key" ON "StudyGroupMember"("groupId", "userId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "StudyGroupMember_groupId_userId_key1" ON "StudyGroupMember"("groupId", "userId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "SharedDeck_groupId_deckId_key" ON "SharedDeck"("groupId", "deckId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "SharedNoteFolder_groupId_folderId_key" ON "SharedNoteFolder"("groupId", "folderId");

-- AddForeignKey
ALTER TABLE "ForgeProblemSet" ADD CONSTRAINT "ForgeProblemSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeProblem" ADD CONSTRAINT "ForgeProblem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "ForgeProblemSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeProblem" ADD CONSTRAINT "ForgeProblem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeAttempt" ADD CONSTRAINT "ForgeAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForgeAttempt" ADD CONSTRAINT "ForgeAttempt_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "ForgeProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptBridge" ADD CONSTRAINT "ConceptBridge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScribeDocument" ADD CONSTRAINT "ScribeDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScribeFeedback" ADD CONSTRAINT "ScribeFeedback_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ScribeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScribeFeedback" ADD CONSTRAINT "ScribeFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyGroup" ADD CONSTRAINT "StudyGroup_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyGroupMember" ADD CONSTRAINT "StudyGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyGroupMember" ADD CONSTRAINT "StudyGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedDeck" ADD CONSTRAINT "SharedDeck_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedDeck" ADD CONSTRAINT "SharedDeck_sharedBy_fkey" FOREIGN KEY ("sharedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedNoteFolder" ADD CONSTRAINT "SharedNoteFolder_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedNoteFolder" ADD CONSTRAINT "SharedNoteFolder_sharedBy_fkey" FOREIGN KEY ("sharedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
