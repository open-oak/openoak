import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanBoards,
  defaultLists,
  legacyCardsToTasks,
  normalizeTaskOrder,
  serializeBoardState,
  tasksForList,
} from "../lib/kanban-data.ts";

const twoLists = [
  { id: "todo", name: "To do", color: "blue", icon: "circle" },
  { id: "doing", name: "Doing", color: "gold", icon: "clock" },
];

test("cleanBoards preserves valid boards and normalizes invalid task lists", () => {
  const boards = cleanBoards([
    {
      id: "board",
      name: " Work ",
      lists: [{ id: "todo", name: "To do", color: "blue", icon: "circle" }],
      tasks: [{ id: "task", title: " Ship ", listId: "missing", done: true, color: "red" }],
    },
  ]);

  assert.equal(boards[0].name, "Work");
  assert.equal(boards[0].tasks[0].title, "Ship");
  assert.equal(boards[0].tasks[0].listId, "todo");
  assert.equal(boards[0].tasks[0].color, "red");
  assert.equal("done" in boards[0].tasks[0], false);
});

test("cleanBoards preserves blank draft task titles", () => {
  const [board] = cleanBoards([
    {
      id: "board",
      name: "Board",
      lists: twoLists,
      tasks: [{ id: "draft", title: "", listId: "todo" }],
    },
  ]);

  assert.equal(board.tasks[0].title, "");
});

test("cleanBoards accepts theme list colors and repairs retired colors", () => {
  const [board] = cleanBoards([
    {
      id: "board",
      name: "Board",
      lists: [
        { id: "default", name: "Default", color: "default" },
        { id: "purple", name: "Purple", color: "purple" },
        { id: "old", name: "Old", color: "slate" },
      ],
      tasks: [],
    },
  ]);

  assert.deepEqual(board.lists.map((list) => list.color), ["default", "purple", "blue"]);
});

test("cleanBoards defaults missing or invalid task colors to none", () => {
  const [board] = cleanBoards([
    {
      id: "board",
      name: "Board",
      lists: [{ id: "todo", name: "To do" }],
      tasks: [
        { id: "missing", title: "Missing", listId: "todo" },
        { id: "invalid", title: "Invalid", color: "purple", listId: "todo" },
      ],
    },
  ]);

  assert.deepEqual(board.tasks.map((task) => task.color), [null, null]);
});

test("cleanBoards returns independent default lists", () => {
  const boards = cleanBoards([{ id: "board", name: "Board", lists: null, tasks: [] }]);
  boards[0].lists[0].name = "Changed";
  assert.equal(defaultLists[0].name, "To do");
});

test("cleanBoards migrates legacy global appearance onto boards that do not store it", () => {
  const [board] = cleanBoards(
    [{ id: "board", name: "Board", lists: [], tasks: [] }],
    { theme: "purple", wallpaper: "4", wallpaperBlur: true }
  );

  assert.deepEqual(
    { theme: board.theme, wallpaper: board.wallpaper, wallpaperBlur: board.wallpaperBlur },
    { theme: "purple", wallpaper: "4", wallpaperBlur: true }
  );
});

test("cleanBoards preserves independent appearance for every board", () => {
  const boards = cleanBoards([
    { id: "first", name: "First", lists: [], tasks: [], theme: "green", wallpaper: "none", wallpaperBlur: false },
    { id: "second", name: "Second", lists: [], tasks: [], theme: "default", wallpaper: "8", wallpaperBlur: true },
  ]);

  assert.deepEqual(
    boards.map(({ theme, wallpaper, wallpaperBlur }) => ({ theme, wallpaper, wallpaperBlur })),
    [
      { theme: "green", wallpaper: "none", wallpaperBlur: false },
      { theme: "default", wallpaper: "8", wallpaperBlur: true },
    ]
  );
});

test("serializeBoardState is stable for unchanged state", () => {
  const boards = cleanBoards([{ id: "board", name: "Board", lists: [], tasks: [] }]);
  assert.equal(serializeBoardState(boards, "board"), serializeBoardState(boards, "board"));
});

test("tasks stored before ordering existed keep their array order", () => {
  const boards = cleanBoards([
    {
      id: "board",
      name: "Board",
      lists: twoLists,
      tasks: [
        { id: "a", title: "A", listId: "todo" },
        { id: "x", title: "X", listId: "doing" },
        { id: "b", title: "B", listId: "todo" },
      ],
    },
  ]);

  assert.deepEqual(
    tasksForList(boards[0].tasks, "todo").map((task) => task.id),
    ["a", "b"]
  );
  assert.deepEqual(
    tasksForList(boards[0].tasks, "todo").map((task) => task.order),
    [0, 1]
  );
});

test("normalizeTaskOrder renumbers per list and keeps ties in array order", () => {
  const tasks = normalizeTaskOrder(
    [
      { id: "a", title: "A", description: "", dueDate: "", color: null, listId: "todo", order: 7 },
      { id: "b", title: "B", description: "", dueDate: "", color: null, listId: "todo", order: 7 },
      { id: "x", title: "X", description: "", dueDate: "", color: null, listId: "doing", order: 3 },
    ],
    twoLists
  );

  assert.deepEqual(
    tasks.map((task) => [task.id, task.order]),
    [
      ["a", 0],
      ["b", 1],
      ["x", 0],
    ]
  );
});

test("normalizeTaskOrder moves tasks from unknown lists into the first list", () => {
  const tasks = normalizeTaskOrder(
    [
      { id: "a", title: "A", description: "", dueDate: "", color: null, listId: "gone", order: 0 },
      { id: "b", title: "B", description: "", dueDate: "", color: null, listId: "todo", order: 0 },
    ],
    twoLists
  );

  assert.deepEqual(
    tasksForList(tasks, "todo").map((task) => task.id),
    ["b", "a"]
  );
});

test("normalized boards serialize identically regardless of stored array order", () => {
  const shuffled = cleanBoards([
    {
      id: "board",
      name: "Board",
      lists: twoLists,
      tasks: [
        { id: "b", title: "B", listId: "todo", order: 1 },
        { id: "x", title: "X", listId: "doing", order: 0 },
        { id: "a", title: "A", listId: "todo", order: 0 },
      ],
    },
  ]);
  const ordered = cleanBoards([
    {
      id: "board",
      name: "Board",
      lists: twoLists,
      tasks: [
        { id: "a", title: "A", listId: "todo", order: 0 },
        { id: "b", title: "B", listId: "todo", order: 1 },
        { id: "x", title: "X", listId: "doing", order: 0 },
      ],
    },
  ]);

  assert.equal(serializeBoardState(shuffled, "board"), serializeBoardState(ordered, "board"));
});

test("legacy cards become ordered tasks in their matching lists", () => {
  const tasks = legacyCardsToTasks(
    [
      { id: "1", title: "One", column: "todo" },
      { id: "2", title: "Two", column: "doing" },
      { id: "3", title: "Three", column: "todo" },
    ],
    twoLists
  );

  assert.deepEqual(
    tasksForList(tasks, "todo").map((task) => [task.id, task.order]),
    [
      ["1", 0],
      ["3", 1],
    ]
  );
});
