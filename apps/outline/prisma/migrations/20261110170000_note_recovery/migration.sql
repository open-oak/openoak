CREATE TABLE "NoteTrash" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "noteId" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "ownerId" TEXT NOT NULL REFERENCES "NotesProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "folderId" TEXT REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "NoteTrash_ownerId_deletedAt_id_idx" ON "NoteTrash"("ownerId", "deletedAt", "id");
