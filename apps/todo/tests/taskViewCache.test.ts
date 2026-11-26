import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskViewResult } from "@/lib/types";
import {
  clearTaskViewCache,
  MAX_TASK_VIEW_CACHE_ENTRIES,
  readTaskViewCache,
  setTaskViewCacheUser,
  taskViewCacheKey,
  writeTaskViewCache,
} from "@/lib/task-view-cache";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function task(id: string): Task {
  const now = new Date("2026-08-21T10:00:00.000Z");
  return {
    id,
    title: id,
    notes: null,
    isCompleted: false,
    isImportant: false,
    isMyDay: false,
    listId: "list-1",
    dueDate: null,
    sortOrder: 0,
    subtasks: [],
    createdAt: now,
    updatedAt: now,
  };
}

function view(id: string): TaskViewResult<Task> {
  return {
    active: { items: [task(id)], totalCount: 1, nextCursor: null },
    completed: { items: [], totalCount: 0, nextCursor: null },
  };
}

describe("task view memory cache", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { sessionStorage: new MemoryStorage() });
    setTaskViewCacheUser("user-1");
    clearTaskViewCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keys private smart views and custom lists separately", () => {
    expect(taskViewCacheKey({ kind: "tasks" }, "created", "desc")).toBe("tasks:created:desc");
    expect(taskViewCacheKey({ kind: "list", listId: "shared-1" }, "created", "desc"))
      .toBe("list:shared-1:created:desc");
  });

  it("keeps only a bounded least-recently-used set in memory", () => {
    for (let index = 0; index < MAX_TASK_VIEW_CACHE_ENTRIES; index += 1) {
      writeTaskViewCache(`view-${index}`, view(`task-${index}`));
    }
    expect(readTaskViewCache("view-0")?.active.items[0].id).toBe("task-0");

    writeTaskViewCache("new-view", view("new-task"));

    expect(readTaskViewCache("view-1")).toBeNull();
    expect(readTaskViewCache("view-0")).not.toBeNull();
    expect(readTaskViewCache("new-view")?.cachedAt).toBe(Date.now());
  });

  it("restores the current task view after the in-memory cache is lost", () => {
    writeTaskViewCache("current-view", view("persisted-task"));

    setTaskViewCacheUser("user-2");
    setTaskViewCacheUser("user-1");

    const restored = readTaskViewCache("current-view");
    expect(restored?.active.items[0].id).toBe("persisted-task");
    expect(restored?.active.items[0].createdAt).toBeInstanceOf(Date);
  });

  it("does not let background prefetch replace the persisted current view", () => {
    writeTaskViewCache("current-view", view("current-task"));
    writeTaskViewCache("prefetched-view", view("prefetched-task"), { persist: false });

    setTaskViewCacheUser("user-2");
    setTaskViewCacheUser("user-1");

    expect(readTaskViewCache("current-view")?.active.items[0].id).toBe("current-task");
    expect(readTaskViewCache("prefetched-view")).toBeNull();
  });
});
