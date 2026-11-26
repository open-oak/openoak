"use client";

import { useState, useEffect } from "react";

function extractImageUrl(bgValue: string): string | null {
  const match = bgValue.match(/url\(['"]?([^'")\s]+)['"]?\)/);
  return match ? match[1] : null;
}

function toThumbUrl(imageUrl: string): string {
  return imageUrl.replace(/(\.[^.]+)$/, "-thumb$1");
}

const luminanceCache = new Map<string, "light" | "dark">();
const inflightCache = new Map<string, Promise<"light" | "dark" | null>>();

function measureLuminance(imageUrl: string): Promise<"light" | "dark" | null> {
  const existing = inflightCache.get(imageUrl);
  if (existing) return existing;

  const promise = new Promise<"light" | "dark" | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const SIZE = 50;
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
      let total = 0;
      const pixels = SIZE * SIZE;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        total += 0.299 * r + 0.587 * g + 0.114 * b;
      }
      resolve(total / pixels >= 0.5 ? "light" : "dark");
    };

    img.onerror = () => resolve(null);
    img.src = imageUrl;
  }).finally(() => {
    inflightCache.delete(imageUrl);
  });

  inflightCache.set(imageUrl, promise);
  return promise;
}

/**
 * Samples a wallpaper thumbnail using canvas to determine if it's light or dark.
 * Returns "light", "dark", or null (no wallpaper / still loading).
 */
export function useWallpaperLuminance(bgImage: string | undefined | null): "light" | "dark" | null {
  const [luminance, setLuminance] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    if (!bgImage || bgImage === "none") {
      const frame = requestAnimationFrame(() => setLuminance(null));
      return () => cancelAnimationFrame(frame);
    }

    const imageUrl = extractImageUrl(bgImage);
    if (!imageUrl) {
      const frame = requestAnimationFrame(() => setLuminance(null));
      return () => cancelAnimationFrame(frame);
    }

    const thumbUrl = toThumbUrl(imageUrl);
    const cached = luminanceCache.get(thumbUrl);
    if (cached) {
      const frame = requestAnimationFrame(() => setLuminance(cached));
      return () => cancelAnimationFrame(frame);
    }

    const frame = requestAnimationFrame(() => setLuminance(null));
    let cancelled = false;

    measureLuminance(thumbUrl).then((result) => {
      if (cancelled) return;
      if (result) luminanceCache.set(thumbUrl, result);
      setLuminance(result);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [bgImage]);

  return luminance;
}
