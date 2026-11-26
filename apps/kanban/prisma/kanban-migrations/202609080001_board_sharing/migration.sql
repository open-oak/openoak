BEGIN;
ALTER TABLE "KanbanBoard" ADD COLUMN "inviteNonce" TEXT;
CREATE UNIQUE INDEX "KanbanBoard_inviteNonce_key" ON "KanbanBoard"("inviteNonce");
CREATE TABLE "KanbanBoardMember" (
  "boardKey" TEXT NOT NULL REFERENCES "KanbanBoard"("boardKey") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("boardKey", "userId")
);
CREATE INDEX "KanbanBoardMember_userId_boardKey_idx" ON "KanbanBoardMember"("userId", "boardKey");
-- Keep the owned active identity for legacy recovery. Shared navigation is personal.
ALTER TABLE "KanbanProfile" ADD COLUMN "selectedBoardKey" TEXT REFERENCES "KanbanBoardIdentity"("boardKey") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
