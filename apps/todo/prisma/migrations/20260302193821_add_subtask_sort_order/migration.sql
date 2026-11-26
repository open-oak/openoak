-- DropIndex
DROP INDEX "Subtask_taskId_createdAt_idx";

-- DropIndex
DROP INDEX "Task_listId_sortOrder_idx";

-- AlterTable
ALTER TABLE "Subtask" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Subtask_taskId_sortOrder_createdAt_idx" ON "Subtask"("taskId", "sortOrder", "createdAt");
