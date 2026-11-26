import type { BoardTheme, BoardWallpaper, ListColorId, ListIconId } from "@/lib/kanban-data";

export type ThemeId = BoardTheme;
export type WallpaperId = BoardWallpaper;
export type ColorMode = "auto" | "light" | "dark";
export type SyncStatus = "loading" | "saving" | "synced" | "offline" | "conflict";

export const LEGACY_STORAGE_KEY = "open-kanban-cards";
export const BOARDS_KEY = "open-kanban-boards";
export const ACTIVE_BOARD_KEY = "open-kanban-active-board";
export const THEME_KEY = "open-kanban-theme";
export const MODE_KEY = "open-kanban-mode";
export const GLASS_KEY = "open-kanban-glass";
export const WALLPAPER_KEY = "open-kanban-wallpaper";
export const WALLPAPER_BLUR_KEY = "open-kanban-wallpaper-blur";
export const SIDEBAR_KEY = "open-kanban-sidebar";
export const OFFLINE_QUEUE_KEY_PREFIX = "open-kanban-offline-operations";

export const themeIds: ThemeId[] = ["default", "blue", "purple", "coral", "green", "gold"];
export const wallpaperIds: WallpaperId[] = ["none", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

export const licenses = [
  { name: "Next.js", version: "16.1.6", license: "MIT", author: "Vercel, Inc." },
  { name: "React", version: "19.2.3", license: "MIT", author: "Meta Platforms, Inc." },
  { name: "Tailwind CSS", version: "4.x", license: "MIT", author: "Tailwind Labs, Inc." },
  { name: "Prisma", version: "7.5.0", license: "Apache 2.0", author: "Prisma Data, Inc." },
  { name: "Better Auth", version: "1.5.4", license: "MIT", author: "Better Auth" },
  { name: "lucide-react", version: "0.577.0", license: "ISC", author: "Lucide Contributors" },
  { name: "clsx", version: "2.x", license: "MIT", author: "Luke Edwards" },
  { name: "tailwind-merge", version: "3.5.0", license: "MIT", author: "Dany Castillo" },
];

export const themeOptions: { id: ThemeId; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "blue", label: "Blue" },
  { id: "purple", label: "Purple" },
  { id: "coral", label: "Coral" },
  { id: "green", label: "Green" },
  { id: "gold", label: "Gold" },
];

export const listColors: { id: ListColorId; label: string }[] = themeOptions;

export const listIcons: { id: ListIconId; label: string }[] = [
  { id: "circle", label: "Circle" },
  { id: "clock", label: "Clock" },
  { id: "check", label: "Check" },
  { id: "flag", label: "Flag" },
  { id: "briefcase", label: "Briefcase" },
  { id: "star", label: "Star" },
  { id: "calendar", label: "Calendar" },
  { id: "todo", label: "Todo" },
];

export const wallpaperOptions: { id: WallpaperId; label: string }[] = [
  { id: "none", label: "Theme" },
  { id: "1", label: "Misty Mountains" },
  { id: "2", label: "Palms" },
  { id: "3", label: "Mountain Range" },
  { id: "4", label: "Canyon" },
  { id: "5", label: "Ferns" },
  { id: "6", label: "Sunlit Hillside" },
  { id: "7", label: "Forest Lake" },
  { id: "8", label: "Mountain Lake" },
  { id: "9", label: "Foggy Mountain" },
  { id: "10", label: "Painted Cats" },
];
