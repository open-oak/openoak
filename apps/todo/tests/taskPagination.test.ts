import { describe, expect, it } from "vitest";
import {
  buildTaskPageOrderBy,
  buildTaskPageWhere,
  decodeTaskCursor,
  encodeTaskCursor,
  normalizeTaskPageSize,
  normalizeTaskSort,
  shouldShowTaskEmptyState,
} from "@/lib/task-pagination";

describe("task pagination contract", () => {
  it("builds exact active smart-list and custom-list filters", () => {
    expect(buildTaskPageWhere("user-1", { kind: "my-day" }, false)).toMatchObject({
      title: { not: "" },
      isCompleted: false,
      list: { OR: [{ ownerId: "user-1" }, { kind: "CUSTOM", members: { some: { userId: "user-1" } } }] },
    });
    expect(buildTaskPageWhere("user-1", { kind: "my-day" }, false).OR).toHaveLength(2);
    expect(buildTaskPageWhere("user-1", { kind: "list", listId: "list-2" }, true)).toMatchObject({
      title: { not: "" },
      isCompleted: true,
      listId: "list-2",
    });
    expect(buildTaskPageWhere("user-1", { kind: "tasks" }, false, "default-list")).toMatchObject({
      listId: "default-list",
      isCompleted: false,
    });
  });

  it("uses deterministic global ordering with stable id tie-breakers", () => {
    expect(buildTaskPageOrderBy("created", "desc", false)).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(buildTaskPageOrderBy("due", "asc", false)).toEqual([
      { dueDate: { sort: "asc", nulls: "last" } },
      { createdAt: "asc" },
      { id: "asc" },
    ]);
    expect(buildTaskPageOrderBy("alpha", "desc", true)).toEqual([
      { sortOrder: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("round-trips opaque cursors and rejects malformed input", () => {
    const cursor = encodeTaskCursor("task-123");
    expect(cursor).not.toContain("task-123");
    expect(decodeTaskCursor(cursor)).toBe("task-123");
    expect(decodeTaskCursor(null)).toBeNull();
    expect(() => decodeTaskCursor("not-a-cursor")).toThrow("Invalid task cursor");
  });

  it("keeps page sizes bounded", () => {
    expect(normalizeTaskPageSize()).toBe(100);
    expect(normalizeTaskPageSize(0)).toBe(1);
    expect(normalizeTaskPageSize(50.9)).toBe(50);
    expect(normalizeTaskPageSize(10_000)).toBe(100);
  });

  it("normalizes untrusted sort inputs before building database queries", () => {
    expect(normalizeTaskSort("alpha", "asc")).toEqual({ sort: "alpha", direction: "asc" });
    expect(normalizeTaskSort("drop table", "sideways")).toEqual({ sort: "created", direction: "desc" });
  });

  it("hides the empty state as soon as an optimistic first task is visible", () => {
    expect(shouldShowTaskEmptyState(0, 0)).toBe(true);
    expect(shouldShowTaskEmptyState(0, 1)).toBe(false);
    expect(shouldShowTaskEmptyState(1, 0)).toBe(false);
  });
});
