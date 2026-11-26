"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { todoSyncRequestKey, todoSyncSearchParams, type TodoSyncSnapshot } from "@/lib/todo-sync";
import { useAppStore } from "@/store/app-store";

export const TODO_SYNC_NOW_EVENT = "todo-sync-now";
const POLL_INTERVAL_MS = 15_000;
const MAX_OFFLINE_BACKOFF_MS = 60_000;

export function CollaborationSync() {
  const router = useRouter();
  const syncRequest = useAppStore((state) => state.syncRequest);

  useEffect(() => {
    if (!syncRequest) return;
    let stopped = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;
    let etag: string | null = null;
    let offlineBackoff = POLL_INTERVAL_MS;
    const requestKey = todoSyncRequestKey(syncRequest);

    const schedule = (delay = POLL_INTERVAL_MS) => {
      if (!stopped) timer = window.setTimeout(poll, delay);
    };

    const poll = async () => {
      if (stopped) return;
      if (document.visibilityState !== "visible") return;
      if (!navigator.onLine) {
        offlineBackoff = Math.min(offlineBackoff * 2, MAX_OFFLINE_BACKOFF_MS);
        schedule(offlineBackoff);
        return;
      }

      controller?.abort();
      controller = new AbortController();
      try {
        const headers = etag ? { "If-None-Match": etag } : undefined;
        const response = await fetch(`/api/sync?${todoSyncSearchParams(syncRequest)}`, {
          cache: "no-store",
          headers,
          signal: controller.signal,
        });
        if (response.status === 401) {
          stopped = true;
          return;
        }
        if (response.status === 304) {
          offlineBackoff = POLL_INTERVAL_MS;
          schedule();
          return;
        }
        if (!response.ok) throw new Error(`Sync failed (${response.status})`);
        etag = response.headers.get("etag");
        const snapshot = await response.json() as TodoSyncSnapshot;
        const currentRequest = useAppStore.getState().syncRequest;
        if (stopped || !currentRequest || todoSyncRequestKey(currentRequest) !== requestKey) return;

        const oldState = useAppStore.getState();
        const polledListId = syncRequest.scope.kind === "list" ? syncRequest.scope.listId : null;
        const removedListId = polledListId &&
          oldState.lists.some((list) => list.id === polledListId) &&
          !snapshot.lists.some((list) => list.id === polledListId)
            ? polledListId
            : null;
        oldState.reconcileSync(snapshot, requestKey);
        for (const notice of useAppStore.getState().drainSyncNotices()) toast.info(notice);
        if (removedListId) {
          toast.error("Access to this shared list was removed.");
          router.push("/tasks");
        }
        offlineBackoff = POLL_INTERVAL_MS;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          offlineBackoff = Math.min(offlineBackoff * 2, MAX_OFFLINE_BACKOFF_MS);
        }
      }
      schedule(navigator.onLine ? POLL_INTERVAL_MS : offlineBackoff);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (timer) window.clearTimeout(timer);
        void poll();
      } else if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const onOnline = () => {
      offlineBackoff = POLL_INTERVAL_MS;
      if (timer) window.clearTimeout(timer);
      void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    // Bulk changes outside the store (such as an import) ask for an immediate sync.
    window.addEventListener(TODO_SYNC_NOW_EVENT, onOnline);
    // The mounted task view already revalidates itself. Start collaboration
    // polling after the normal interval instead of duplicating that first load.
    schedule();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(TODO_SYNC_NOW_EVENT, onOnline);
    };
  }, [router, syncRequest]);

  return null;
}
