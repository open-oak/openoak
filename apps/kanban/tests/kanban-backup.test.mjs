import assert from "node:assert/strict";
import test from "node:test";
import { starterBoards } from "../lib/kanban-data.ts";
import { createKanbanBackup, parseKanbanBackup } from "../lib/kanban-backup.ts";

test("backup documents round-trip boards and the active board", () => {
  const boards = structuredClone(starterBoards);
  const text = createKanbanBackup(boards, "main", new Date("2026-07-23T12:00:00.000Z"));

  assert.deepEqual(parseKanbanBackup(text), {
    activeBoardId: "main",
    boards,
  });
  assert.match(text, /"version": 2/);
  assert.match(text, /"exportedAt": "2026-07-23T12:00:00.000Z"/);
});

test("backup parsing rejects malformed JSON", () => {
  assert.equal(parseKanbanBackup("{broken"), null);
});

test("backup parsing rejects unrelated or unsupported documents", () => {
  assert.equal(parseKanbanBackup('{"format":"other","version":1,"boards":[]}'), null);
  assert.equal(parseKanbanBackup('{"format":"openkanban","version":2,"boards":[]}'), null);
  assert.equal(parseKanbanBackup('{"format":"openkanban","version":1,"boards":{}}'), null);
});

 test("imports reject malformed content and duplicate identities without silently repairing it", () => {
  for (const change of [
    board => { board.tasks.push({ ...board.tasks[0] }); },
    board => { board.tasks[0].listId = "missing"; },
    board => { board.tasks[0].order = 8; },
    board => { board.lists[0].color = "unsupported"; },
    board => { board.tasks[0].description = null; },
    board => { board.unrecognized = "would be lost"; },
  ]) {
    const board = structuredClone(starterBoards[0]); change(board);
    assert.equal(parseKanbanBackup(createKanbanBackup([board], board.id)), null);
  }
  assert.equal(parseKanbanBackup(createKanbanBackup([starterBoards[0], starterBoards[0]], "main")), null);
});

 test("v1 backups still load; v2 keeps archive metadata and rejects duplicate active/archive IDs", () => {
  const board = structuredClone(starterBoards[0]);
  const old = JSON.stringify({ format: "openkanban", version: 1, boards: [board], activeBoardId: board.id });
  assert.deepEqual(parseKanbanBackup(old).boards, [board]);
  board.archivedTasks = [{ ...board.tasks.pop(), archivedAt: "2026-09-30T18:15:00.000Z" }];
  assert.deepEqual(parseKanbanBackup(createKanbanBackup([board], board.id)).boards, [board]);
  board.archivedTasks[0].id = board.tasks[0].id;
  assert.equal(parseKanbanBackup(createKanbanBackup([board], board.id)), null);
});
