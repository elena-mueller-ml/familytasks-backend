-- AlterTable
ALTER TABLE "families" ADD COLUMN     "doubleStarActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "doubleStarActiveDate" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "doubleStarDays" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "currentStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastStreakDate" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "streakFreezes" INTEGER NOT NULL DEFAULT 0;
