-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('SUBMITTED', 'VALIDATING', 'VERIFIED', 'REJECTED', 'ONCHAIN_COMMITTED');

-- CreateEnum
CREATE TYPE "EventParticipationStatus" AS ENUM ('JOINED', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RejectReason" AS ENUM ('ERR_DISTANCE_SHORT', 'ERR_PACE_IMPOSSIBLE', 'ERR_DURATION_SHORT', 'ERR_TIMESTAMP_INVALID', 'ERR_NO_DEVICE_ATTESTATION', 'ERR_NOT_ELIGIBLE', 'ERR_EVENT_CLOSED', 'ERR_ALREADY_COMPLETED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "walletAddress" VARCHAR(42) NOT NULL,
    "profileTokenId" BIGINT,
    "profileMintTxHash" VARCHAR(66),
    "profileMintedAt" TIMESTAMP(3),
    "exp" INTEGER NOT NULL DEFAULT 0,
    "tier" INTEGER NOT NULL DEFAULT 0,
    "totalDistanceMeters" INTEGER NOT NULL DEFAULT 0,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "verifiedRunCount" INTEGER NOT NULL DEFAULT 0,
    "lastOnchainSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "walletAddress" VARCHAR(42) NOT NULL,
    "nonce" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'SUBMITTED',
    "distanceMeters" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "deviceHash" VARCHAR(128),
    "avgPaceSeconds" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "onchainCommittedAt" TIMESTAMP(3),
    "reasonCode" "RejectReason",
    "validatorVersion" VARCHAR(32),
    "rulesetHash" VARCHAR(66),
    "onchainTxHash" VARCHAR(66),

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunStatusHistory" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL,
    "reasonCode" "RejectReason",
    "note" VARCHAR(255),
    "txHash" VARCHAR(66),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "eventId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "minTier" INTEGER NOT NULL,
    "minTotalDistanceMeters" INTEGER NOT NULL,
    "targetDistanceMeters" INTEGER NOT NULL,
    "expReward" INTEGER NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "chainId" INTEGER,
    "rulesetHash" VARCHAR(66),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "EventParticipation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "status" "EventParticipationStatus" NOT NULL DEFAULT 'JOINED',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completionRunId" TEXT,
    "completionReasonCode" "RejectReason",

    CONSTRAINT "EventParticipation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "runId" TEXT,
    "participationId" TEXT,
    "tokenId" BIGINT,
    "mintedAt" TIMESTAMP(3),
    "txHash" VARCHAR(66),
    "verifiedDistanceMeters" INTEGER NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "rulesetHash" VARCHAR(66) NOT NULL,
    "validatorVersion" VARCHAR(32) NOT NULL,
    "chainId" INTEGER,
    "metadataUri" TEXT,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "AuthNonce_nonce_key" ON "AuthNonce"("nonce");

-- CreateIndex
CREATE INDEX "AuthNonce_walletAddress_idx" ON "AuthNonce"("walletAddress");

-- CreateIndex
CREATE INDEX "Run_userId_status_idx" ON "Run"("userId", "status");

-- CreateIndex
CREATE INDEX "Run_submittedAt_idx" ON "Run"("submittedAt");

-- CreateIndex
CREATE INDEX "RunStatusHistory_runId_createdAt_idx" ON "RunStatusHistory"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "EventParticipation_eventId_status_idx" ON "EventParticipation"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipation_userId_eventId_key" ON "EventParticipation"("userId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipation_completionRunId_key" ON "EventParticipation"("completionRunId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_participationId_key" ON "Achievement"("participationId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_tokenId_key" ON "Achievement"("tokenId");

-- CreateIndex
CREATE INDEX "Achievement_eventId_idx" ON "Achievement"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_userId_eventId_key" ON "Achievement"("userId", "eventId");

-- AddForeignKey
ALTER TABLE "AuthNonce" ADD CONSTRAINT "AuthNonce_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunStatusHistory" ADD CONSTRAINT "RunStatusHistory_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipation" ADD CONSTRAINT "EventParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipation" ADD CONSTRAINT "EventParticipation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("eventId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipation" ADD CONSTRAINT "EventParticipation_completionRunId_fkey" FOREIGN KEY ("completionRunId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("eventId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "EventParticipation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
