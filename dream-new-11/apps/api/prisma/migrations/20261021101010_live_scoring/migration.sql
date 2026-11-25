-- AlterTable
ALTER TABLE "Contest" ADD COLUMN     "settledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UserTeam" ADD COLUMN     "pointsX10" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ScoringConfig" (
    "id" TEXT NOT NULL,
    "sportId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoringConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchLiveState" (
    "matchId" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "final" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchLiveState_pkey" PRIMARY KEY ("matchId")
);

-- CreateTable
CREATE TABLE "PlayerMatchPoints" (
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "pointsX10" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerMatchPoints_pkey" PRIMARY KEY ("matchId","playerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScoringConfig_sportId_format_key" ON "ScoringConfig"("sportId", "format");

-- AddForeignKey
ALTER TABLE "ScoringConfig" ADD CONSTRAINT "ScoringConfig_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchLiveState" ADD CONSTRAINT "MatchLiveState_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMatchPoints" ADD CONSTRAINT "PlayerMatchPoints_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerMatchPoints" ADD CONSTRAINT "PlayerMatchPoints_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
