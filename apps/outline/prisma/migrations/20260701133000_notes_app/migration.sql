CREATE TABLE "NotesProfile" (
    "id" TEXT NOT NULL,
    "colorMode" TEXT NOT NULL DEFAULT 'auto',
    "accentColor" TEXT NOT NULL DEFAULT 'green',
    "wallpaper" TEXT NOT NULL DEFAULT 'wp1',
    "wallpaperBlur" BOOLEAN NOT NULL DEFAULT true,
    "glassEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sidebarTransparent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotesProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT 'green',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Note_ownerId_sortOrder_createdAt_idx" ON "Note"("ownerId", "sortOrder", "createdAt");
CREATE INDEX "Note_ownerId_updatedAt_idx" ON "Note"("ownerId", "updatedAt");

ALTER TABLE "Note" ADD CONSTRAINT "Note_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "NotesProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
