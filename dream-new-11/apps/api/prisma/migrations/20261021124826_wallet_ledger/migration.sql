-- CreateEnum
CREATE TYPE "WalletCurrency" AS ENUM ('DEMO', 'INR');

-- CreateEnum
CREATE TYPE "WalletBucket" AS ENUM ('DEPOSITED', 'WINNINGS', 'BONUS');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'CONTEST_ENTRY', 'CONTEST_WINNING', 'REFUND', 'BONUS', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "WalletAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "code" TEXT NOT NULL,
    "currency" "WalletCurrency" NOT NULL,

    CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TxType" NOT NULL,
    "status" "TxStatus" NOT NULL,
    "currency" "WalletCurrency" NOT NULL,
    "amountX100" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reference" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bucket" "WalletBucket" NOT NULL,
    "amountX100" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycRecord" (
    "userId" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "fullName" TEXT NOT NULL,
    "panMasked" TEXT NOT NULL,
    "panHash" TEXT NOT NULL,
    "reviewNote" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "KycRecord_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "WalletAccount_code_currency_idx" ON "WalletAccount"("code", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAccount_userId_code_currency_key" ON "WalletAccount"("userId", "code", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletTransaction_userId_createdAt_idx" ON "WalletTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_reference_idx" ON "WalletTransaction"("reference");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_bucket_idx" ON "LedgerEntry"("accountId", "bucket");

-- CreateIndex
CREATE INDEX "KycRecord_panHash_idx" ON "KycRecord"("panHash");

-- AddForeignKey
ALTER TABLE "WalletAccount" ADD CONSTRAINT "WalletAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "WalletTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycRecord" ADD CONSTRAINT "KycRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A user transaction can never be booked twice for the same real-world event (unique key above),
-- and ledger lines are append-only: block updates and deletes at the database level.
CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
