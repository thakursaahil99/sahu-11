/*
  Warnings:

  - Added the required column `sideTeamId` to the `UserTeamPlayer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "UserTeamPlayer" ADD COLUMN     "sideTeamId" TEXT NOT NULL;
