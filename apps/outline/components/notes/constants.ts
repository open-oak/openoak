import type { AccentColor, WallpaperId } from "@/lib/types";

export const ACCENTS: Array<{ id: AccentColor; label: string; main: string; soft: string; text: string }> = [
  { id: "default", label: "Default", main: "var(--primary)", soft: "color-mix(in oklab, var(--primary) 22%, var(--background))", text: "var(--primary-foreground)" },
  { id: "green", label: "Green", main: "#2f6f4d", soft: "#cfe5d4", text: "#f6f3ee" },
  { id: "blue", label: "Blue", main: "#326f96", soft: "#cce2f0", text: "#f6f3ee" },
  { id: "purple", label: "Purple", main: "#6f5aa7", soft: "#ded7f3", text: "#f6f3ee" },
  { id: "coral", label: "Coral", main: "#bd6653", soft: "#f2d1c8", text: "#fff7ef" },
  { id: "gold", label: "Gold", main: "#b7791f", soft: "#f1dfaa", text: "#fff8e8" },
];

export const WALLPAPERS: Array<{ id: WallpaperId; label: string; image?: string; thumb?: string }> = [
  { id: "none", label: "None" },
  { id: "wp1", label: "Misty Mountains", image: "/1.webp", thumb: "/1-thumb.webp" },
  { id: "wp2", label: "Palms", image: "/2.webp", thumb: "/2-thumb.webp" },
  { id: "wp3", label: "Mountain Range", image: "/3.webp", thumb: "/3-thumb.webp" },
  { id: "wp4", label: "Canyon", image: "/4.webp", thumb: "/4-thumb.webp" },
  { id: "wp5", label: "Ferns", image: "/5.webp", thumb: "/5-thumb.webp" },
  { id: "wp6", label: "Sunlit Hillside", image: "/6.webp", thumb: "/6-thumb.webp" },
  { id: "wp7", label: "Forest Lake", image: "/7.webp", thumb: "/7-thumb.webp" },
  { id: "wp8", label: "Mountain Lake", image: "/8.webp", thumb: "/8-thumb.webp" },
  { id: "wp9", label: "Foggy Mountain", image: "/9.webp", thumb: "/9-thumb.webp" },
  { id: "wp10", label: "Painted Cats", image: "/10.webp", thumb: "/10-thumb.webp" },
];

export const EMPTY_NOTE_BODY = "";
export const SAVE_DELAY_MS = 650;
export const WALLPAPER_CROSSFADE_MS = 220;
export const COLOR_MODE_STORAGE_KEY = "open-outline-mode";
export const SIDEBAR_STORAGE_KEY = "open-outline-sidebar-collapsed";

export const LICENSES = [
  { name: "Next.js", license: "MIT", author: "Vercel, Inc." },
  { name: "React", license: "MIT", author: "Meta Platforms, Inc." },
  { name: "Tailwind CSS", license: "MIT", author: "Tailwind Labs, Inc." },
  { name: "Prisma", license: "Apache 2.0", author: "Prisma Data, Inc." },
  { name: "Better Auth", license: "MIT", author: "Better Auth" },
  { name: "Radix UI", license: "MIT", author: "WorkOS" },
  { name: "shadcn/ui", license: "MIT", author: "shadcn" },
  { name: "lucide-react", license: "ISC", author: "Lucide Contributors" },
];

export function getAccent(id: AccentColor) {
  return ACCENTS.find((accent) => accent.id === id) ?? ACCENTS[0];
}

export function getWallpaper(id: WallpaperId) {
  return WALLPAPERS.find((wallpaper) => wallpaper.id === id) ?? WALLPAPERS[1];
}

export function getWallpaperImage(id: WallpaperId, blurred: boolean) {
  const wallpaper = getWallpaper(id);
  if (!wallpaper.image || !blurred) return wallpaper.image;
  return wallpaper.image.replace(/\/(\d+)\.webp$/, "/$1-blur50.webp");
}
