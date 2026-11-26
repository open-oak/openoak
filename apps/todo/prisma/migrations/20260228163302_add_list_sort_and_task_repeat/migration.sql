-- AlterTable
ALTER TABLE "List" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "repeatInterval" TEXT;
