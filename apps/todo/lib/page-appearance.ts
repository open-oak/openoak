import type { ListItem, UserSettings } from "./types";
import { getBackgroundWithStaticBlur, parseBackground } from "./utils";

export type PageAppearance = { wallpaper: string | null; theme: string | null };

const SMART_PAGES = {
  "/": { theme: "myDayTheme", background: "myDayBg", fallbackTheme: "blue" },
  "/important": { theme: "importantTheme", background: "importantBg", fallbackTheme: "coral" },
  "/planned": { theme: "plannedTheme", background: "plannedBg", fallbackTheme: "green" },
  "/tasks": { theme: "tasksTheme", background: "tasksBg", fallbackTheme: "default" },
} as const satisfies Record<string, { theme: keyof UserSettings; background: keyof UserSettings; fallbackTheme: string }>;

function appearance(rawBackground: string | null | undefined, themeValue: string): PageAppearance {
  const { bg, blur } = parseBackground(rawBackground);
  const hasWallpaper = Boolean(bg) && bg !== "none";
  return {
    wallpaper: hasWallpaper ? getBackgroundWithStaticBlur(bg, blur) : null,
    theme: themeValue !== "default" ? themeValue : null,
  };
}

// The wallpaper and theme a page sets once it renders on the client. It must
// match SmartListPage and ListPageLayout, so the server HTML can show the same
// background before hydration. Returns null when the page is not known yet.
export function pageAppearance(
  pathname: string,
  lists: readonly ListItem[],
  settings: UserSettings,
): PageAppearance | null {
  if (pathname in SMART_PAGES) {
    const page = SMART_PAGES[pathname as keyof typeof SMART_PAGES];
    return appearance(settings[page.background], settings[page.theme] || page.fallbackTheme);
  }
  if (pathname.startsWith("/lists/")) {
    const list = lists.find((candidate) => candidate.id === pathname.split("/")[2]);
    return list ? appearance(list.backgroundImage, list.themeColor || "default") : null;
  }
  return null;
}
