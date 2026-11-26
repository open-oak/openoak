-- List indexes
CREATE INDEX IF NOT EXISTS "List_ownerId_sortOrder_createdAt_idx" ON "List"("ownerId", "sortOrder", "createdAt");
CREATE INDEX IF NOT EXISTS "List_ownerId_name_idx" ON "List"("ownerId", "name");

-- Task indexes
CREATE INDEX IF NOT EXISTS "Task_userId_isMyDay_isCompleted_idx" ON "Task"("userId", "isMyDay", "isCompleted");
CREATE INDEX IF NOT EXISTS "Task_userId_isImportant_isCompleted_idx" ON "Task"("userId", "isImportant", "isCompleted");
CREATE INDEX IF NOT EXISTS "Task_userId_dueDate_isCompleted_idx" ON "Task"("userId", "dueDate", "isCompleted");
CREATE INDEX IF NOT EXISTS "Task_userId_listId_isCompleted_idx" ON "Task"("userId", "listId", "isCompleted");
CREATE INDEX IF NOT EXISTS "Task_userId_listId_sortOrder_createdAt_idx" ON "Task"("userId", "listId", "sortOrder", "createdAt");
CREATE INDEX IF NOT EXISTS "Task_listId_sortOrder_idx" ON "Task"("listId", "sortOrder");

-- Subtask indexes
CREATE INDEX IF NOT EXISTS "Subtask_taskId_createdAt_idx" ON "Subtask"("taskId", "createdAt");
