/*
  Warnings:

  - You are about to drop the column `color` on the `List` table. All the data in the column will be lost.
  - You are about to drop the column `icon` on the `List` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "List" DROP COLUMN "color",
DROP COLUMN "icon",
ALTER COLUMN "themeColor" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "themeColor" DROP DEFAULT,
ALTER COLUMN "myDayTheme" DROP DEFAULT,
ALTER COLUMN "importantTheme" DROP DEFAULT,
ALTER COLUMN "plannedTheme" DROP DEFAULT,
ALTER COLUMN "tasksTheme" DROP DEFAULT;

-- Clean up stale hex defaults so the app-layer "default" fallback takes effect
UPDATE "User" SET "themeColor" = NULL WHERE "themeColor" = '#faf9f8';
UPDATE "User" SET "myDayTheme" = NULL WHERE "myDayTheme" = '#faf9f8';
UPDATE "User" SET "importantTheme" = NULL WHERE "importantTheme" = '#faf9f8';
UPDATE "User" SET "plannedTheme" = NULL WHERE "plannedTheme" = '#faf9f8';
UPDATE "User" SET "tasksTheme" = NULL WHERE "tasksTheme" = '#faf9f8';
UPDATE "List" SET "themeColor" = NULL WHERE "themeColor" = '#faf9f8';
