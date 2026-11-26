-- Additive shadow storage. KanbanDocument remains authoritative.
-- Apply transactionally so legacy writes never see a partially installed fence.
BEGIN;

CREATE TABLE "KanbanBoardIdentity" (
  "boardKey" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "id" TEXT NOT NULL
);

CREATE UNIQUE INDEX "KanbanBoardIdentity_ownerId_id_key" ON "KanbanBoardIdentity" ("ownerId", "id");

CREATE UNIQUE INDEX "KanbanBoardIdentity_boardKey_ownerId_id_key" ON "KanbanBoardIdentity" ("boardKey", "ownerId", "id");

CREATE UNIQUE INDEX "KanbanBoardIdentity_boardKey_ownerId_key" ON "KanbanBoardIdentity" ("boardKey", "ownerId");

CREATE TABLE "KanbanBoard" (
  "boardKey" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "theme" TEXT NOT NULL,
  "wallpaper" TEXT NOT NULL,
  "wallpaperBlur" BOOLEAN NOT NULL,
  "position" INTEGER NOT NULL,
  "metadataVersion" INTEGER NOT NULL DEFAULT 1,
  "listOrderVersion" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "cardCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "KanbanBoard_ownerId_id_key" ON "KanbanBoard" ("ownerId", "id");

CREATE INDEX "KanbanBoard_ownerId_position_idx" ON "KanbanBoard" ("ownerId", "position");

CREATE TABLE "KanbanList" (
  "boardKey" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "metadataVersion" INTEGER NOT NULL DEFAULT 1,
  "orderVersion" INTEGER NOT NULL DEFAULT 1,
  "cardCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("boardKey", "id")
);

CREATE INDEX "KanbanList_boardKey_position_idx" ON "KanbanList" ("boardKey", "position");

CREATE TABLE "KanbanCard" (
  "boardKey" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "listId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "dueDate" TEXT NOT NULL,
  "color" TEXT,
  "contentVersion" INTEGER NOT NULL DEFAULT 1,
  "placementVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("boardKey", "id")
);

CREATE INDEX "KanbanCard_boardKey_listId_position_idx" ON "KanbanCard" ("boardKey", "listId", "position");

CREATE TABLE "KanbanProfile" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "activeBoardKey" TEXT NOT NULL,
  "boardOrderVersion" INTEGER NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "KanbanTransition" (
  "ownerId" TEXT NOT NULL PRIMARY KEY,
  "storageMode" TEXT NOT NULL DEFAULT 'legacy',
  "migrationEpoch" INTEGER NOT NULL DEFAULT 1,
  "sourceRevision" INTEGER,
  "sourceDigest" TEXT,
  "sourceDocument" JSONB,
  "evidence" JSONB,
  "verifiedAt" TIMESTAMP(3)
);

CREATE TABLE "KanbanRollbackSnapshot" (
  "ownerId" TEXT NOT NULL PRIMARY KEY,
  "document" JSONB NOT NULL,
  "compatibilityRevision" INTEGER NOT NULL,
  "checkpoint" JSONB NOT NULL,
  "digest" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "KanbanBoard" ADD CONSTRAINT "KanbanBoard_boardKey_ownerId_id_fkey"
  FOREIGN KEY ("boardKey", "ownerId", "id") REFERENCES "KanbanBoardIdentity" ("boardKey", "ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KanbanList" ADD CONSTRAINT "KanbanList_boardKey_fkey"
  FOREIGN KEY ("boardKey") REFERENCES "KanbanBoard" ("boardKey") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KanbanCard" ADD CONSTRAINT "KanbanCard_boardKey_listId_fkey"
  FOREIGN KEY ("boardKey", "listId") REFERENCES "KanbanList" ("boardKey", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KanbanProfile" ADD CONSTRAINT "KanbanProfile_activeBoardKey_userId_fkey"
  FOREIGN KEY ("activeBoardKey", "userId") REFERENCES "KanbanBoardIdentity" ("boardKey", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KanbanBoard" ADD CHECK ("position" >= 0 AND "cardCount" >= 0 AND "metadataVersion" > 0 AND "listOrderVersion" > 0 AND "revision" > 0);
ALTER TABLE "KanbanList" ADD CHECK ("position" >= 0 AND "cardCount" >= 0 AND "metadataVersion" > 0 AND "orderVersion" > 0);
ALTER TABLE "KanbanCard" ADD CHECK ("position" >= 0 AND "contentVersion" > 0 AND "placementVersion" > 0);
ALTER TABLE "KanbanProfile" ADD CHECK ("version" > 0 AND "boardOrderVersion" > 0);
ALTER TABLE "KanbanTransition" ADD CHECK ("storageMode" IN ('legacy', 'modular', 'paused') AND "migrationEpoch" > 0);
ALTER TABLE "KanbanRollbackSnapshot" ADD CHECK ("compatibilityRevision" > 0);

-- Every old binary passes this fence, including INSERT into a missing document.
-- Use the same owner advisory lock in backfill/final verification. Do not also
-- lock the document row: an UPDATE can already hold it while awaiting this lock.
CREATE FUNCTION kanban_legacy_write_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner_id TEXT;
  storage_mode TEXT;
BEGIN
  -- A repeatable-read snapshot could predate an authority switch even after
  -- acquiring the lock. Existing Prisma writers use READ COMMITTED.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'kanban_legacy_requires_read_committed' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    RAISE EXCEPTION 'kanban_owner_change_forbidden';
  END IF;
  IF TG_OP = 'DELETE' THEN owner_id := OLD."userId";
  ELSE owner_id := NEW."userId"; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('openkanban:' || TG_TABLE_SCHEMA || ':' || owner_id, 0));
  EXECUTE format('SELECT "storageMode" FROM %I."KanbanTransition" WHERE "ownerId" = $1', TG_TABLE_SCHEMA)
    INTO storage_mode USING owner_id;
  IF storage_mode IS NOT NULL AND storage_mode <> 'legacy' THEN
    RAISE EXCEPTION 'kanban_upgrade_required' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER kanban_legacy_write_fence BEFORE INSERT OR UPDATE OR DELETE
ON "KanbanDocument" FOR EACH ROW EXECUTE FUNCTION kanban_legacy_write_fence();

COMMIT;
