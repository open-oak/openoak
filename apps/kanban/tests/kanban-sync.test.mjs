import assert from "node:assert/strict";
import test from "node:test";
import { cleanSyncDocument } from "../lib/kanban-sync.ts";

const boards = [{ id: "main", name: "Main", lists: [{ id: "todo", name: "To do" }], tasks: [] }];

test("cleanSyncDocument accepts a versioned cloud document", () => {
  const document = cleanSyncDocument({
    boards,
    activeBoardId: "main",
    revision: 3,
    updatedAt: "2026-07-23T12:00:00.000Z",
  });

  assert.equal(document?.revision, 3);
  assert.equal(document?.activeBoardId, "main");
});

test("cleanSyncDocument rejects invalid revisions", () => {
  assert.equal(cleanSyncDocument({ boards, activeBoardId: "main", revision: 0 }), null);
  assert.equal(cleanSyncDocument({ boards, activeBoardId: "main", revision: 1.5 }), null);
});

test("cleanSyncDocument repairs a missing active board", () => {
  const document = cleanSyncDocument({ boards, activeBoardId: "missing", revision: 1 });
  assert.equal(document?.activeBoardId, "main");
});

test("a cloud document written before ordering gains a stable task order", () => {
  const document = cleanSyncDocument({
    boards: [
      {
        id: "main",
        name: "Main",
        lists: [
          { id: "todo", name: "To do" },
          { id: "doing", name: "Doing" },
        ],
        tasks: [
          { id: "a", title: "A", listId: "todo" },
          { id: "x", title: "X", listId: "doing" },
          { id: "b", title: "B", listId: "todo" },
        ],
      },
    ],
    activeBoardId: "main",
    revision: 2,
  });

  assert.deepEqual(
    document?.boards[0].tasks.map((task) => [task.id, task.listId, task.order]),
    [
      ["a", "todo", 0],
      ["b", "todo", 1],
      ["x", "doing", 0],
    ]
  );
});
