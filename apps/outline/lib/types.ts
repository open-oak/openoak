export type ColorMode = "auto" | "light" | "dark";
export type AccentColor = "default" | "green" | "blue" | "purple" | "coral" | "gold";
export type WallpaperId = "none" | "wp1" | "wp2" | "wp3" | "wp4" | "wp5" | "wp6" | "wp7" | "wp8" | "wp9" | "wp10";

export interface FolderItem {
  id: string;
  name: string;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteItem {
  id: string;
  title: string;
  /** Null in list metadata; populated only for the active editor note. */
  body: string | null;
  /** Short plain-text preview available in list metadata. */
  excerpt: string;
  color: AccentColor;
  sortOrder: number;
  folderId: string | null;
  folderName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotesPage {
  items: NoteItem[];
  totalCount: number;
  nextCursor: string | null;
  folders: FolderItem[];
  unfiledCount: number;
  allNotesCount: number;
}

export interface NotesSettings {
  id: string;
  colorMode: ColorMode;
  accentColor: AccentColor;
  wallpaper: WallpaperId;
  wallpaperBlur: boolean;
  glassEnabled: boolean;
  sidebarTransparent: boolean;
}

export interface NotesAppData {
  name: string | null;
  email: string | null;
  settings: NotesSettings;
  folders: FolderItem[];
  unfiledCount: number;
  notes: NoteItem[];
  selectedNote: NoteItem | null;
  totalCount: number;
  nextCursor: string | null;
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };
