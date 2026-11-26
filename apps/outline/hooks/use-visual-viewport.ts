"use client";

import { useEffect } from "react";

const KEYBOARD_HEIGHT_THRESHOLD = 120;
const ORIENTATION_WIDTH_THRESHOLD = 80;

/**
 * Keep the app shell aligned with the part of the page that is actually
 * visible when a mobile keyboard overlays the layout viewport.
 */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    let baselineHeight = Math.max(viewport.height, window.innerHeight);
    let baselineWidth = viewport.width;
    let frame: number | null = null;

    const clearKeyboardViewport = () => {
      root.style.removeProperty("--notes-viewport-height");
      root.style.removeProperty("--notes-viewport-offset-top");
    };

    const sync = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;

        if (Math.abs(viewport.scale - 1) > 0.01) {
          clearKeyboardViewport();
          return;
        }

        if (Math.abs(viewport.width - baselineWidth) > ORIENTATION_WIDTH_THRESHOLD) {
          baselineHeight = Math.max(viewport.height, window.innerHeight);
          baselineWidth = viewport.width;
        } else {
          baselineHeight = Math.max(baselineHeight, viewport.height);
        }

        const keyboardHeight = baselineHeight - viewport.height;
        if (keyboardHeight < KEYBOARD_HEIGHT_THRESHOLD) {
          clearKeyboardViewport();
          return;
        }

        root.style.setProperty("--notes-viewport-height", `${Math.floor(viewport.height)}px`);
        root.style.setProperty("--notes-viewport-offset-top", `${Math.round(viewport.offsetTop)}px`);
      });
    };

    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      clearKeyboardViewport();
    };
  }, []);
}
