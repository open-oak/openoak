import { useMemo } from "react";
import { useAppStore } from "./app-store";
import type { Task, SidebarCounts, SortOption, SortDirection } from "@/lib/types";

const EMPTY_TASKS: Task[] = [];
const visibleTasksCache = new WeakMap<Map<string, Task>, Task[]>();
const listIndexCache = new WeakMap<Map<string, Task>, Map<string, Task[]>>();

function getVisibleTasks(tasks: Map<string, Task>): Task[] {
  const cached = visibleTasksCache.get(tasks);
  if (cached) return cached;
  const visible = Array.from(tasks.values()).filter((t) => t.title.trim() !== "");
  visibleTasksCache.set(tasks, visible);
  return visible;
}

function byStoredOrder(a: Task, b: Task): number {
  return a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime();
}

function getListIndex(tasks: Map<string, Task>): Map<string, Task[]> {
  const cached = listIndexCache.get(tasks);
  if (cached) return cached;

  const index = new Map<string, Task[]>();
  for (const task of getVisibleTasks(tasks)) {
    const bucket = index.get(task.listId);
    if (bucket) {
      bucket.push(task);
    } else {
      index.set(task.listId, [task]);
    }
  }
  for (const bucket of index.values()) {
    bucket.sort(byStoredOrder);
  }
  listIndexCache.set(tasks, index);
  return index;
}

export function useMyDayTasks() {
  const tasks = useAppStore((s) => s.tasks);
  return useMemo(
    () =>
      getVisibleTasks(tasks)
        .filter((t) => t.isMyDay)
        .sort(byStoredOrder),
    [tasks]
  );
}

export function useImportantTasks() {
  const tasks = useAppStore((s) => s.tasks);
  return useMemo(
    () =>
      getVisibleTasks(tasks)
        .filter((t) => t.isImportant)
        .sort(byStoredOrder),
    [tasks]
  );
}

export function usePlannedTasks() {
  const tasks = useAppStore((s) => s.tasks);
  return useMemo(
    () =>
      getVisibleTasks(tasks)
        .filter((t) => t.dueDate !== null)
        .sort(byStoredOrder),
    [tasks]
  );
}

export function useListTasks(listId: string) {
  const tasks = useAppStore((s) => s.tasks);
  const index = useMemo(() => getListIndex(tasks), [tasks]);
  return useMemo(() => index.get(listId) ?? EMPTY_TASKS, [index, listId]);
}

export function useDefaultListTasks() {
  const tasks = useAppStore((s) => s.tasks);
  const defaultListId = useAppStore((s) => s.defaultListId);
  const index = useMemo(() => getListIndex(tasks), [tasks]);
  return useMemo(() => index.get(defaultListId) ?? EMPTY_TASKS, [index, defaultListId]);
}

/** Uses authoritative server counts so unloaded pages never disappear from navigation. */
export function useSidebarCounts(): SidebarCounts {
  return useAppStore((s) => s.counts);
}

export function sortTasks<T extends { title: string; isImportant: boolean; dueDate?: Date | null; createdAt: Date }>(
  tasks: T[],
  sort: SortOption,
  direction: SortDirection = "asc"
): T[] {
  const sorted = [...tasks];
  const dir = direction === "asc" ? 1 : -1;
  const compareCreatedAt = (a: T, b: T) => a.createdAt.getTime() - b.createdAt.getTime();
  switch (sort) {
    case "alpha":
      sorted.sort((a, b) => dir * a.title.localeCompare(b.title));
      break;
    case "importance":
      sorted.sort((a, b) => {
        if (a.isImportant === b.isImportant) return 0;
        return dir * (a.isImportant ? 1 : -1);
      });
      break;
    case "due":
      sorted.sort((a, b) => {
        const aDue = a.dueDate;
        const bDue = b.dueDate;

        if (aDue === null || aDue === undefined) return bDue === null || bDue === undefined ? compareCreatedAt(a, b) : 1;
        if (bDue === null || bDue === undefined) return -1;

        const byDue = aDue.getTime() - bDue.getTime();
        if (byDue !== 0) return dir * byDue;

        const byCreated = compareCreatedAt(a, b);
        if (byCreated !== 0) return byCreated;
        return a.title.localeCompare(b.title);
      });
      break;
    case "created":
      sorted.sort((a, b) => dir * compareCreatedAt(a, b));
      break;
    case "custom":
      break; // already in sortOrder order; no direction for custom
  }
  return sorted;
}
