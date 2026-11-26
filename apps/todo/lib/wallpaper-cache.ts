import type { SmartListType } from "./types";

const LAST_WALLPAPER_KEY = "wallpaper:last";

const SMART_CACHE_KEYS: Record<SmartListType, string> = {
  "my-day": "wallpaper:smart:my-day",
  important: "wallpaper:smart:important",
  planned: "wallpaper:smart:planned",
  tasks: "wallpaper:smart:tasks",
};

export function getWallpaperCacheKey(params: {
  smartListType?: SmartListType;
  listId?: string;
}): string | null {
  if (params.listId) return `wallpaper:list:${params.listId}`;
  if (params.smartListType) return SMART_CACHE_KEYS[params.smartListType];
  return null;
}

export function getWallpaperCacheKeyFromPathname(pathname: string): string | null {
  if (pathname === "/") return SMART_CACHE_KEYS["my-day"];
  if (pathname === "/important") return SMART_CACHE_KEYS.important;
  if (pathname === "/planned") return SMART_CACHE_KEYS.planned;
  if (pathname === "/tasks") return SMART_CACHE_KEYS.tasks;

  if (pathname.startsWith("/lists/")) {
    const listId = pathname.split("/")[2];
    if (listId) return `wallpaper:list:${listId}`;
  }

  return null;
}

export function getLastWallpaperCacheKey(): string {
  return LAST_WALLPAPER_KEY;
}
