"use client";

import { useCallback, useEffect, useMemo } from "react";
import { createSaveQueue } from "@/lib/note-save-queue";
import type { SavePatch } from "@/lib/notes-view";
import { SAVE_DELAY_MS } from "./constants";

/**
 * Wires the per-note save queue to the page lifecycle.
 *
 * Text is saved on a debounce, so anything typed in the last few hundred
 * milliseconds only exists in the browser. Hiding the tab (switching apps,
 * closing, backgrounding on mobile) flushes those saves, and a leave prompt
 * covers the case where the page is torn down before they finish.
 */
/**
 * `save` should be a stable callback. If it does change, the replaced queue is
 * flushed rather than dropped, so pending text is still sent.
 */
export function useNoteSaving({ save }: { save: (id: string, patch: SavePatch) => Promise<void> }) {
  const queue = useMemo(() => createSaveQueue<SavePatch>({ delayMs: SAVE_DELAY_MS, save }), [save]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") queue.flushAll();
    };

    const onPageHide = () => queue.flushAll();

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      queue.flushAll();
      // Only prompts inside the short window where a save is still unfinished.
      if (queue.isBusy()) event.preventDefault();
    };

    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Unmount is not a save point on its own, but pending text should not be
      // silently dropped either.
      queue.flushAll();
    };
  }, [queue]);

  const queuePatch = useCallback((id: string, patch: SavePatch) => queue.queue(id, patch), [queue]);
  const flushNote = useCallback((id: string) => queue.flush(id), [queue]);
  /** Drops one note's unsaved text; used when that note is deleted. */
  const cancelNote = useCallback((id: string) => queue.cancel(id), [queue]);
  const isBusy = useCallback(() => queue.isBusy(), [queue]);

  return { queuePatch, flushNote, cancelNote, isBusy };
}
