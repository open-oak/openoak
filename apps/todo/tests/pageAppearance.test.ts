import { describe, expect, it } from "vitest";
import { pageAppearance } from "@/lib/page-appearance";
import type { ListItem, UserSettings } from "@/lib/types";

const settings = {
  id: "user-1",
  themeColor: null,
  myDayTheme: null,
  importantTheme: "purple",
  plannedTheme: null,
  tasksTheme: null,
  myDayBg: "url('/5.webp') center/cover no-repeat::1",
  importantBg: null,
  plannedBg: "none",
  tasksBg: null,
} as UserSettings;

const lists = [
  { id: "list-1", themeColor: "green", backgroundImage: "url('/3.webp') center/cover no-repeat" },
  { id: "list-2", themeColor: null, backgroundImage: null },
] as ListItem[];

describe("initial page appearance", () => {
  it("matches the smart list theme fallbacks and blurred wallpapers", () => {
    expect(pageAppearance("/", lists, settings)).toEqual({
      wallpaper: "url('/5-blur50.webp') center/cover no-repeat",
      theme: "blue",
    });
    expect(pageAppearance("/important", lists, settings)).toEqual({ wallpaper: null, theme: "purple" });
    expect(pageAppearance("/planned", lists, settings)).toEqual({ wallpaper: null, theme: "green" });
    expect(pageAppearance("/tasks", lists, settings)).toEqual({ wallpaper: null, theme: null });
  });

  it("uses the list's own appearance and the default theme", () => {
    expect(pageAppearance("/lists/list-1", lists, settings)).toEqual({
      wallpaper: "url('/3.webp') center/cover no-repeat",
      theme: "green",
    });
    expect(pageAppearance("/lists/list-2", lists, settings)).toEqual({ wallpaper: null, theme: null });
  });

  it("returns null for pages it cannot resolve", () => {
    expect(pageAppearance("/lists/missing", lists, settings)).toBeNull();
    expect(pageAppearance("/invite/abc", lists, settings)).toBeNull();
  });
});
