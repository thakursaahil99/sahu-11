-- CreateEnum
CREATE TYPE "ContestType" AS ENUM ('PRACTICE', 'FREE', 'PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('OPEN', 'LOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrizeCurrency" AS ENUM ('NONE', 'DEMO', 'INR');

-- CreateTable
CREATE TABLE "Contest" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "type" "ContestType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ContestStatus" NOT NULL DEFAULT 'OPEN',
    "entryFeeX100" INTEGER NOT NULL DEFAULT 0,
    "prizePoolX100" INTEGER NOT NULL DEFAULT 0,
    "currency" "PrizeCurrency" NOT NULL DEFAULT 'NONE',
    "totalSpots" INTEGER NOT NULL,
    "filledSpots" INTEGER NOT NULL DEFAULT 0,
    "maxEntriesPerUser" INTEGER NOT NULL DEFAULT 1,
    "guaranteed" BOOLEAN NOT NULL DEFAULT false,
    "prizeBreakup" JSONB NOT NULL DEFAULT '[]',
    "inviteCode" TEXT,
    "createdById" TEXT,
    "templateKey" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContestEntry" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "pointsX10" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "winningsX100" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContestEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contest_inviteCode_key" ON "Contest"("inviteCode");

-- CreateIndex
CREATE INDEX "Contest_matchId_status_idx" ON "Contest"("matchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Contest_matchId_templateKey_key" ON "Contest"("matchId", "templateKey");

-- CreateIndex
CREATE INDEX "ContestEntry_userId_idx" ON "ContestEntry"("userId");

-- CreateIndex
CREATE INDEX "ContestEntry_contestId_pointsX10_idx" ON "ContestEntry"("contestId", "pointsX10");

-- CreateIndex
CREATE UNIQUE INDEX "ContestEntry_contestId_teamId_key" ON "ContestEntry"("contestId", "teamId");

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestEntry" ADD CONSTRAINT "ContestEntry_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "Contest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestEntry" ADD CONSTRAINT "ContestEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContestEntry" ADD CONSTRAINT "ContestEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "UserTeam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defence in depth: the database itself refuses to overfill a contest.
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_spots_check" CHECK ("filledSpots" >= 0 AND "filledSpots" <= "totalSpots" AND "totalSpots" >= 2);
ALTER TABLE "Contest" ADD CONSTRAINT "Contest_amounts_check" CHECK ("entryFeeX100" >= 0 AND "prizePoolX100" >= 0 AND "maxEntriesPerUser" >= 1);
