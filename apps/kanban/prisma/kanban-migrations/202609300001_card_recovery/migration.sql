CREATE TABLE "KanbanCardTrash" (
  "boardKey" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "listId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "dueDate" TEXT NOT NULL,
  "color" TEXT,
  "contentVersion" INTEGER NOT NULL,
  "placementVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletionId" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  CONSTRAINT "KanbanCardTrash_pkey" PRIMARY KEY ("boardKey", "id"),
  CONSTRAINT "KanbanCardTrash_boardKey_fkey" FOREIGN KEY ("boardKey") REFERENCES "KanbanBoard"("boardKey") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "KanbanCardTrash_boardKey_deletedAt_id_idx" ON "KanbanCardTrash"("boardKey", "deletedAt", "id");

-- Capture old and new modular writers throughout a rolling deployment.
-- Legacy shadow rebuilds remain projections of their authoritative document.
CREATE FUNCTION kanban_preserve_deleted_card() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "KanbanBoard" b JOIN "KanbanTransition" t ON t."ownerId"=b."ownerId" WHERE b."boardKey"=OLD."boardKey" AND t."storageMode"='modular') THEN
    INSERT INTO "KanbanCardTrash" ("boardKey","id","listId","position","title","description","dueDate","color","contentVersion","placementVersion","createdAt","updatedAt")
    VALUES (OLD."boardKey",OLD."id",OLD."listId",OLD."position",OLD."title",OLD."description",OLD."dueDate",OLD."color",OLD."contentVersion",OLD."placementVersion",OLD."createdAt",OLD."updatedAt");
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER kanban_preserve_deleted_card BEFORE DELETE ON "KanbanCard" FOR EACH ROW EXECUTE FUNCTION kanban_preserve_deleted_card();
