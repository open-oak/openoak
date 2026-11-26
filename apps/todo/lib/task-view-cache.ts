import type { SortDirection, SortOption, Task, TaskPageScope, TaskViewResult } from "@/lib/types";

export const MAX_TASK_VIEW_CACHE_ENTRIES = 12;
const SESSION_CACHE_PREFIX = "open-todo-task-view:";

export interface CachedTaskView extends TaskViewResult<Task> {
  cachedAt: number;
}

const taskViewCache = new Map<string, CachedTaskView>();
let cacheUserId: string | null = null;

function sessionCacheKey() {
  return cacheUserId ? `${SESSION_CACHE_PREFIX}${cacheUserId}` : null;
}

function reviveTask(task: Task): Task {
  return {
    ...task,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
    dueDate: task.dueDate ? new Date(task.dueDate) : null,
  };
}

function readSessionView(key: string): CachedTaskView | null {
  const storageKey = sessionCacheKey();
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { key?: unknown; view?: Partial<CachedTaskView> };
    if (
      stored.key !== key ||
      typeof stored.view?.cachedAt !== "number" ||
      !Array.isArray(stored.view.active?.items) ||
      !Array.isArray(stored.view.completed?.items)
    ) return null;
    return {
      ...stored.view,
      active: { ...stored.view.active, items: stored.view.active.items.map(reviveTask) },
      completed: { ...stored.view.completed, items: stored.view.completed.items.map(reviveTask) },
    } as CachedTaskView;
  } catch {
    return null;
  }
}

function writeSessionView(key: string, view: CachedTaskView) {
  const storageKey = sessionCacheKey();
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify({ key, view }));
  } catch {
    // The in-memory cache still works when storage is unavailable or full.
  }
}

export function setTaskViewCacheUser(userId: string): void {
  if (cacheUserId === userId) return;
  taskViewCache.clear();
  cacheUserId = userId;
}

export function taskViewCacheKey(
  scope: TaskPageScope,
  sort: SortOption,
  direction: SortDirection,
): string {
  const scopeKey = scope.kind === "list" ? `list:${scope.listId}` : scope.kind;
  return `${scopeKey}:${sort}:${direction}`;
}

export function readTaskViewCache(key: string): CachedTaskView | null {
  const cached = taskViewCache.get(key) ?? readSessionView(key);
  if (!cached) return null;
  taskViewCache.delete(key);
  taskViewCache.set(key, cached);
  return cached;
}

export function writeTaskViewCache(
  key: string,
  view: TaskViewResult<Task>,
  { persist = true }: { persist?: boolean } = {},
): CachedTaskView {
  const cached = { ...view, cachedAt: Date.now() };
  taskViewCache.delete(key);
  taskViewCache.set(key, cached);
  while (taskViewCache.size > MAX_TASK_VIEW_CACHE_ENTRIES) {
    const oldestKey = taskViewCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    taskViewCache.delete(oldestKey);
  }
  if (persist) writeSessionView(key, cached);
  return cached;
}

export function clearTaskViewCache(): void {
  taskViewCache.clear();
  const storageKey = sessionCacheKey();
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Nothing else to clear when session storage is unavailable.
  }
}
