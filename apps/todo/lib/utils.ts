import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function normalizeWallpaperBackground(bg: string): string {
  return bg.replace(
    /url\((['"]?)(\/(?:10|[1-9]))\.jpe?g\1\)/gi,
    (_match, quote: string, path: string) => `url(${quote}${path}.webp${quote})`,
  );
}

export function parseBackground(raw: string | null | undefined): { bg: string; blur: number } {
  if (!raw) return { bg: "", blur: 0 };

  const parts = raw.split("::");
  if (parts.length === 1) {
    return { bg: normalizeWallpaperBackground(raw), blur: 0 };
  }

  const blurIndex = parts.findLastIndex((part, index) => index > 0 && /^\d+$/.test(part));
  if (blurIndex === -1) {
    return { bg: normalizeWallpaperBackground(parts[0]), blur: 0 };
  }

  return {
    bg: normalizeWallpaperBackground(parts.slice(0, blurIndex).join("::")),
    blur: parseInt(parts[blurIndex], 10) || 0,
  };
}

export function getBackgroundWithStaticBlur(bg: string, blur: number): string {
  if (!bg || bg === "none") return "";

  let resolved = bg;

  if (blur > 0) {
    const wallpaperMatch = bg.match(/url\((['"]?)(\/(\d+)\.(?:jpe?g|webp))\1\)/i);
    if (wallpaperMatch) {
      const originalPath = wallpaperMatch[2];
      const wallpaperId = wallpaperMatch[3];
      resolved = bg.replace(originalPath, `/${wallpaperId}-blur50.webp`);
    }
  }

  return resolved;
}

export function encodeBackground(bg: string, blur: number): string {
  if (!bg) return "";
  return blur > 0 ? `${bg}::${blur}` : bg;
}
