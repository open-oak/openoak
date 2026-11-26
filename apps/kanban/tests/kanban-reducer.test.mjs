import assert from "node:assert/strict";
import test from "node:test";
import { activeBoardOf, boardReducer } from "../lib/kanban-reducer.ts";
import { cleanBoards, tasksForList } from "../lib/kanban-data.ts";

function state() {
  const boards = cleanBoards([
    {
      id: "first",
      name: "First",
      lists: [
        { id: "todo", name: "To do", color: "blue", icon: "circle" },
        { id: "doing", name: "Doing", color: "gold", icon: "clock" },
      ],
      tasks: [
        { id: "a", title: "A", listId: "todo", order: 0 },
        { id: "b", title: "B", listId: "todo", order: 1, color: "yellow" },
        { id: "x", title: "X", listId: "doing", order: 0 },
      ],
    },
    { id: "second", name: "Second", lists: null, tasks: [] },
  ]);

  return { boards, activeBoardId: "first" };
}

function ids(next, listId) {
  return tasksForList(activeBoardOf(next).tasks, listId).map((task) => task.id);
}

test("board actions apply to the active board only", () => {
  const next = boardReducer(state(), { type: "addTask", listId: "todo", id: "new", title: "New" });
  assert.deepEqual(ids(next, "todo"), ["a", "b", "new"]);
  assert.deepEqual(next.boards[1].tasks, []);
});

test("board appearance updates apply only to the active board", () => {
  const next = boardReducer(state(), {
    type: "updateBoardAppearance",
    updates: { theme: "coral", wallpaper: "6", wallpaperBlur: true },
  });

  assert.deepEqual(
    { theme: next.boards[0].theme, wallpaper: next.boards[0].wallpaper, wallpaperBlur: next.boards[0].wallpaperBlur },
    { theme: "coral", wallpaper: "6", wallpaperBlur: true }
  );
  assert.deepEqual(
    { theme: next.boards[1].theme, wallpaper: next.boards[1].wallpaper, wallpaperBlur: next.boards[1].wallpaperBlur },
    { theme: "default", wallpaper: "none", wallpaperBlur: false }
  );
});

test("task moves route through the domain rules", () => {
  const moved = boardReducer(state(), { type: "moveTaskRelativeToTask", taskId: "a", targetTaskId: "x", position: "before" });
  assert.deepEqual(ids(moved, "doing"), ["a", "x"]);

  const shifted = boardReducer(state(), { type: "shiftTaskWithinList", taskId: "a", offset: 1 });
  assert.deepEqual(ids(shifted, "todo"), ["b", "a"]);
});

test("unchanged mutations return the same state reference", () => {
  const start = state();
  assert.equal(boardReducer(start, { type: "shiftTaskWithinList", taskId: "a", offset: -1 }), start);
  assert.equal(boardReducer(start, { type: "selectBoard", boardId: "missing" }), start);
});

test("selectBoard switches boards and createBoard activates the new board", () => {
  const selected = boardReducer(state(), { type: "selectBoard", boardId: "second" });
  assert.equal(selected.activeBoardId, "second");

  const created = boardReducer(state(), { type: "createBoard", id: "third", name: "Third" });
  assert.equal(created.activeBoardId, "third");
  assert.equal(created.boards.length, 3);
  assert.equal(activeBoardOf(created).lists.length, 3);
  assert.deepEqual(
    { theme: activeBoardOf(created).theme, wallpaper: activeBoardOf(created).wallpaper, wallpaperBlur: activeBoardOf(created).wallpaperBlur },
    { theme: "default", wallpaper: "none", wallpaperBlur: false }
  );
});

test("deleting the active board falls back to a neighbour", () => {
  const next = boardReducer({ ...state(), activeBoardId: "second" }, { type: "deleteActiveBoard", replacementId: "fresh" });
  assert.deepEqual(
    next.boards.map((board) => board.id),
    ["first"]
  );
  assert.equal(next.activeBoardId, "first");
});

test("deleting the only board resets it instead of leaving none", () => {
  const single = { boards: [state().boards[0]], activeBoardId: "first" };
  const next = boardReducer(single, { type: "deleteActiveBoard", replacementId: "fresh" });
  assert.equal(next.boards.length, 1);
  assert.equal(next.boards[0].id, "fresh");
  assert.deepEqual(next.boards[0].tasks, []);
});

test("deleteList keeps tasks by appending them to the surviving list", () => {
  const next = boardReducer(state(), { type: "deleteList", listId: "todo" });
  assert.deepEqual(ids(next, "doing"), ["x", "a", "b"]);
});

test("replaceState repairs an unknown active board id", () => {
  const next = boardReducer(state(), { type: "replaceState", boards: state().boards, activeBoardId: "missing" });
  assert.equal(next.activeBoardId, "first");
});

test("replaceState falls back to a starter board when given none", () => {
  const next = boardReducer(state(), { type: "replaceState", boards: [], activeBoardId: "missing" });
  assert.equal(next.boards.length, 1);
  assert.equal(next.activeBoardId, next.boards[0].id);
});
