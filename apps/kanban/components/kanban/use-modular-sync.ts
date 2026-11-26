"use client";
import { useEffect, useRef, useState } from "react";
import { KanbanBrowserStore, type BrowserView } from "@/lib/kanban-browser-store";
import { KanbanBrowserApi } from "@/lib/kanban-browser-api";
import { startKanbanSyncPolling } from "@/lib/kanban-sync-polling";
import type { Board } from "@/lib/kanban-data";
import type { BoardAction } from "@/lib/kanban-reducer";
import type { BoardSync } from "./use-board-sync";

export function downloadRecovery(text: string, name = "openkanban-unsent-edits.json") {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useModularSync({ enabled, accountId, initialBoardId, onDocumentLoaded }: {
  enabled: boolean; accountId: string; initialBoardId?: string; onDocumentLoaded: (boards: Board[], active: string) => void;
}) {
  const store = useRef<KanbanBrowserStore | null>(null);
  const loaded = useRef(onDocumentLoaded);
  const [view, setView] = useState<BrowserView>({ state: { boards: [], activeBoardId: "" }, counts: {}, status: "loading", ready: false, pending: 0 });
  useEffect(() => { loaded.current = onDocumentLoaded; }, [onDocumentLoaded]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let release: (() => void) | undefined;
    const keepAlive = new Promise<void>((resolve) => { release = resolve; });
    const run = async () => {
      try {
        if (!navigator.locks) throw new Error("This browser cannot safely coordinate offline edits. Use an up-to-date browser.");
        await navigator.locks.request("openkanban-editor:" + accountId, { ifAvailable: true }, async (lock) => {
          if (!active) return;
          if (!lock) throw new Error("OpenKanban is open in another tab. Close that tab and reload here to edit.");
          const instance = new KanbanBrowserStore(window.localStorage, accountId, new KanbanBrowserApi(fetch, accountId), (next) => {
            if (!active) return;
            setView(next);
            if (next.state.boards.length) loaded.current(next.state.boards, next.state.activeBoardId);
          });
          store.current = instance;
          await instance.start(initialBoardId);
          if (active) {
            window.localStorage.setItem("openkanban-offline-account", accountId);
          }
          await keepAlive;
          await instance.stop();
          if (store.current === instance) store.current = null;
        });
      } catch (error) {
        if (active) setView((current) => ({ ...current, status: "conflict", message: error instanceof Error ? error.message : "Unable to save on this device." }));
      }
    };
    void run();
    const retry = () => { void store.current?.sync(); };
    const stopPolling = startKanbanSyncPolling(async () => { await store.current?.sync(); });
    window.addEventListener("online", retry);
    return () => {
      active = false; void store.current?.stop(); release?.();
      stopPolling(); window.removeEventListener("online", retry);
    };
  }, [enabled, accountId, initialBoardId]);
  useEffect(() => {
    if (!enabled || !view.pending || view.status !== "saving") return;
    const timer = window.setTimeout(() => { void store.current?.sync(); }, 650);
    return () => window.clearTimeout(timer);
  }, [enabled, view]);
  const sync: BoardSync = {
    ready: view.ready, status: view.status, conflict: null,
    pullLatest: async () => { await store.current?.retry(); },
    useCloudVersion: () => { void store.current?.discardFirst(); },
    keepDeviceVersion: () => { void store.current?.retry(); },
  };
  return { ...sync, message: view.message, reloadRequired: view.reloadRequired ?? false, canDiscard: view.canDiscard ?? false, summaries: view.summaries ?? [], recovered: view.recovered ?? 0, counts: view.counts, pending: view.pending,
    dispatch: (action: BoardAction) => store.current?.dispatch(action),
    purgeArchive: async (boardId: string, revision: number) => { if (!store.current) throw new Error("Load your board first."); const instance = store.current; await instance.waitForOperation(instance.purgeArchive(boardId, revision)); },
    recoverCard: async (boardId: string, cardId: string, deletionId: string, permanent = false, destinationListId?: string) => { if (!store.current) throw new Error("Load your board first."); const instance = store.current; const id = instance.recoverCard(boardId, cardId, deletionId, permanent, destinationListId); await instance.waitForOperation(id); },
    undoDelete: async (boardId: string, cardId: string) => { if (!store.current) throw new Error("Load your board first."); await store.current.undoDelete(boardId, cardId); },
    exportBoards: async (boardId?: string) => { if (!store.current) throw new Error("Load your boards first."); return store.current.exportBoards(boardId); },
    importBoards: (boards: Board[]) => { if (!store.current) throw new Error("Load your boards first."); store.current.importBoards(boards); },
    exportRecovery: () => downloadRecovery(store.current?.recovery() ?? window.localStorage.getItem("open-kanban-modular:" + accountId) ?? "{}"),
  };
}
