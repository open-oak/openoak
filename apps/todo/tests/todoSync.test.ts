import { describe, expect, it } from "vitest";
import { reconcileVisibleTasks, todoSyncRequestKey, type PendingTaskMutation } from "@/lib/todo-sync";
import type { Task } from "@/lib/types";

function task(id: string, patch: Partial<Task> = {}): Task {
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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...patch,
  };
}

describe("Todo polling reconciliation", () => {
  it("uses a deterministic key for a page-aware request", () => {
    expect(todoSyncRequestKey({ scope: { kind: "list", listId: "a" }, sort: "created", direction: "desc", activeCursor: null, completedCursor: "next" }))
      .toBe("list:a|created|desc||next");
  });

  it("applies remote inserts, updates, and deletes by id", () => {
    const result = reconcileVisibleTasks(new Map([["old", task("old")], ["keep", task("keep")]]), [task("keep", { title: "remote" }), task("new")], {});
    expect([...result.tasks.keys()]).toEqual(["keep", "new"]);
    expect(result.tasks.get("keep")?.title).toBe("remote");
  });

  it("overlays dirty optimistic fields on the newest remote row", () => {
    const local = task("a", { title: "draft", notes: "local notes" });
    const pending: Record<string, PendingTaskMutation> = {
      a: { kind: "update", version: 1, dirtyFields: ["title"], snapshot: task("a") },
    };
    const result = reconcileVisibleTasks(new Map([["a", local]]), [task("a", { title: "remote", notes: "remote notes", updatedAt: new Date("2026-02-01") })], pending);
    expect(result.tasks.get("a")?.title).toBe("draft");
    expect(result.tasks.get("a")?.notes).toBe("remote notes");
  });

  it("accepts the server's latest same-field value after the local mutation resolves", () => {
    const local = task("a", {
      title: "optimistic title",
      updatedAt: new Date("2026-02-01"),
    });
    const remote = task("a", {
      title: "later collaborator title",
      updatedAt: new Date("2026-03-01"),
    });
    const result = reconcileVisibleTasks(new Map([["a", local]]), [remote], {});
    expect(result.tasks.get("a")?.title).toBe("later collaborator title");
    expect(result.tasks.get("a")?.updatedAt).toEqual(new Date("2026-03-01"));
  });

  it("preserves temp ids and suppresses a server row pending deletion", () => {
    const pending = {
      "temp-1": { kind: "create", version: 1, dirtyFields: ["title"], snapshot: null },
      deleted: { kind: "delete", version: 1, dirtyFields: [], snapshot: task("deleted") },
    } satisfies Record<string, PendingTaskMutation>;
    const result = reconcileVisibleTasks(new Map([["temp-1", task("temp-1")]]), [task("deleted")], pending);
    expect([...result.tasks.keys()]).toEqual(["temp-1"]);
  });

  it("defers a remote delete while a local edit is pending", () => {
    const pending = { a: { kind: "update", version: 1, dirtyFields: ["notes"], snapshot: task("a") } } satisfies Record<string, PendingTaskMutation>;
    const result = reconcileVisibleTasks(new Map([["a", task("a", { notes: "draft" })]]), [], pending);
    expect(result.tasks.get("a")?.notes).toBe("draft");
    expect(result.deferredDeleteIds).toEqual(["a"]);
  });
});
