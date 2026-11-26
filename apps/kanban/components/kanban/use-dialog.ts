"use client";

import { useCallback, useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal behaviour: close on Escape, keep focus inside while open,
 * return focus to whatever opened the dialog, and close on a backdrop click
 * only when the click both started and ended on the backdrop — otherwise
 * selecting text inside the panel and releasing outside it closes the dialog.
 *
 * `open` is a parameter rather than a mount condition because these panels
 * render as null when closed and must not run the effect in that state.
 */
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const panelRef = useRef<T>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const backdropPressRef = useRef(false);

  const focusables = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return [] as HTMLElement[];
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => element.offsetParent !== null || element === document.activeElement
    );
  }, []);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const preferred = panel.querySelector<HTMLElement>("[data-autofocus]");
      (preferred ?? focusables()[0] ?? panel).focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;
      const elements = focusables();
      if (elements.length === 0) return;

      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!panelRef.current?.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus({ preventScroll: true });
    };
  }, [focusables, onClose, open]);

  const backdropProps = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      backdropPressRef.current = event.target === event.currentTarget;
    },
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (event.target === event.currentTarget && backdropPressRef.current) onClose();
      backdropPressRef.current = false;
    },
  };

  return { panelRef, backdropProps };
}
