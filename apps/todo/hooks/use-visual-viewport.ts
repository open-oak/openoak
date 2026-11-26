"use client";

import { useEffect } from "react";

const KEYBOARD_HEIGHT_THRESHOLD = 120;
const ORIENTATION_WIDTH_THRESHOLD = 80;

function isEditableElement(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement
    && element.matches("input, textarea, [contenteditable='true'], [role='textbox']");
}

/** Keep fixed mobile UI inside the part of the page visible above the keyboard. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    let baselineHeight = Math.max(viewport.height, window.innerHeight);
    let baselineWidth = viewport.width;
    let syncFrame: number | null = null;
    let focusFrame: number | null = null;
    let secondFocusFrame: number | null = null;

    const clearKeyboardViewport = () => {
      root.style.removeProperty("--todo-viewport-height");
      root.style.removeProperty("--todo-viewport-offset-top");
      root.removeAttribute("data-todo-keyboard-open");
    };

    const keepFocusedElementVisible = () => {
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      if (secondFocusFrame !== null) window.cancelAnimationFrame(secondFocusFrame);

      focusFrame = window.requestAnimationFrame(() => {
        focusFrame = null;
        secondFocusFrame = window.requestAnimationFrame(() => {
          secondFocusFrame = null;
          const activeElement = document.activeElement;
          if (!isEditableElement(activeElement)) return;
          activeElement.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
      });
    };

    const sync = () => {
      if (syncFrame !== null) window.cancelAnimationFrame(syncFrame);
      syncFrame = window.requestAnimationFrame(() => {
        syncFrame = null;

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

        if (baselineHeight - viewport.height < KEYBOARD_HEIGHT_THRESHOLD) {
          clearKeyboardViewport();
          return;
        }

        root.style.setProperty("--todo-viewport-height", `${Math.floor(viewport.height)}px`);
        root.style.setProperty("--todo-viewport-offset-top", `${Math.round(viewport.offsetTop)}px`);
        root.setAttribute("data-todo-keyboard-open", "true");
        keepFocusedElementVisible();
      });
    };

    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);

    return () => {
      if (syncFrame !== null) window.cancelAnimationFrame(syncFrame);
      if (focusFrame !== null) window.cancelAnimationFrame(focusFrame);
      if (secondFocusFrame !== null) window.cancelAnimationFrame(secondFocusFrame);
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      clearKeyboardViewport();
    };
  }, []);
}
