BEGIN;
ALTER TABLE "KanbanTransition" ADD COLUMN "compatibilityMirror" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "KanbanOperationReceipt" (
  "actorId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "boardKey" TEXT,
  "inputHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("actorId", "operationId")
);
-- Retain identities after deletion, so replay/deletion cannot permit ID reuse.
CREATE TABLE "KanbanEntityIdentity" (
  "boardKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  PRIMARY KEY ("boardKey", "kind", "id")
);
CREATE TABLE "KanbanChange" (
  "boardKey" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "deleted" BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY ("boardKey", "revision", "sequence"),
  CHECK ("revision" > 0 AND "sequence" >= 0)
);
INSERT INTO "KanbanEntityIdentity" ("boardKey","kind","id") SELECT "boardKey",'card',"id" FROM "KanbanCard";
INSERT INTO "KanbanEntityIdentity" ("boardKey","kind","id") SELECT "boardKey",'list',"id" FROM "KanbanList";
COMMIT;
