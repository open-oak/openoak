"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";

const THEME_COLORS = {
  dark: "#1e1e1e",
  light: "#f5f5f5",
};

export function ThemeObserver() {
  const colorMode = useAppStore((s) => s.colorMode);

  useEffect(() => {
    const applyTheme = (isDark: boolean) => {
      const html = document.documentElement;
      const meta = document.querySelector('meta[name="theme-color"]');
      
      if (isDark) {
        html.classList.add("dark");
        html.classList.remove("light");
        meta?.setAttribute("content", THEME_COLORS.dark);
      } else {
        html.classList.remove("dark");
        html.classList.add("light");
        meta?.setAttribute("content", THEME_COLORS.light);
      }
    };

    // Persist choice for the inline head script
    localStorage.setItem("theme-mode", colorMode);

    if (colorMode === "auto") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      
      // Initial apply
      applyTheme(mql.matches);

      // Listen for system changes (OS toggle, sunset, etc.)
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mql.addEventListener("change", handler);
      
      return () => mql.removeEventListener("change", handler);
    } else {
      applyTheme(colorMode === "dark");
    }
  }, [colorMode]);

  return null;
}
