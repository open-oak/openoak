"use client";

import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { cn } from "@/lib/utils";
import type { AccentColor } from "@/lib/types";
import { WALLPAPER_CROSSFADE_MS } from "./constants";

export function Background({ theme, wallpaperImage }: { theme: AccentColor; wallpaperImage?: string }) {
  const [bottom, setBottom] = useState<string | undefined>(wallpaperImage);
  const [top, setTop] = useState<string | undefined>();
  const [showTop, setShowTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);
  const pendingRef = useRef<string | undefined>(wallpaperImage);
  const previousRef = useRef<string | undefined>(wallpaperImage);
  // Emits <link rel="preload"> during server rendering, so the first wallpaper
  // starts downloading with the page instead of after the CSS is applied.
  if (wallpaperImage) preload(wallpaperImage, { as: "image", fetchPriority: "high" });

  useEffect(() => {
    if (wallpaperImage === previousRef.current) return;
    previousRef.current = wallpaperImage;
    pendingRef.current = wallpaperImage;

    let cancelled = false;
    let frame = 0;
    const startTransition = () => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        if (wallpaperImage) {
          setTop(wallpaperImage);
          setShowTop(true);
          setFadeBottom(false);
        } else {
          setFadeBottom(true);
        }
      });
    };

    // Fade a wallpaper in only after its image is decoded. Otherwise the fade
    // runs on an empty layer and the image then appears at full opacity.
    if (wallpaperImage) {
      const image = new Image();
      image.src = wallpaperImage;
      image.decode().catch(() => {}).then(startTransition);
    } else {
      startTransition();
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [wallpaperImage]);

  const finishTopFade = () => {
    setBottom(pendingRef.current);
    setShowTop(false);
  };

  const finishBottomFade = () => {
    if (!pendingRef.current) setBottom(undefined);
    setFadeBottom(false);
  };

  const wallpaperClass = "absolute inset-0 bg-cover bg-center";

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="notes-theme-background absolute inset-0" data-theme={theme} />
      {bottom ? (
        <div
          className={wallpaperClass}
          onTransitionEnd={finishBottomFade}
          style={{
            backgroundImage: `url('${bottom}')`,
            opacity: fadeBottom ? 0 : 1,
            transition: `opacity ${WALLPAPER_CROSSFADE_MS}ms ease`,
          }}
        />
      ) : null}
      {showTop && top ? (
        <div
          className={cn(wallpaperClass, "animate-wallpaper-in")}
          onAnimationEnd={finishTopFade}
          style={{
            backgroundImage: `url('${top}')`,
            opacity: 1,
            animationDuration: `${WALLPAPER_CROSSFADE_MS}ms`,
          }}
        />
      ) : null}
    </div>
  );
}
