import assert from "node:assert/strict";
import test from "node:test";
import { dropPositionFromRect, resolveDropTarget } from "../lib/kanban-drag.ts";

const card = { top: 100, height: 60 };

test("dropPositionFromRect splits a card at its midpoint", () => {
  assert.equal(dropPositionFromRect(card, 120), "before");
  assert.equal(dropPositionFromRect(card, 129), "before");
  assert.equal(dropPositionFromRect(card, 130), "after");
  assert.equal(dropPositionFromRect(card, 155), "after");
});

test("a release over another card targets that slot", () => {
  assert.deepEqual(resolveDropTarget({ draggedTaskId: "a", overTaskId: "b", overListId: "todo", rect: card, clientY: 110 }), {
    listId: "todo",
    taskId: "b",
    position: "before",
  });
  assert.deepEqual(resolveDropTarget({ draggedTaskId: "a", overTaskId: "b", overListId: "todo", rect: card, clientY: 150 }), {
    listId: "todo",
    taskId: "b",
    position: "after",
  });
});

test("a release over the dragged card itself falls back to the list", () => {
  assert.deepEqual(resolveDropTarget({ draggedTaskId: "a", overTaskId: "a", overListId: "todo", rect: card, clientY: 110 }), {
    listId: "todo",
    taskId: null,
    position: "after",
  });
});

test("a release over list background appends to the end", () => {
  assert.deepEqual(resolveDropTarget({ draggedTaskId: "a", overListId: "doing" }), {
    listId: "doing",
    taskId: null,
    position: "after",
  });
});

test("a release outside any list is not a drop", () => {
  assert.equal(resolveDropTarget({ draggedTaskId: "a" }), null);
  assert.equal(resolveDropTarget({ draggedTaskId: "a", overTaskId: "b", rect: null, clientY: 110 }), null);
});
