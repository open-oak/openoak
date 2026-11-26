import assert from "node:assert/strict";
import test from "node:test";
import {
  addTask,
  deleteList,
  deleteTask,
  describeTaskPosition,
  moveTaskRelativeToTask,
  moveTaskToIndex,
  moveTaskToList,
  reorderLists,
  shiftTaskAcrossLists,
  shiftTaskWithinList,
  updateTask,
} from "../lib/kanban-board.ts";
import { tasksForList } from "../lib/kanban-data.ts";

function board() {
  return {
    id: "board",
    name: "Board",
    lists: [
      { id: "todo", name: "To do", color: "blue", icon: "circle" },
      { id: "doing", name: "Doing", color: "gold", icon: "clock" },
      { id: "done", name: "Done", color: "green", icon: "check" },
    ],
    tasks: [
      { id: "a", title: "A", description: "", dueDate: "", color: null, listId: "todo", order: 0 },
      { id: "b", title: "B", description: "", dueDate: "", color: null, listId: "todo", order: 1 },
      { id: "c", title: "C", description: "", dueDate: "", color: "red", listId: "todo", order: 2 },
      { id: "x", title: "X", description: "", dueDate: "", color: null, listId: "doing", order: 0 },
      { id: "y", title: "Y", description: "", dueDate: "", color: null, listId: "doing", order: 1 },
    ],
  };
}

function ids(result, listId) {
  return tasksForList(result.tasks, listId).map((task) => task.id);
}

function ordersAreContiguous(result) {
  return result.lists.every((list) => tasksForList(result.tasks, list.id).every((task, index) => task.order === index));
}

test("addTask appends to the end of its list", () => {
  const result = addTask(board(), "todo", "new", "New");
  assert.deepEqual(ids(result, "todo"), ["a", "b", "c", "new"]);
  assert.equal(result.tasks.find((task) => task.id === "new").order, 3);
});

test("moveTaskToIndex inserts at an exact slot and renumbers", () => {
  const result = moveTaskToIndex(board(), "c", "todo", 0);
  assert.deepEqual(ids(result, "todo"), ["c", "a", "b"]);
  assert.ok(ordersAreContiguous(result));
});

test("moving a task down inside its own list uses the post-removal index", () => {
  const result = moveTaskToIndex(board(), "a", "todo", 1);
  assert.deepEqual(ids(result, "todo"), ["b", "a", "c"]);
});

test("moveTaskToIndex clamps out-of-range indexes instead of dropping the task", () => {
  const high = moveTaskToIndex(board(), "a", "doing", 99);
  assert.deepEqual(ids(high, "doing"), ["x", "y", "a"]);

  const low = moveTaskToIndex(board(), "a", "doing", -5);
  assert.deepEqual(ids(low, "doing"), ["a", "x", "y"]);
});

test("moveTaskToIndex returns the same board when nothing moves", () => {
  const start = board();
  assert.equal(moveTaskToIndex(start, "a", "todo", 0), start);
  assert.equal(moveTaskToIndex(start, "missing", "todo", 0), start);
  assert.equal(moveTaskToIndex(start, "a", "missing-list", 0), start);
});

test("moveTaskToList appends to the target list", () => {
  const result = moveTaskToList(board(), "a", "doing");
  assert.deepEqual(ids(result, "doing"), ["x", "y", "a"]);
  assert.deepEqual(ids(result, "todo"), ["b", "c"]);
  assert.ok(ordersAreContiguous(result));
});

test("moveTaskRelativeToTask drops before and after a card across lists", () => {
  const before = moveTaskRelativeToTask(board(), "a", "y", "before");
  assert.deepEqual(ids(before, "doing"), ["x", "a", "y"]);

  const after = moveTaskRelativeToTask(board(), "a", "x", "after");
  assert.deepEqual(ids(after, "doing"), ["x", "a", "y"]);
});

test("moveTaskRelativeToTask reorders within a list in both directions", () => {
  assert.deepEqual(ids(moveTaskRelativeToTask(board(), "a", "c", "after"), "todo"), ["b", "c", "a"]);
  assert.deepEqual(ids(moveTaskRelativeToTask(board(), "c", "a", "before"), "todo"), ["c", "a", "b"]);
});

test("moveTaskRelativeToTask ignores a drop onto itself or a missing card", () => {
  const start = board();
  assert.equal(moveTaskRelativeToTask(start, "a", "a", "before"), start);
  assert.equal(moveTaskRelativeToTask(start, "a", "missing", "before"), start);
});

test("shiftTaskWithinList moves one slot and stops at the ends", () => {
  const start = board();
  assert.deepEqual(ids(shiftTaskWithinList(start, "b", -1), "todo"), ["b", "a", "c"]);
  assert.deepEqual(ids(shiftTaskWithinList(start, "b", 1), "todo"), ["a", "c", "b"]);
  assert.equal(shiftTaskWithinList(start, "a", -1), start);
  assert.equal(shiftTaskWithinList(start, "c", 1), start);
});

test("shiftTaskAcrossLists keeps the task at the same depth", () => {
  const result = shiftTaskAcrossLists(board(), "b", 1);
  assert.deepEqual(ids(result, "doing"), ["x", "b", "y"]);
  assert.deepEqual(ids(result, "todo"), ["a", "c"]);
});

test("shiftTaskAcrossLists clamps depth into a shorter list and stops at the edges", () => {
  const start = board();
  assert.deepEqual(ids(shiftTaskAcrossLists(start, "c", 1), "doing"), ["x", "y", "c"]);
  assert.equal(shiftTaskAcrossLists(start, "a", -1), start);
  assert.equal(shiftTaskAcrossLists(start, "x", 99), start);
});

test("updateTask keeps order when fields change and appends on a list change", () => {
  const renamed = updateTask(board(), "b", { title: "B2" });
  assert.deepEqual(ids(renamed, "todo"), ["a", "b", "c"]);
  assert.equal(renamed.tasks.find((task) => task.id === "b").title, "B2");

  const moved = updateTask(board(), "b", { listId: "doing", color: "green" });
  assert.deepEqual(ids(moved, "doing"), ["x", "y", "b"]);
  assert.equal(moved.tasks.find((task) => task.id === "b").color, "green");
  assert.ok(ordersAreContiguous(moved));
});

test("deleteTask renumbers the remaining tasks", () => {
  const result = deleteTask(board(), "a");
  assert.deepEqual(ids(result, "todo"), ["b", "c"]);
  assert.ok(ordersAreContiguous(result));
});

test("deleteList appends orphaned tasks to the fallback list", () => {
  const result = deleteList(board(), "todo");
  assert.deepEqual(
    result.lists.map((list) => list.id),
    ["doing", "done"]
  );
  assert.deepEqual(ids(result, "doing"), ["x", "y", "a", "b", "c"]);
  assert.ok(ordersAreContiguous(result));
});

test("deleteList refuses to remove the last list", () => {
  const single = { ...board(), lists: [{ id: "todo", name: "To do", color: "blue", icon: "circle" }] };
  assert.equal(deleteList(single, "todo"), single);
});

test("reorderLists moves a list without disturbing task order", () => {
  const result = reorderLists(board(), "done", "todo");
  assert.deepEqual(
    result.lists.map((list) => list.id),
    ["done", "todo", "doing"]
  );
  assert.deepEqual(ids(result, "todo"), ["a", "b", "c"]);
});

test("describeTaskPosition reports a one-based position for announcements", () => {
  assert.equal(describeTaskPosition(board(), "b"), "B, 2 of 3 in To do");
  assert.equal(describeTaskPosition(board(), "missing"), "");
});
