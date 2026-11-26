ALTER TABLE "NotesProfile"
  ALTER COLUMN "accentColor" SET DEFAULT 'default',
  ALTER COLUMN "wallpaper" SET DEFAULT 'none',
  ALTER COLUMN "wallpaperBlur" SET DEFAULT false,
  ALTER COLUMN "glassEnabled" SET DEFAULT false;

ALTER TABLE "Note"
  ALTER COLUMN "color" SET DEFAULT 'default';
