CREATE TABLE "TaskTrash" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL UNIQUE,
  "listId" TEXT NOT NULL REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdById" TEXT NOT NULL REFERENCES "TodoProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "title" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "TaskTrash_listId_deletedAt_id_idx" ON "TaskTrash"("listId", "deletedAt", "id");
