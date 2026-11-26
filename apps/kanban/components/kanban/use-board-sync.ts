"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { serializeBoardState, type Board, type BoardAppearance } from "@/lib/kanban-data";
import { cleanSyncDocument, type SyncDocument } from "@/lib/kanban-sync";
import { startKanbanSyncPolling } from "@/lib/kanban-sync-polling";
import type { SyncStatus } from "./constants";

/**
 * Cloud sync for the board document: initial load, debounced saves, background
 * refresh, retry while offline, and conflict handoff. It lives outside the
 * board component so the sync rules (which revision wins, when a difference
 * becomes a conflict) sit in one place instead of across a dozen effects.
 *
 * The caller owns board state. This hook only reports what the server said and
 * calls `onDocumentLoaded` when the server's version should replace local state.
 */

export type HydratedState = {
  boards: Board[];
  activeBoardId: string;
  /** True when this device had local boards worth seeding the cloud with. */
  hadStoredBoards: boolean;
  appearanceFallback: BoardAppearance;
};

export type BoardSync = {
  status: SyncStatus;
  conflict: SyncDocument | null;
  ready: boolean;
  pullLatest: () => Promise<void>;
  /** Discard local edits and take the cloud version. */
  useCloudVersion: () => void;
  /** Keep local edits and overwrite the cloud version. */
  keepDeviceVersion: () => void;
};

export function useBoardSync({
  mounted,
  boards,
  activeBoardId,
  hydratedStateRef,
  onDocumentLoaded,
}: {
  mounted: boolean;
  boards: Board[];
  activeBoardId: string;
  hydratedStateRef: React.RefObject<HydratedState | null>;
  onDocumentLoaded: (boards: Board[], activeBoardId: string) => void;
}): BoardSync {
  const [status, setStatus] = useState<SyncStatus>("loading");
  const [ready, setReady] = useState(false);
  const [conflict, setConflict] = useState<SyncDocument | null>(null);

  const boardsRef = useRef(boards);
  const activeBoardIdRef = useRef(activeBoardId);
  const revisionRef = useRef(0);
  const lastSyncedStateRef = useRef("");
  const readyRef = useRef(false);
  const inFlightRef = useRef(false);
  const conflictRef = useRef<SyncDocument | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const onDocumentLoadedRef = useRef(onDocumentLoaded);

  useEffect(() => {
    onDocumentLoadedRef.current = onDocumentLoaded;
  }, [onDocumentLoaded]);

  useEffect(() => {
    boardsRef.current = boards;
    activeBoardIdRef.current = activeBoardId;
  }, [activeBoardId, boards]);

  const flushSync = useCallback(async function flush() {
    if (!readyRef.current || inFlightRef.current || conflictRef.current) return;

    const currentBoards = boardsRef.current;
    const currentActiveBoardId = activeBoardIdRef.current;
    const snapshot = serializeBoardState(currentBoards, currentActiveBoardId);
    if (snapshot === lastSyncedStateRef.current) {
      setStatus("synced");
      return;
    }

    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    inFlightRef.current = true;
    setStatus("saving");

    try {
      const response = await fetch("/api/boards", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          boards: currentBoards,
          activeBoardId: currentActiveBoardId,
          baseRevision: revisionRef.current,
        }),
      });
      const payload: unknown = await response.json();

      if (response.status === 409) {
        const cloudConflict = cleanSyncDocument(
          payload && typeof payload === "object" && "conflict" in payload ? (payload as { conflict: unknown }).conflict : null,
          hydratedStateRef.current?.appearanceFallback
        );
        if (cloudConflict) {
          const cloudSnapshot = serializeBoardState(cloudConflict.boards, cloudConflict.activeBoardId);
          // Same content under a newer revision is not a real conflict.
          if (cloudSnapshot === snapshot) {
            revisionRef.current = cloudConflict.revision;
            lastSyncedStateRef.current = snapshot;
            setStatus("synced");
            return;
          }
          conflictRef.current = cloudConflict;
          setConflict(cloudConflict);
          setStatus("conflict");
          return;
        }
      }

      if (!response.ok) throw new Error("Unable to save boards");
      const document = cleanSyncDocument(
        payload && typeof payload === "object" && "document" in payload ? (payload as { document: unknown }).document : null,
        hydratedStateRef.current?.appearanceFallback
      );
      if (!document) throw new Error("Invalid sync response");

      revisionRef.current = document.revision;
      lastSyncedStateRef.current = snapshot;
      setStatus("synced");
    } catch {
      setStatus("offline");
      retryTimerRef.current = window.setTimeout(flush, 10_000);
    } finally {
      inFlightRef.current = false;
      const latestSnapshot = serializeBoardState(boardsRef.current, activeBoardIdRef.current);
      if (!conflictRef.current && latestSnapshot !== lastSyncedStateRef.current && retryTimerRef.current === null) {
        window.setTimeout(flush, 0);
      }
    }
  }, [hydratedStateRef]);

  const pullLatest = useCallback(async () => {
    if (!readyRef.current || inFlightRef.current || conflictRef.current) return;
    inFlightRef.current = true;

    try {
      const response = await fetch("/api/boards", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load boards");
      const payload: unknown = await response.json();
      const document = cleanSyncDocument(
        payload && typeof payload === "object" && "document" in payload ? (payload as { document: unknown }).document : null,
        hydratedStateRef.current?.appearanceFallback
      );
      if (!document || document.revision <= revisionRef.current) {
        if (serializeBoardState(boardsRef.current, activeBoardIdRef.current) === lastSyncedStateRef.current) {
          setStatus("synced");
        }
        return;
      }

      // A newer cloud revision plus unsaved local edits is a real conflict.
      const currentSnapshot = serializeBoardState(boardsRef.current, activeBoardIdRef.current);
      if (currentSnapshot !== lastSyncedStateRef.current) {
        conflictRef.current = document;
        setConflict(document);
        setStatus("conflict");
        return;
      }

      boardsRef.current = document.boards;
      activeBoardIdRef.current = document.activeBoardId;
      revisionRef.current = document.revision;
      lastSyncedStateRef.current = serializeBoardState(document.boards, document.activeBoardId);
      onDocumentLoadedRef.current(document.boards, document.activeBoardId);
      setStatus("synced");
    } catch {
      setStatus("offline");
    } finally {
      inFlightRef.current = false;
      const latestSnapshot = serializeBoardState(boardsRef.current, activeBoardIdRef.current);
      if (!conflictRef.current && latestSnapshot !== lastSyncedStateRef.current) {
        window.setTimeout(() => {
          void flushSync();
        }, 0);
      }
    }
  }, [flushSync, hydratedStateRef]);

  // Initial load: adopt the cloud document, or seed it from this device.
  useEffect(() => {
    if (!mounted) return;
    let active = true;

    async function bootstrapSync() {
      const localState = hydratedStateRef.current;
      if (!localState) return;

      setStatus("loading");
      try {
        const response = await fetch("/api/boards", { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load boards");
        const payload: unknown = await response.json();
        const document = cleanSyncDocument(
          payload && typeof payload === "object" && "document" in payload ? (payload as { document: unknown }).document : null,
          localState.appearanceFallback
        );
        if (!active) return;

        if (document) {
          boardsRef.current = document.boards;
          activeBoardIdRef.current = document.activeBoardId;
          revisionRef.current = document.revision;
          lastSyncedStateRef.current = serializeBoardState(document.boards, document.activeBoardId);
          onDocumentLoadedRef.current(document.boards, document.activeBoardId);
          setStatus("synced");
        } else {
          revisionRef.current = 0;
          lastSyncedStateRef.current = localState.hadStoredBoards ? "" : serializeBoardState(localState.boards, localState.activeBoardId);
          setStatus(localState.hadStoredBoards ? "saving" : "synced");
        }

        readyRef.current = true;
        setReady(true);
        if (!document && localState.hadStoredBoards) await flushSync();
      } catch {
        if (!active) return;
        revisionRef.current = 0;
        lastSyncedStateRef.current = localState.hadStoredBoards ? "" : serializeBoardState(localState.boards, localState.activeBoardId);
        readyRef.current = true;
        setReady(true);
        setStatus("offline");
      }
    }

    void bootstrapSync();
    return () => {
      active = false;
    };
  }, [flushSync, hydratedStateRef, mounted]);

  // Debounced save after edits settle.
  useEffect(() => {
    if (!mounted || !ready || conflict) return;
    const snapshot = serializeBoardState(boards, activeBoardId);
    if (snapshot === lastSyncedStateRef.current) return;

    const timer = window.setTimeout(() => {
      void flushSync();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeBoardId, boards, conflict, flushSync, mounted, ready]);

  useEffect(() => {
    const onOnline = () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      void flushSync();
    };

    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
    };
  }, [flushSync]);

  // Background refresh so other devices' changes arrive without a reload.
  useEffect(() => {
    if (!ready) return;
    return startKanbanSyncPolling(pullLatest);
  }, [pullLatest, ready]);

  /**
   * Edits are saved on a 650 ms debounce, so the most recent change may exist
   * only in this tab. Hiding it (switching apps, backgrounding on mobile) or
   * tearing it down flushes that save instead of stranding it — the local copy
   * would otherwise come back later as a conflict rather than as the newer
   * version. Hiding is the reliable signal on mobile; `pagehide` is best effort.
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flushSync();
    };
    const onPageHide = () => {
      void flushSync();
    };

    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      void flushSync();
    };
  }, [flushSync]);

  const useCloudVersion = useCallback(() => {
    const current = conflictRef.current;
    if (!current) return;
    boardsRef.current = current.boards;
    activeBoardIdRef.current = current.activeBoardId;
    revisionRef.current = current.revision;
    lastSyncedStateRef.current = serializeBoardState(current.boards, current.activeBoardId);
    conflictRef.current = null;
    onDocumentLoadedRef.current(current.boards, current.activeBoardId);
    setConflict(null);
    setStatus("synced");
  }, []);

  const keepDeviceVersion = useCallback(() => {
    const current = conflictRef.current;
    if (!current) return;
    // Rebase onto the cloud revision so the next save is accepted.
    revisionRef.current = current.revision;
    lastSyncedStateRef.current = serializeBoardState(current.boards, current.activeBoardId);
    conflictRef.current = null;
    setConflict(null);
    setStatus("saving");
    window.setTimeout(() => {
      void flushSync();
    }, 0);
  }, [flushSync]);

  return { status, conflict, ready, pullLatest, useCloudVersion, keepDeviceVersion };
}
