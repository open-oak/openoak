"use client";

import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";
import { getTaskView } from "@/app/actions";
import {
  MAX_TASK_VIEW_CACHE_ENTRIES,
  readTaskViewCache,
  taskViewCacheKey,
  writeTaskViewCache,
} from "@/lib/task-view-cache";
import type { SortDirection, SortOption, Task, TaskPageScope, TaskViewResult } from "@/lib/types";
import { useAppStore } from "@/store/app-store";

const DEFAULT_DIRECTION: Record<SortOption, SortDirection> = {
  created: "desc",
  alpha: "asc",
  importance: "desc",
  due: "asc",
  custom: "desc",
};

interface PrefetchCandidate {
  path: string;
  scope: TaskPageScope;
}

function normalizeTaskView(view: TaskViewResult<Task>): TaskViewResult<Task> {
  const normalize = (task: Task): Task => ({
    ...task,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
    dueDate: task.dueDate ? new Date(task.dueDate) : null,
  });
  return {
    active: { ...view.active, items: view.active.items.map(normalize) },
    completed: { ...view.completed, items: view.completed.items.map(normalize) },
  };
}

export function TaskViewPrefetcher() {
  const urlPathname = usePathname();
  const lists = useAppStore((state) => state.lists);
  const prefetched = useAppStore((state) => state.prefetched);
  const currentPath = useAppStore((state) => state.currentPath) || urlPathname;
  const sortPreferences = useAppStore((state) => state.sortPreferences);
  const candidates = useMemo<PrefetchCandidate[]>(() => [
    ...lists
      .filter((list) => list.kind === "CUSTOM")
      .map((list) => ({ path: `/lists/${list.id}`, scope: { kind: "list", listId: list.id } as const })),
    { path: "/tasks", scope: { kind: "tasks" } },
    { path: "/", scope: { kind: "my-day" } },
    { path: "/important", scope: { kind: "important" } },
    { path: "/planned", scope: { kind: "planned" } },
  ], [lists]);

  useEffect(() => {
    if (!prefetched || document.visibilityState !== "visible" || !navigator.onLine) return;
    let stopped = false;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    let index = 0;
    const queue = candidates
      .filter((candidate) => candidate.path !== currentPath)
      .slice(0, MAX_TASK_VIEW_CACHE_ENTRIES - 1);

    const warmNext = async () => {
      if (stopped) return;
      while (index < queue.length) {
        const candidate = queue[index++];
        const preference = sortPreferences[candidate.path];
        const sort = preference?.sort ?? "created";
        const direction = preference?.dir ?? DEFAULT_DIRECTION[sort];
        const key = taskViewCacheKey(candidate.scope, sort, direction);
        if (readTaskViewCache(key)) continue;
        try {
          const view = await getTaskView({ scope: candidate.scope, sort, direction });
          if (!stopped) writeTaskViewCache(key, normalizeTaskView(view), { persist: false });
        } catch {
          // Prefetch is best-effort; normal navigation will retry this view.
        }
        break;
      }
      if (!stopped && index < queue.length) schedule();
    };

    const schedule = () => {
      const idle = (window as Window & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      }).requestIdleCallback;
      if (idle) idleHandle = idle(() => void warmNext(), { timeout: 2_000 });
      else timeoutHandle = window.setTimeout(() => void warmNext(), 250);
    };

    schedule();
    return () => {
      stopped = true;
      if (idleHandle !== null) {
        (window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(idleHandle);
      }
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
    };
  }, [candidates, currentPath, prefetched, sortPreferences]);

  return null;
}
