import { z } from "zod";
import { createKanbanBackup, parseKanbanBackup } from "../../lib/kanban-backup.ts";
import { kanbanV2ReadSchemas } from "../../lib/kanban-v2-schemas.ts";
import { initializeNewKanbanAccount, changeBoardSharing, getBoardSharing, acceptBoardInvite } from "../../lib/kanban-sharing.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import { createKanbanTestDatabase } from "../helpers/database.mjs";
import { starterBoards } from "../../lib/kanban-data.ts";
import { backfillOwner, cutoverOwner, retireCompatibilityMirror } from "../../lib/kanban-migration.ts";
import { kanbanReadResponse, kanbanOperationResponse } from "../../lib/kanban-v2-http.ts";
import { KanbanBrowserApi } from "../../lib/kanban-browser-api.ts";
import { KanbanBrowserStore } from "../../lib/kanban-browser-store.ts";
import { applyKanbanOperation } from "../../lib/kanban-operations.ts";
let database;
before(async () => { database = await createKanbanTestDatabase(); });
after(async () => { await database?.close(); });
function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
async function setup() {
  const owner = randomUUID(), pool = database.pool;
  const boards = structuredClone(starterBoards);
  boards.push({ ...structuredClone(boards[0]), id: "second", name: "Second board" });
  await pool.query('INSERT INTO "KanbanDocument" ("userId","boards","activeBoardId","revision") VALUES ($1,$2::jsonb,$3,1)', [owner, JSON.stringify(boards), boards[0].id]);
  await backfillOwner(pool, owner); await cutoverOwner(pool, owner); await retireCompatibilityMirror(pool, owner);
  const requests = [];
  let offline = false, loseReply = false, malformedReply = false;
  const request = async (path, init) => {
    if (offline) throw new TypeError("Failed to fetch");
    requests.push({ path, init });
    const url = new URL(path, "http://localhost");
    if (init?.method === "POST") {
      const result = await kanbanOperationResponse(owner, new Request(url, init), pool, url.pathname.endsWith("/imports"));
      if (loseReply) { loseReply = false; throw new TypeError("Lost reply"); }
      if (malformedReply) { malformedReply = false; return Response.json({ unexpected: true }); }
      return result;
    }
    return kanbanReadResponse(owner, url.pathname.split("/").at(-1), url.searchParams, pool, new Headers(init?.headers).get("x-openkanban-capabilities") === "sharing");
  };
  const api = new KanbanBrowserApi(request), db = storage();
  let view;
  const make = () => new KanbanBrowserStore(db, owner, api, (next) => { view = next; });
  const store = make(); await store.start();
  return { store, make, api, owner, db, requests, view: () => view, offline: (value) => { offline = value; }, loseReply: () => { loseReply = true; }, malformedReply: () => { malformedReply = true; } };
}
test("selected-board loading, offline reload and exactly-once lost-response retry", async () => {
  const t = await setup();
  const catalog = await t.api.catalog(), selected = catalog.boards[0], second = catalog.boards[1];
  assert.equal(t.requests.some(({ path }) => path.includes(second.boardKey)), false);
  t.offline(true);
  t.store.dispatch({ type: "addTask", listId: "todo", id: "offline-card", title: "Offline creation" });
  t.store.dispatch({ type: "updateTask", taskId: "offline-card", updates: { description: "Retained through reload" } });
  await t.store.sync(); assert.equal(t.view().status, "offline");
  t.store.stop();
  const reloaded = t.make(); await reloaded.start();
  assert.equal(t.view().state.boards[0].tasks.find((task) => task.id === "offline-card").description, "Retained through reload");
  t.offline(false); t.loseReply(); await reloaded.sync();
  assert.equal(t.view().pending, 2);
  await reloaded.sync(); assert.equal(t.view().pending, 0);
  const cards = await t.api.read("card-details", { boardKey: selected.boardKey });
  assert.equal(cards.items.filter((item) => item.kind === "card" && item.card.id === "offline-card").length, 1);
  assert.equal(cards.items.find((item) => item.kind === "card" && item.card.id === "offline-card").card.description, "Retained through reload");
  const posts = t.requests.filter(({ init }) => init?.method === "POST").map(({ init }) => JSON.parse(init.body));
  assert.deepEqual(posts[0], posts[1]);
});
test("unrelated remote edits survive while same-field conflicts retain exportable drafts", async () => {
  const t = await setup();
  const { profile, boards } = await t.api.catalog(), board = boards[0];
  t.store.dispatch({ type: "updateTask", taskId: "1", updates: { title: "My title" } });
  await applyKanbanOperation(t.owner, { contractVersion: 2, operationId: randomUUID(), epoch: profile.epoch, boardKey: board.boardKey, type: "card.update", cardId: "2", expectedContentVersion: 1, changes: { title: "Remote other card" } }, database.pool);
  await t.store.sync();
  assert.equal(t.view().status, "synced");
  assert.equal(t.view().state.boards[0].tasks.find((task) => task.id === "2").title, "Remote other card");
  t.store.dispatch({ type: "updateTask", taskId: "1", updates: { title: "My conflicting draft" } });
  await applyKanbanOperation(t.owner, { contractVersion: 2, operationId: randomUUID(), epoch: profile.epoch, boardKey: board.boardKey, type: "card.update", cardId: "1", expectedContentVersion: 2, changes: { title: "Remote same card" } }, database.pool);
  await t.store.sync();
  assert.equal(t.view().status, "conflict"); assert.match(t.store.recovery(), /My conflicting draft/);
  assert.equal(t.view().state.boards[0].tasks.find((task) => task.id === "1").title, "My conflicting draft");
  await t.store.discardFirst();
  assert.equal(t.view().state.boards[0].tasks.find((task) => task.id === "1").title, "Remote same card");
});
test("browser creates, moves, deletes and selects through the common operation service", async () => {
  const t = await setup();
  t.store.dispatch({ type: "createList", id: "review", name: "Review", color: "green" });
  t.store.dispatch({ type: "moveTaskToList", taskId: "1", listId: "review" });
  t.store.dispatch({ type: "updateList", listId: "review", updates: { name: "Ready" } });
  await t.store.sync();
  assert.equal(t.view().status, "synced", t.view().message);
  assert.equal(t.view().state.boards[0].tasks.find((task) => task.id === "1").listId, "review");
  t.store.dispatch({ type: "deleteTask", taskId: "1" }); await t.store.sync();
  assert.equal(t.view().status, "synced", t.view().message);
  t.store.dispatch({ type: "deleteList", listId: "review" }); await t.store.sync();
  assert.equal(t.view().status, "synced", t.view().message);
  t.store.dispatch({ type: "createBoard", id: "new-board", name: "New board" });
  t.store.dispatch({ type: "addTask", listId: "todo", id: "new-task", title: "New task" });
  await t.store.sync();
  assert.equal(t.view().status, "synced", t.view().message);
  assert.equal(t.view().state.activeBoardId, "new-board");
  assert.equal(t.view().state.boards.find((board) => board.id === "new-board").tasks.length, 1);
});
test("explicit imports publish new owned copies atomically and export loads unloaded boards", async () => {
  const t = await setup();
  const original = await t.store.exportBoards();
  t.store.importBoards([original.boards[0]]);
  // import starts its own replay; wait for the observable persisted queue.
  for (let attempt = 0; attempt < 100 && t.view().status === "saving"; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(t.view().status, "synced", t.view().message);
  const exported = await t.store.exportBoards();
  assert.equal(exported.boards.length, 3);
  assert.notEqual(exported.boards[2].id, exported.boards[0].id);
  assert.deepEqual(exported.boards[2].tasks, exported.boards[0].tasks);
});
test("storage exhaustion rejects the edit without dropping earlier queued work", async () => {
  const t = await setup();
  t.offline(true);
  t.store.dispatch({ type: "updateTask", taskId: "1", updates: { title: "Saved before quota" } });
  const saved = t.store.recovery();
  t.db.setItem = () => { throw new Error("Quota exceeded"); };
  t.store.dispatch({ type: "updateTask", taskId: "1", updates: { title: "Unsaved new edit" } });
  assert.equal(t.store.recovery(), saved);
  assert.equal(t.view().status, "conflict");
  assert.equal(t.view().state.boards[0].tasks.find((task) => task.id === "1").title, "Saved before quota");
});
test("last-board reset uses stable replacement identity for queued follow-up edits", async () => {
  const t = await setup();
  t.store.dispatch({ type: "deleteActiveBoard", replacementId: "unused" }); await t.store.sync();
  t.store.dispatch({ type: "deleteActiveBoard", replacementId: "replacement" });
  t.store.dispatch({ type: "addTask", listId: "todo", id: "after-reset", title: "After reset" });
  await t.store.sync();
  assert.equal(t.view().status, "synced", t.view().message);
  assert.equal(t.view().state.boards[0].id, "replacement");
  assert.equal(t.view().state.boards[0].tasks[0].id, "after-reset");
});


test("pre-collaboration tabs receive their strict catalogue format; shared access requires a role-aware client", async () => {
  const t = await setup();
  const legacyBoard = kanbanV2ReadSchemas.boards.output.shape.items.element.omit({ accessLevel: true, shared: true }).strict();
  const legacySchema = kanbanV2ReadSchemas.boards.output.extend({ items: z.array(legacyBoard) }).strict();
  const modern = await kanbanReadResponse(t.owner, "boards", new URLSearchParams(), database.pool, true);
  const modernBody = await modern.json();
  // Reproduce the exact reported keys with the cached pre-collaboration contract.
  const rejected = legacySchema.safeParse(modernBody);
  assert.equal(rejected.success, false);
  assert.deepEqual(rejected.error.issues[0].keys, ["accessLevel", "shared"]);
  const compatible = await kanbanReadResponse(t.owner, "boards", new URLSearchParams(), database.pool, false);
  assert.equal(compatible.status, 200); legacySchema.parse(await compatible.json());
  const other = randomUUID(); await initializeNewKanbanAccount(other, database.pool);
  const key = (await kanbanReadResponse(other, "boards", new URLSearchParams(), database.pool)).json();
  const boardKey = (await key).items[0].boardKey;
  await changeBoardSharing(other, boardKey, "enable", undefined, database.pool);
  const token = (await getBoardSharing(other, boardKey, database.pool)).invitePath.split("/").at(-1);
  await acceptBoardInvite(t.owner, token, database.pool);
  const oldMember = await kanbanReadResponse(t.owner, "boards", new URLSearchParams(), database.pool, false);
  assert.equal(oldMember.status, 409); assert.match((await oldMember.json()).error.message, /Reload.*unsent edits remain saved/);
  assert.equal((await t.api.catalog()).boards.find(b => b.boardKey === boardKey).accessLevel, "editor");
});

test("an incompatible acknowledgement preserves the exact operation through reload and retry", async () => {
  const t = await setup();
  t.store.dispatch({ type: "addTask", id: "schema-retry", listId: "todo", title: "Keep this draft" });
  t.malformedReply(); await t.store.sync();
  assert.equal(t.view().status, "conflict"); assert.equal(t.view().reloadRequired, true);
  assert.equal(t.view().canDiscard, false); assert.equal(t.view().pending, 1);
  assert.match(t.store.recovery(), /Keep this draft/); assert.doesNotMatch(t.view().message, /unrecognized_keys/);
  await t.store.stop(); const reloaded = t.make(); await reloaded.start();
  assert.equal(t.view().status, "synced"); assert.equal(t.view().pending, 0);
  const posts = t.requests.filter(r => r.init?.method === "POST").map(r => JSON.parse(r.init.body));
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(t.view().state.boards[0].tasks.filter(t => t.id === "schema-retry").length, 1);
});

async function settle(t) {
  for (let attempt = 0; attempt < 200 && t.view().status === "saving"; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
}
test("offline deletion undo and persisted Trash restoration survive reload and lost replies", async () => {
  const t = await setup();
  const { boards } = await t.api.catalog(), board = boards[0];
  t.offline(true);
  t.store.dispatch({ type: "deleteTask", taskId: "1" }); await t.store.sync();
  await t.store.undoDelete(board.id, "1");
  assert.ok(t.view().state.boards[0].tasks.some((card) => card.id === "1"));
  assert.equal(t.view().pending, 0);
  await t.store.stop();
  t.offline(false); const online = t.make(); await online.start();
  online.dispatch({ type: "deleteTask", taskId: "1" }); t.loseReply(); await online.sync();
  await online.stop(); const reloaded = t.make(); await reloaded.start();
  assert.equal(t.view().pending, 0, JSON.stringify(t.view()));
  const trash = await t.api.read("trash", { boardKey: board.boardKey });
  assert.equal(trash.items.length, 1);
  t.offline(true);
  reloaded.recoverCard(board.id, "1", trash.items[0].deletionId);
  await settle(t); await reloaded.stop();
  const offlineReload = t.make(); await offlineReload.start();
  assert.equal(t.view().pending, 1);
  t.offline(false); t.loseReply(); await offlineReload.sync(); await offlineReload.sync();
  assert.equal(t.view().pending, 0);
  assert.equal(t.view().state.boards[0].tasks.filter((card) => card.id === "1").length, 1);
  assert.equal((await t.api.read("trash", { boardKey: board.boardKey })).items.length, 0);
});

test("synced deletion can be undone; stale undo cannot restore a later deletion", async () => {
  const t = await setup(); const { profile, boards } = await t.api.catalog(), board = boards[0];
  t.store.dispatch({ type: "deleteTask", taskId: "1" }); await t.store.sync();
  await t.store.undoDelete(board.id, "1"); await settle(t);
  assert.equal(t.view().status, "synced", t.view().message);
  assert.ok(t.view().state.boards[0].tasks.some((card) => card.id === "1"));
  await applyKanbanOperation(t.owner, { contractVersion: 2, operationId: randomUUID(), epoch: profile.epoch, boardKey: board.boardKey, type: "card.delete", cardId: "1", expectedContentVersion: 2, expectedPlacementVersion: 2 }, database.pool);
  await assert.rejects(t.store.undoDelete(board.id, "1"), /changed since deletion/);
});

test("one-board archive round-trip preserves active and archived content, and creates independent copies", async () => {
  const t = await setup(); const catalog = await t.api.catalog(), board = catalog.boards[0];
  t.store.dispatch({ type: "updateTask", taskId: "2", updates: { title: "Unicode 🪵", description: "Full notes\nhttps://example.test", dueDate: "2026-12-01", color: "green" } });
  t.store.dispatch({ type: "updateBoardAppearance", updates: { wallpaper: "5", wallpaperBlur: true, theme: "purple" } });
  t.store.dispatch({ type: "deleteTask", taskId: "1" }); await t.store.sync();
  const original = await t.store.exportBoards(board.id);
  const parsed = parseKanbanBackup(createKanbanBackup(original.boards, board.id));
  assert.ok(parsed);
  assert.equal(parsed.boards.length, 1); assert.equal(parsed.boards[0].tasks.some((card) => card.id === "1"), false);
  for (let i = 0; i < 2; i++) { t.store.importBoards(parsed.boards); await settle(t); assert.equal(t.view().status, "synced", t.view().message); }
  const result = await t.store.exportBoards();
  assert.equal(result.boards.length, 4);
  const imported = result.boards.filter((item) => !catalog.boards.some((existing) => item.id === existing.id));
  assert.equal(imported.length, 2);
  for (const copy of imported) assert.deepEqual({ ...copy, id: board.id }, original.boards[0]);
  assert.deepEqual((await t.store.exportBoards(board.id)).boards, original.boards);
  assert.equal((await t.api.read("trash", { boardKey: board.boardKey })).items.length, 1);
  for (const copy of (await t.api.catalog()).boards.filter((item) => imported.some((board) => board.id === item.id))) {
    assert.equal(copy.accessLevel, "owner"); assert.equal(copy.shared, false);
    assert.equal((await t.api.read("trash", { boardKey: copy.boardKey })).items.length, 1);
  }
});

 test("rapid archive actions and undo retain every card without sync alerts", async () => {
  const t = await setup(); const board = (await t.api.catalog()).boards[0];
  t.store.dispatch({ type: "updateTask", taskId: "1", updates: { description: "Edited immediately before archive" } });
  t.store.dispatch({ type: "deleteTask", taskId: "1" });
  t.store.dispatch({ type: "deleteTask", taskId: "2" });
  await t.store.sync();
  assert.equal(t.view().status, "synced", t.view().message);
  assert.equal(t.view().message, undefined);
  assert.equal((await t.api.read("archive", { boardKey: board.boardKey })).items.length, 2);
  const first = await t.api.read("archive", { boardKey: board.boardKey, limit: 1 });
  const second = await t.api.read("archive", { boardKey: board.boardKey, limit: 1, cursor: first.nextCursor });
  assert.equal(new Set([...first.items, ...second.items].map((card) => card.id)).size, 2);
  assert.equal(second.nextCursor, undefined);
  await t.store.undoDelete(board.id, "2"); await settle(t);
  await t.store.undoDelete(board.id, "1"); await settle(t);
  assert.equal(t.view().status, "synced", t.view().message);
  assert.equal((await t.api.completeCard(board.boardKey, "1")).description, "Edited immediately before archive");
  assert.equal((await t.api.read("archive", { boardKey: board.boardKey })).items.length, 0);
});
 test("archive searches retained content, reads long content, and restores to a chosen list", async () => {
  const t = await setup(); const { profile, boards } = await t.api.catalog(), board = boards[0];
  const description = "archive detail 🪵 ".repeat(10000);
  await database.pool.query('UPDATE "KanbanCard" SET "description"=$3 WHERE "boardKey"=$1 AND "id"=$2', [board.boardKey, "1", description]);
  const archive = { contractVersion: 2, operationId: randomUUID(), epoch: profile.epoch, boardKey: board.boardKey, type: "card.archive", cardId: "1", expectedContentVersion: 1, expectedPlacementVersion: 1 };
  await applyKanbanOperation(t.owner, archive, database.pool);
  const entries = await t.api.read("archive", { boardKey: board.boardKey, query: "detail" });
  assert.equal(entries.items.length, 1);
  assert.equal((await t.api.read("archive", { boardKey: board.boardKey, query: "absent" })).items.length, 0);
  const card = await t.api.completeCard(board.boardKey, "1", true);
  assert.equal(card.description, description);
  assert.equal(card.deletionId, entries.items[0].deletionId);
  assert.ok(card.archivedAt);
  const operationId = t.store.recoverCard(board.id, "1", card.deletionId, false, "done");
  await t.store.waitForOperation(operationId);
  assert.equal((await t.api.completeCard(board.boardKey, "1")).listId, "done");
  assert.equal(t.view().message, undefined);
});

 test("an archive during export cannot silently omit its content from the backup", async () => {
  const t = await setup();
  const original = t.api.backupBoard.bind(t.api);
  let edited = false;
  t.api.backupBoard = async (...args) => {
    const board = await original(...args);
    if (!edited) { edited = true; t.store.dispatch({ type: "deleteTask", taskId: "1" }); }
    return board;
  };
  await assert.rejects(t.store.exportBoards(), /changed during export/);
  await t.store.sync();
  assert.equal((await t.store.exportBoards()).boards[0].archivedTasks[0].id, "1");
});
 test("queued restore and permanent deletion remain distinct intents", async () => {
  const t = await setup(); const board = (await t.api.catalog()).boards[0];
  t.store.dispatch({ type: "deleteTask", taskId: "1" }); await t.store.sync();
  const entry = (await t.api.read("archive", { boardKey: board.boardKey })).items[0];
  t.offline(true);
  const id = t.store.recoverCard(board.id, "1", entry.deletionId);
  assert.equal(t.store.recoverCard(board.id, "1", entry.deletionId), id);
  assert.throws(() => t.store.recoverCard(board.id, "1", entry.deletionId, true), /different change/);
  await assert.rejects(t.store.waitForOperation(id), /Cannot reach/);
  t.offline(false); await t.store.sync();
  assert.equal((await t.api.completeCard(board.boardKey, "1")).id, "1");
});

test("queued delete-all keeps the confirmed revision and cannot delete a newly archived card", async () => {
  const t = await setup(); const { profile, boards } = await t.api.catalog(), board = boards[0];
  t.store.dispatch({ type: "deleteTask", taskId: "1" }); await t.store.sync();
  const first = await t.api.read("archive", { boardKey: board.boardKey });
  t.offline(true);
  const operationId = t.store.purgeArchive(board.id, first.revision);
  assert.equal(t.store.purgeArchive(board.id, first.revision), operationId);
  await assert.rejects(t.store.waitForOperation(operationId), /Cannot reach/);
  await applyKanbanOperation(t.owner, { contractVersion: 2, operationId: randomUUID(), epoch: profile.epoch, boardKey: board.boardKey, type: "card.archive", cardId: "2", expectedContentVersion: 1, expectedPlacementVersion: 1 }, database.pool);
  t.offline(false); await t.store.sync();
  assert.equal(t.view().status, "conflict");
  assert.equal((await t.api.read("archive", { boardKey: board.boardKey })).items.length, 2);
  await t.store.discardFirst();
  const current = await t.api.read("archive", { boardKey: board.boardKey });
  t.loseReply();
  const deletionId = t.store.purgeArchive(board.id, current.revision);
  await t.store.waitForOperation(deletionId);
  assert.equal(t.view().pending, 0);
  assert.equal((await t.api.read("archive", { boardKey: board.boardKey })).items.length, 0);
  const posts = t.requests.filter(({ init }) => init?.method === "POST").map(({ init }) => JSON.parse(init.body)).filter((operation) => operation.type === "archive.purge");
  assert.equal(posts[0].expectedRevision, first.revision);
  assert.deepEqual(posts.at(-1), posts.at(-2));
});
