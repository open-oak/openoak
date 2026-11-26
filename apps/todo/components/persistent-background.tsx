"use client";

import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/store/app-store";
import { useInitialAppData } from "@/components/store-initializer";
import { pageAppearance } from "@/lib/page-appearance";

const CROSSFADE_DURATION = 200;
const THEME_FADE_DURATION = 220;

function wallpaperImageUrl(background: string): string | null {
  return background.match(/url\(['"]?([^'")\s]+)['"]?\)/)?.[1] ?? null;
}

export default function PersistentBackground() {
  const bg = useAppStore((s) => s.currentWallpaperBg);
  const pageTheme = useAppStore((s) => s.currentPageTheme);
  const initialData = useInitialAppData();
  const pathname = usePathname();

  // Start from the server data, so the initial HTML already shows the page's
  // wallpaper and theme. The client store is empty until hydration.
  const [initial] = useState(() =>
    initialData ? pageAppearance(pathname, initialData.lists, initialData.userSettings) : null,
  );
  const initialWallpaperUrl = initial?.wallpaper ? wallpaperImageUrl(initial.wallpaper) : null;
  if (initialWallpaperUrl) preload(initialWallpaperUrl, { as: "image", fetchPriority: "high" });

  const [baseTheme, setBaseTheme] = useState<string | null>(initial?.theme ?? null);
  const [incomingTheme, setIncomingTheme] = useState<string | null>(null);
  const [themeKey, setThemeKey] = useState(0);
  const [showIncomingTheme, setShowIncomingTheme] = useState(false);
  const [fadingOutBaseTheme, setFadingOutBaseTheme] = useState(false);

  // Bottom layer: committed wallpaper, always fully visible
  const [bottom, setBottom] = useState<string | null>(initial?.wallpaper ?? null);
  const [bottomFadeOut, setBottomFadeOut] = useState(false);
  // Top layer: incoming wallpaper, animates in from opacity 0 → 1
  const [topBg, setTopBg] = useState<string | null>(null);
  const [topKey, setTopKey] = useState(0);
  const [showTop, setShowTop] = useState(false);

  const prevBgRef = useRef<string | null>(initial?.wallpaper ?? null);
  const pendingRef = useRef<string | null>(initial?.wallpaper ?? null);
  const prevThemeRef = useRef<string | null>(initial?.theme ?? null);
  const pendingThemeRef = useRef<string | null>(initial?.theme ?? null);
  const themeFadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // undefined: no page has set a wallpaper yet, so keep the initial one.
    if (bg === undefined || bg === prevBgRef.current) return;
    prevBgRef.current = bg;
    pendingRef.current = bg;

    let cancelled = false;
    let frame = 0;
    const startTransition = () => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        if (bg === null) {
          // Transitioning to a color (no wallpaper): fade out the old wallpaper
          setBottomFadeOut(true);
        } else {
          // Transitioning to a new wallpaper: fade it in on top
          setTopBg(bg);
          setTopKey((k) => k + 1); // force remount so animation replays
          setShowTop(true);
        }
      });
    };

    // Fade a wallpaper in only after its image is decoded. Otherwise the fade
    // runs on an empty layer and the image then appears at full opacity.
    const imageUrl = bg ? wallpaperImageUrl(bg) : null;
    if (imageUrl) {
      const image = new Image();
      image.src = imageUrl;
      image.decode().catch(() => {}).then(startTransition);
    } else {
      startTransition();
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [bg]);

  useEffect(() => {
    if (pageTheme === undefined || pageTheme === prevThemeRef.current) return;
    if (themeFadeTimeoutRef.current) {
      clearTimeout(themeFadeTimeoutRef.current);
      themeFadeTimeoutRef.current = null;
    }

    const previousTheme = prevThemeRef.current;
    prevThemeRef.current = pageTheme;
    pendingThemeRef.current = pageTheme;

    if (pageTheme === null && previousTheme !== null) {
      queueMicrotask(() => {
        setShowIncomingTheme(false);
        setFadingOutBaseTheme(true);
      });
      themeFadeTimeoutRef.current = setTimeout(() => {
        setBaseTheme(null);
        setFadingOutBaseTheme(false);
        themeFadeTimeoutRef.current = null;
      }, THEME_FADE_DURATION);
      return;
    }

    queueMicrotask(() => {
      setFadingOutBaseTheme(false);
    });

    const frame = requestAnimationFrame(() => {
      setIncomingTheme(pageTheme);
      setThemeKey((k) => k + 1);
      setShowIncomingTheme(true);
    });

    return () => cancelAnimationFrame(frame);
  }, [pageTheme]);

  useEffect(() => {
    return () => {
      if (themeFadeTimeoutRef.current) {
        clearTimeout(themeFadeTimeoutRef.current);
      }
    };
  }, []);

  // Update root data-current-theme attribute for accent color switching
  useEffect(() => {
    if (pageTheme === undefined) return;
    if (pageTheme) {
      document.documentElement.setAttribute("data-current-theme", pageTheme);
    } else {
      document.documentElement.removeAttribute("data-current-theme");
    }
  }, [pageTheme]);

  const handleAnimationEnd = () => {
    setBottom(pendingRef.current);
    setShowTop(false);
  };

  const handleBottomTransitionEnd = () => {
    if (bottomFadeOut) {
      if (pendingRef.current === null) {
        setBottom(null);
      }
      setBottomFadeOut(false);
    }
  };

  const handleThemeAnimationEnd = () => {
    setBaseTheme(pendingThemeRef.current);
    setShowIncomingTheme(false);
  };

  return (
    <>
      {/* Base theme layer */}
      <div
        data-theme={baseTheme ?? undefined}
        className="fixed inset-0 pointer-events-none z-0 transition-opacity"
        style={{ opacity: fadingOutBaseTheme ? 0 : 1, transitionDuration: `${THEME_FADE_DURATION}ms` }}
      />
      {/* Incoming theme layer for smooth gradient crossfade */}
      {showIncomingTheme && (
        <div
          key={themeKey}
          data-theme={incomingTheme ?? undefined}
          className="fixed inset-0 pointer-events-none z-0 animate-in fade-in"
          style={{ animationDuration: `${THEME_FADE_DURATION}ms` }}
          onAnimationEnd={handleThemeAnimationEnd}
        />
      )}
      {/* Always-visible base layer — holds the last committed wallpaper */}
      <div
        className="fixed inset-0 pointer-events-none z-0 transition-opacity"
        style={{
          background: bottom ?? undefined,
          opacity: bottomFadeOut ? 0 : 1,
          transitionDuration: `${CROSSFADE_DURATION}ms`,
        }}
        onTransitionEnd={handleBottomTransitionEnd}
      />
      {/* Incoming layer — fades in via CSS animation, then commits to bottom */}
      {showTop && (
        <div
          key={topKey}
          className="fixed inset-0 pointer-events-none animate-in fade-in"
          style={{ background: topBg ?? undefined, zIndex: 1, animationDuration: `${CROSSFADE_DURATION}ms` }}
          onAnimationEnd={handleAnimationEnd}
        />
      )}
    </>
  );
}
