import { describe, expect, it } from "vitest";
import { createTodoSyncEtag } from "@/lib/todo-sync-server";

describe("Todo sync ETags", () => {
  it("is deterministic across key order and poll timestamps", () => {
    const first = { counts: { all: 1, lists: { a: 1 } }, lists: [{ id: "a", updatedAt: new Date("2026-01-01") }], syncedAt: "one" };
    const second = { syncedAt: "two", lists: [{ updatedAt: "2026-01-01T00:00:00.000Z", id: "a" }], counts: { lists: { a: 1 }, all: 1 } };
    expect(createTodoSyncEtag(first)).toBe(createTodoSyncEtag(second));
  });

  it("changes for task, count, list, membership, and deletion snapshots", () => {
    const base = { lists: [{ id: "a", memberCount: 1 }], counts: { all: 1 }, active: { items: [{ id: "task", title: "A" }] } };
    const etag = createTodoSyncEtag(base);
    expect(createTodoSyncEtag({ ...base, counts: { all: 2 } })).not.toBe(etag);
    expect(createTodoSyncEtag({ ...base, lists: [{ id: "a", memberCount: 0 }] })).not.toBe(etag);
    expect(createTodoSyncEtag({ ...base, active: { items: [] } })).not.toBe(etag);
    expect(createTodoSyncEtag({ ...base, active: { items: [{ id: "task", title: "B" }] } })).not.toBe(etag);
  });
});
