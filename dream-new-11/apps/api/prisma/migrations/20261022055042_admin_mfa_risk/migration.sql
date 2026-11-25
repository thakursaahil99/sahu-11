-- CreateEnum
CREATE TYPE "RiskKind" AS ENUM ('MULTI_ACCOUNT_IP', 'RAPID_DEPOSITS', 'QUICK_WITHDRAWAL', 'PAN_REUSE');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'DISMISSED', 'ACTIONED');

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "mfa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'app';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN     "mfaLastStep" INTEGER,
ADD COLUMN     "mfaSecret" TEXT;

-- CreateTable
CREATE TABLE "RiskFlag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "RiskKind" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "audience" TEXT NOT NULL,
    "promotional" BOOLEAN NOT NULL DEFAULT false,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RiskFlag_status_createdAt_idx" ON "RiskFlag"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskFlag_userId_kind_dedupeKey_key" ON "RiskFlag"("userId", "kind", "dedupeKey");

-- CreateIndex
CREATE INDEX "Announcement_createdAt_idx" ON "Announcement"("createdAt");

-- AddForeignKey
ALTER TABLE "RiskFlag" ADD CONSTRAINT "RiskFlag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
