/*
  Warnings:

  - The primary key for the `Event` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `metadataHash` to the `Achievement` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Achievement" DROP CONSTRAINT "Achievement_eventId_fkey";

-- DropForeignKey
ALTER TABLE "EventParticipation" DROP CONSTRAINT "EventParticipation_eventId_fkey";

-- AlterTable
ALTER TABLE "Achievement" ADD COLUMN     "metadataHash" VARCHAR(66) NOT NULL,
ADD COLUMN     "tier" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "eventId" SET DATA TYPE VARCHAR(66);

-- AlterTable
ALTER TABLE "Event" DROP CONSTRAINT "Event_pkey",
ALTER COLUMN "eventId" SET DATA TYPE VARCHAR(66),
ADD CONSTRAINT "Event_pkey" PRIMARY KEY ("eventId");

-- AlterTable
ALTER TABLE "EventParticipation" ALTER COLUMN "eventId" SET DATA TYPE VARCHAR(66);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "longestStreakDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "onchainNonce" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "EventParticipation" ADD CONSTRAINT "EventParticipation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("eventId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("eventId") ON DELETE RESTRICT ON UPDATE CASCADE;
