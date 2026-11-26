import assert from "node:assert/strict";
import test from "node:test";
import { KanbanBrowserStore } from "../lib/kanban-browser-store.ts";
import { starterBoards } from "../lib/kanban-data.ts";

function setup() {
  const values = new Map();
  const board = structuredClone(starterBoards[0]);
  const profile = { accountKey: "account", epoch: 1, activeBoardKey: "board-key", boardOrderVersion: 1, version: 1 };
  const summary = { ...board, boardKey: "board-key", revision: 1, metadataVersion: 1, listOrderVersion: 1, cardCount: board.tasks.length };
  const remote = {
    summary,
    epoch: 1,
    lists: board.lists.map((list) => ({ ...list, metadataVersion: 1, orderVersion: 1 })),
    cards: board.tasks.map((card) => ({ ...card, contentVersion: 1, placementVersion: 1 })),
  };
  let catalogs = 0;
  let view;
  const sent = [];
  const api = {
    async catalog() { catalogs++; return structuredClone({ profile, boards: [summary] }); },
    async board() { return structuredClone(remote); },
    async refreshBoard() { return structuredClone(remote); },
    async send(operation) {
      sent.push(operation);
      const card = remote.cards.find((card) => card.id === operation.cardId);
      Object.assign(card, operation.changes);
      card.contentVersion++;
      summary.revision++;
      return { operationId: operation.operationId, status: "applied", appliedRevision: summary.revision };
    },
  };
  const store = new KanbanBrowserStore({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }, "account", api, (next) => { view = next; });
  return { store, remote, sent, catalogs: () => catalogs, view: () => view };
}

test("initial load and idle sync each refresh the catalog once and adopt remote edits", async () => {
  const t = setup();
  await t.store.start();
  assert.equal(t.catalogs(), 1);
  t.remote.cards[0].title = "Changed on another device";
  await t.store.sync();
  assert.equal(t.catalogs(), 2);
  assert.equal(t.view().state.boards[0].tasks[0].title, "Changed on another device");
  assert.equal(t.view().status, "synced");
  await t.store.stop();
});

test("saving an edit retains the pre-write refresh and adopts the acknowledged server version", async () => {
  const t = setup();
  await t.store.start();
  const before = t.catalogs();
  const card = t.remote.cards[0];
  t.store.dispatch({ type: "updateTask", taskId: card.id, updates: { title: "Saved edit" } });
  await t.store.sync();
  assert.equal(t.catalogs() - before, 2);
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].expectedContentVersion, 1);
  assert.equal(t.view().pending, 0);
  assert.equal(t.view().status, "synced");
  assert.equal(t.view().state.boards[0].tasks[0].title, "Saved edit");
  await t.store.stop();
});
