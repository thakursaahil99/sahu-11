-- CreateTable
CREATE TABLE "FantasyConfig" (
    "sportId" TEXT NOT NULL,
    "teamSize" INTEGER NOT NULL DEFAULT 11,
    "maxCreditsX10" INTEGER NOT NULL DEFAULT 1000,
    "maxPerTeam" INTEGER NOT NULL DEFAULT 7,
    "minWk" INTEGER NOT NULL DEFAULT 1,
    "maxWk" INTEGER NOT NULL DEFAULT 4,
    "minBat" INTEGER NOT NULL DEFAULT 3,
    "maxBat" INTEGER NOT NULL DEFAULT 6,
    "minAr" INTEGER NOT NULL DEFAULT 1,
    "maxAr" INTEGER NOT NULL DEFAULT 4,
    "minBowl" INTEGER NOT NULL DEFAULT 3,
    "maxBowl" INTEGER NOT NULL DEFAULT 6,
    "maxTeamsPerMatch" INTEGER NOT NULL DEFAULT 6,
    "captainMultiplierX100" INTEGER NOT NULL DEFAULT 200,
    "viceCaptainMultiplierX100" INTEGER NOT NULL DEFAULT 150,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasyConfig_pkey" PRIMARY KEY ("sportId")
);

-- CreateTable
CREATE TABLE "UserTeam" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamNumber" INTEGER NOT NULL,
    "captainId" TEXT NOT NULL,
    "viceCaptainId" TEXT NOT NULL,
    "creditsX10" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTeamPlayer" (
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "role" "PlayerRole" NOT NULL,
    "creditsX10" INTEGER NOT NULL,

    CONSTRAINT "UserTeamPlayer_pkey" PRIMARY KEY ("teamId","playerId")
);

-- CreateIndex
CREATE INDEX "UserTeam_matchId_idx" ON "UserTeam"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTeam_userId_matchId_teamNumber_key" ON "UserTeam"("userId", "matchId", "teamNumber");

-- CreateIndex
CREATE UNIQUE INDEX "UserTeam_userId_matchId_signature_key" ON "UserTeam"("userId", "matchId", "signature");

-- CreateIndex
CREATE INDEX "UserTeamPlayer_playerId_idx" ON "UserTeamPlayer"("playerId");

-- AddForeignKey
ALTER TABLE "FantasyConfig" ADD CONSTRAINT "FantasyConfig_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeam" ADD CONSTRAINT "UserTeam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeam" ADD CONSTRAINT "UserTeam_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeam" ADD CONSTRAINT "UserTeam_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeam" ADD CONSTRAINT "UserTeam_viceCaptainId_fkey" FOREIGN KEY ("viceCaptainId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeamPlayer" ADD CONSTRAINT "UserTeamPlayer_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "UserTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTeamPlayer" ADD CONSTRAINT "UserTeamPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
