import type { SmartListType } from "./types";

const SMART_THEME_KEYS: Record<SmartListType, string> = {
  "my-day": "theme:smart:my-day",
  important: "theme:smart:important",
  planned: "theme:smart:planned",
  tasks: "theme:smart:tasks",
};

const LAST_THEME_KEY = "theme:last";

export function getThemeCacheKey(params: {
  smartListType?: SmartListType;
  listId?: string;
}): string | null {
  if (params.listId) return `theme:list:${params.listId}`;
  if (params.smartListType) return SMART_THEME_KEYS[params.smartListType];
  return null;
}

export function getThemeCacheKeyFromPathname(pathname: string): string | null {
  if (pathname === "/") return SMART_THEME_KEYS["my-day"];
  if (pathname === "/important") return SMART_THEME_KEYS.important;
  if (pathname === "/planned") return SMART_THEME_KEYS.planned;
  if (pathname === "/tasks") return SMART_THEME_KEYS.tasks;

  if (pathname.startsWith("/lists/")) {
    const listId = pathname.split("/")[2];
    if (listId) return `theme:list:${listId}`;
  }

  return null;
}

export function getLastThemeCacheKey(): string {
  return LAST_THEME_KEY;
}
