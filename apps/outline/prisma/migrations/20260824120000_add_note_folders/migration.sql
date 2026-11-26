CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Note" ADD COLUMN "folderId" TEXT;

CREATE UNIQUE INDEX "Folder_ownerId_nameKey_key" ON "Folder"("ownerId", "nameKey");
CREATE INDEX "Folder_ownerId_name_idx" ON "Folder"("ownerId", "name");
CREATE INDEX "Note_ownerId_folderId_sortOrder_createdAt_idx" ON "Note"("ownerId", "folderId", "sortOrder", "createdAt");

ALTER TABLE "Folder" ADD CONSTRAINT "Folder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "NotesProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Note" ADD CONSTRAINT "Note_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
