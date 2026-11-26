import { listV2Trash, getV2Card } from "../../lib/kanban-v2-reads.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { before, after } from "node:test";
import { createKanbanTestDatabase } from "../helpers/database.mjs";
import { backfillOwner, readShadowDocument, migrationDigest } from "../../lib/kanban-migration.ts";
import { starterBoards } from "../../lib/kanban-data.ts";
import { applyKanbanOperation } from "../../lib/kanban-operations.ts";
import { kanbanOperationResultSchema } from "../../lib/kanban-operations-schema.ts";
import { getV2Changes, searchModularKanban } from "../../lib/kanban-v2-reads.ts";
import { kanbanOperationResponse } from "../../lib/kanban-v2-http.ts";
import { readLegacyKanbanDocument, mutateLegacyKanbanDocument } from "../../lib/kanban-legacy-bridge.ts";

let database;
let pool;
before(async () => { database = await createKanbanTestDatabase(); pool = database.pool; });
after(async () => { await database?.close(); });
async function account(owner, mirror = false, count = 3) {
  const board = structuredClone(starterBoards[0]);
  board.tasks = Array.from({ length: count }, (_, index) => ({ ...board.tasks[0], id: String(index + 1), listId: "todo", order: index }));
  await pool.query('INSERT INTO "KanbanDocument" ("userId","boards","activeBoardId") VALUES ($1,$2::jsonb,$3)', [owner, JSON.stringify([board]), board.id]);
  await backfillOwner(pool, owner);
  const key = (await pool.query('SELECT "boardKey" FROM "KanbanBoard" WHERE "ownerId"=$1', [owner])).rows[0].boardKey;
  await pool.query('UPDATE "KanbanTransition" SET "storageMode"=$2,"compatibilityMirror"=$3 WHERE "ownerId"=$1', [owner, "modular", mirror]);
  if (mirror) {
    const client = await pool.connect();
    try {
      const { document } = await readShadowDocument(client, owner);
      const checkpoint = (await client.query('SELECT "boardKey","revision" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "boardKey"', [owner])).rows;
      await client.query('INSERT INTO "KanbanRollbackSnapshot" ("ownerId","document","compatibilityRevision","checkpoint","digest","updatedAt") VALUES ($1,$2::jsonb,1,$3::jsonb,$4,NOW())', [owner, JSON.stringify(document), JSON.stringify(checkpoint), migrationDigest(document)]);
    } finally { client.release(); }
  }
  return key;
}
function op(boardKey, type, fields = {}) { return { contractVersion: 2, operationId: randomUUID(), epoch: 1, boardKey, type, ...fields }; }
async function apply(owner, operation, db = pool) {
  const result = await applyKanbanOperation(owner, operation, db);
  kanbanOperationResultSchema.parse(result);
  return result;
}
async function snapshot(owner) {
  const client = await pool.connect();
  try { const result = await readShadowDocument(client, owner); assert.deepEqual(result.problems, []); return result.document; }
  finally { client.release(); }
}

test("independent same-board edits both survive, stale same-card edits fail, receipts replay once", async () => {
  const key = await account("concurrent");
  const first = op(key, "card.update", { cardId: "1", expectedContentVersion: 1, changes: { title: "First" } });
  const second = op(key, "card.update", { cardId: "2", expectedContentVersion: 1, changes: { title: "Second" } });
  await Promise.all([apply("concurrent", first), apply("concurrent", second)]);
  const cards = (await snapshot("concurrent")).boards[0].tasks;
  assert.deepEqual(cards.slice(0, 2).map((card) => card.title), ["First", "Second"]);
  const replay = await apply("concurrent", first);
  assert.equal(replay.status, "duplicate");
  await assert.rejects(apply("concurrent", { ...first, changes: { title: "different" } }), { code: "operation_id_reused" });
  await assert.rejects(apply("concurrent", op(key, "card.update", { cardId: "1", expectedContentVersion: 1, changes: { title: "stale" } })), { code: "conflict" });
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM "KanbanOperationReceipt" WHERE "actorId"=$1', ["concurrent"])).rows[0].count, 2);
  const noOp = await apply("concurrent", op(key, "card.update", { cardId: "1", expectedContentVersion: 2, changes: { title: "First" } }));
  assert.equal(noOp.status, "no_op");
  assert.equal(noOp.revision, 3);
});

test("a final-path text patch touches only target content, board metadata, marker and receipt", async () => {
  const key = await account("footprint");
  const statements = [];
  const traced = { connect: async () => {
    const client = await pool.connect();
    return { query: async (...args) => { const result = await client.query(...args); statements.push({ sql: args[0], values: args[1], rowCount: result.rowCount }); return result; }, release: () => client.release() };
  } };
  const before = (await pool.query('SELECT * FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"<>$2 ORDER BY "id"', [key, "1"])).rows;
  await apply("footprint", op(key, "card.update", { cardId: "1", expectedContentVersion: 1, changes: { description: "One changed item" } }), traced);
  assert.deepEqual((await pool.query('SELECT * FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"<>$2 ORDER BY "id"', [key, "1"])).rows, before);
  assert.ok(statements.every(({ sql }) => !/KanbanDocument|KanbanRollbackSnapshot|KanbanProfile/.test(sql)));
  assert.ok(statements.filter(({ sql }) => sql.startsWith("UPDATE")).every(({ sql, rowCount }) => /KanbanCard|KanbanBoard/.test(sql) && rowCount === 1));
  assert.ok(statements.filter(({ sql }) => sql.startsWith("SELECT") && sql.includes("KanbanCard")).every(({ rowCount }) => rowCount === 1));
});

test("lost-response create retries, including simultaneous retries, create exactly one card", async () => {
  const key = await account("retry");
  const create = op(key, "card.create", { cardId: "offline-id", listId: "todo", expectedOrderVersion: 1, title: "", description: "draft" });
  const replies = await Promise.all([apply("retry", create), apply("retry", create)]);
  assert.deepEqual(replies.map((reply) => reply.status).sort(), ["applied", "duplicate"]);
  assert.equal((await snapshot("retry")).boards[0].tasks.filter((card) => card.id === "offline-id").length, 1);
  const deleted = op(key, "card.delete", { cardId: "offline-id", expectedContentVersion: 1, expectedPlacementVersion: 1 });
  await apply("retry", deleted);
  assert.equal((await apply("retry", deleted)).status, "duplicate");
  await assert.rejects(apply("retry", op(key, "card.create", { cardId: "offline-id", listId: "todo", expectedOrderVersion: 3, title: "reuse" })), { code: "conflict" });
});

test("moves preserve independent content versions, ordering and counts; stale order applies nothing", async () => {
  const key = await account("moves");
  await apply("moves", op(key, "card.move", { cardId: "1", expectedPlacementVersion: 1, sourceListId: "todo", destinationListId: "todo", expectedOrderVersions: { todo: 1 }, index: 2 }));
  assert.deepEqual((await snapshot("moves")).boards[0].tasks.map((card) => card.id), ["2", "3", "1"]);
  await apply("moves", op(key, "card.move", { cardId: "1", expectedPlacementVersion: 2, sourceListId: "todo", destinationListId: "doing", expectedOrderVersions: { todo: 2, doing: 1 }, index: 0 }));
  const document = await snapshot("moves");
  assert.equal(document.boards[0].tasks.find((card) => card.id === "1").listId, "doing");
  assert.ok((await pool.query('SELECT "contentVersion" FROM "KanbanCard" WHERE "boardKey"=$1', [key])).rows.every((card) => card.contentVersion === 1));
  await assert.rejects(apply("moves", op(key, "card.move", { cardId: "2", expectedPlacementVersion: 2, sourceListId: "todo", destinationListId: "doing", expectedOrderVersions: { todo: 1, doing: 2 }, index: 0 })), { code: "conflict" });
  assert.deepEqual(await snapshot("moves"), document);
  await apply("moves", op(key, "list.move", { listId: "done", expectedListOrderVersion: 1, index: 0 }));
  assert.deepEqual((await snapshot("moves")).boards[0].lists.map((list) => list.id), ["done", "todo", "doing"]);
  const revision = (await pool.query('SELECT "revision" FROM "KanbanBoard" WHERE "boardKey"=$1', [key])).rows[0].revision;
  await apply("moves", op(key, "list.delete", { listId: "doing", expectedRevision: revision }));
  assert.equal((await snapshot("moves")).boards[0].tasks.find((card) => card.id === "1").listId, "done");
});

test("container metadata, final-list guard, board lifecycle and deleted-board receipt remain usable", async () => {
  const key = await account("lifecycle");
  await apply("lifecycle", op(key, "board.update", { expectedMetadataVersion: 1, changes: { name: "Project", theme: "green", wallpaper: "5", wallpaperBlur: true } }));
  await apply("lifecycle", op(key, "list.create", { listId: "review", name: "Review", color: "purple", icon: "star", expectedListOrderVersion: 1 }));
  await apply("lifecycle", op(key, "list.update", { listId: "review", expectedMetadataVersion: 1, changes: { name: "Review carefully" } }));
  for (const listId of ["todo", "doing", "done"]) {
    const revision = (await pool.query('SELECT "revision" FROM "KanbanBoard" WHERE "boardKey"=$1', [key])).rows[0].revision;
    await apply("lifecycle", op(key, "list.delete", { listId, expectedRevision: revision }));
  }
  const revision = (await pool.query('SELECT "revision" FROM "KanbanBoard" WHERE "boardKey"=$1', [key])).rows[0].revision;
  await assert.rejects(apply("lifecycle", op(key, "list.delete", { listId: "review", expectedRevision: revision })), { code: "invalid" });
  const deletion = op(key, "board.delete", { expectedRevision: revision });
  const result = await apply("lifecycle", deletion);
  assert.ok(result.replacement.boardKey);
  const restored = await snapshot("lifecycle");
  assert.equal(restored.boards.length, 1);
  assert.equal(restored.boards[0].name, "Main board");
  assert.equal(restored.boards[0].tasks.length, 0);
  assert.deepEqual((await apply("lifecycle", deletion)).replacement, result.replacement);
  const newKey = randomUUID();
  await apply("lifecycle", op(newKey, "board.create", { id: "new-project", name: "New project", expectedBoardOrderVersion: 2 }));
  const profile = (await pool.query('SELECT * FROM "KanbanProfile" WHERE "userId"=$1', ["lifecycle"])).rows[0];
  await apply("lifecycle", op(newKey, "profile.selectBoard", { expectedProfileVersion: profile.version }));
  assert.equal((await snapshot("lifecycle")).activeBoardId, "new-project");
});

test("invalid values, missing access, stale epochs and a database failure leave no partial writes or receipts", async () => {
  const key = await account("atomic-ops");
  await account("outsider-ops");
  const before = await snapshot("atomic-ops");
  const invalid = op(key, "card.update", { cardId: "1", expectedContentVersion: 1, changes: { listId: "doing" } });
  await assert.rejects(apply("atomic-ops", invalid), { code: "invalid" });
  await assert.rejects(apply("atomic-ops", op(key, "card.update", { cardId: "1", expectedContentVersion: 1, changes: { description: "x".repeat(20001) } })), { code: "invalid" });
  await assert.rejects(apply("outsider-ops", op(key, "card.delete", { cardId: "1", expectedContentVersion: 1, expectedPlacementVersion: 1 })), { code: "not_found" });
  await assert.rejects(apply("atomic-ops", { ...op(key, "board.delete", { expectedRevision: 1 }), epoch: 2 }), { code: "upgrade_required" });
  await pool.query(`ALTER TABLE "KanbanOperationReceipt" ADD CONSTRAINT fail_receipt CHECK ("actorId" <> 'atomic-ops')`);
  const mutation = op(key, "card.update", { cardId: "1", expectedContentVersion: 1, changes: { title: "Must roll back" } });
  await assert.rejects(apply("atomic-ops", mutation), /fail_receipt/);
  assert.deepEqual(await snapshot("atomic-ops"), before);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM "KanbanChange" WHERE "boardKey"=$1', [key])).rows[0].n, 0);
  await pool.query('ALTER TABLE "KanbanOperationReceipt" DROP CONSTRAINT fail_receipt');
  assert.equal((await apply("atomic-ops", mutation)).status, "applied");
});

test("temporary compatibility mirroring is atomic, and final mode stops all aggregate work", async () => {
  const key = await account("mirror", true);
  const initialLegacy = (await pool.query('SELECT * FROM "KanbanDocument" WHERE "userId"=$1', ["mirror"])).rows[0];
  await apply("mirror", op(key, "card.update", { cardId: "1", expectedContentVersion: 1, changes: { title: "Latest recoverable work" } }));
  const snapshot = (await pool.query('SELECT * FROM "KanbanRollbackSnapshot" WHERE "ownerId"=$1', ["mirror"])).rows[0];
  assert.equal(snapshot.compatibilityRevision, 2);
  assert.equal(snapshot.document.boards[0].tasks[0].title, "Latest recoverable work");
  assert.equal(snapshot.digest, migrationDigest(snapshot.document));
  assert.deepEqual((await pool.query('SELECT * FROM "KanbanDocument" WHERE "userId"=$1', ["mirror"])).rows[0], initialLegacy);
  await pool.query('UPDATE "KanbanTransition" SET "compatibilityMirror"=false WHERE "ownerId"=$1', ["mirror"]);
  await apply("mirror", op(key, "card.update", { cardId: "2", expectedContentVersion: 1, changes: { title: "No mirror needed" } }));
  assert.deepEqual((await pool.query('SELECT * FROM "KanbanRollbackSnapshot" WHERE "ownerId"=$1', ["mirror"])).rows[0], snapshot);
});

test("large ordering changes produce a bounded receipt and continuation without dropping change markers", async () => {
  const key = await account("large-move", false, 88);
  const result = await apply("large-move", op(key, "card.move", { cardId: "1", expectedPlacementVersion: 1, sourceListId: "todo", destinationListId: "todo", expectedOrderVersions: { todo: 1 }, index: 87 }));
  assert.equal(result.changed.length, 50);
  assert.equal(result.refreshRequired, true);
  assert.ok(result.refreshCursor);
  const continued = await getV2Changes("large-move", { boardKey: key, cursor: result.refreshCursor, limit: 50 }, pool);
  assert.equal(continued.items.length, 39);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM "KanbanChange" WHERE "boardKey"=$1', [key])).rows[0].n, 89);
  assert.equal((await snapshot("large-move")).boards[0].tasks.at(-1).id, "1");
});

test("web operations use the same receipts and reject cross-origin or oversized request bodies", async () => {
  const key = await account("web-write");
  const operation = op(key, "card.update", { cardId: "1", expectedContentVersion: 1, changes: { title: "From web" } });
  const request = (body, origin = "https://kanban.openoak.org") => new Request("https://kanban.openoak.org/api/kanban/v2/operations", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
  const response = await kanbanOperationResponse("web-write", request(operation), pool);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "applied");
  assert.equal((await apply("web-write", operation)).status, "duplicate");
  assert.equal((await kanbanOperationResponse("web-write", request(operation, "https://other.example"), pool)).status, 403);
  assert.equal((await kanbanOperationResponse("web-write", request({ oversized: "x".repeat(65536) }), pool)).status, 413);
});

test("legacy bridge applies guarded snapshot diffs using modular versions and retires explicitly", async () => {
  const key = await account("bridge", true);
  const originalLegacy = (await pool.query('SELECT * FROM "KanbanDocument" WHERE "userId"=$1', ["bridge"])).rows[0];
  const current = await readLegacyKanbanDocument("bridge", pool);
  const desired = { boards: structuredClone(current.boards), activeBoardId: current.activeBoardId };
  desired.boards[0].name = "Bridge edit";
  desired.boards[0].tasks[0].title = "Guarded legacy patch";
  desired.boards[0].tasks[0].listId = "doing";
  desired.boards[0].tasks[0].order = 0;
  desired.boards[0].tasks[1].order = 0;
  desired.boards[0].tasks[2].order = 1;
  desired.boards[0].lists.reverse();
  const bridge = await mutateLegacyKanbanDocument("bridge", current.revision, () => ({ state: desired, result: { updated: true } }), pool);
  assert.equal(bridge.document.revision, 2);
  assert.equal((await snapshot("bridge")).boards[0].name, "Bridge edit");
  assert.equal((await pool.query('SELECT "contentVersion" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [key, "1"])).rows[0].contentVersion, 2);
  assert.equal((await pool.query('SELECT "contentVersion" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [key, "2"])).rows[0].contentVersion, 1);
  assert.deepEqual((await pool.query('SELECT * FROM "KanbanDocument" WHERE "userId"=$1', ["bridge"])).rows[0], originalLegacy);
  await assert.rejects(mutateLegacyKanbanDocument("bridge", current.revision, () => ({ state: desired, result: {} }), pool), { code: "conflict" });
  await apply("bridge", op(key, "card.update", { cardId: "2", expectedContentVersion: 1, changes: { title: "Remote modular edit" } }));
  await assert.rejects(mutateLegacyKanbanDocument("bridge", bridge.document.revision, () => ({ state: desired, result: {} }), pool), { code: "conflict" });
  await pool.query('UPDATE "KanbanTransition" SET "compatibilityMirror"=false WHERE "ownerId"=$1', ["bridge"]);
  await assert.rejects(mutateLegacyKanbanDocument("bridge", 3, () => ({ state: desired, result: {} }), pool), { code: "upgrade_required" });
  await assert.rejects(readLegacyKanbanDocument("bridge", pool), { code: "upgrade_required" });
  const search = await searchModularKanban("bridge", "Remote modular", 20, pool);
  assert.equal(search.length, 1);
  assert.equal(search[0].title, "Remote modular edit");
});


test("card Trash preserves content and identity, restore appends safely and rejects stale edits", async () => {
  const key = await account("trash-owner");
  await pool.query(`UPDATE "KanbanCard" SET "description"=$2,"dueDate"=$3,"color"=$4 WHERE "boardKey"=$1 AND "id"='1'`, [key, "Full notes 🪵", "2026-12-01", "red"]);
  const original = (await pool.query(`SELECT * FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"='1'`, [key])).rows[0];
  const deletion = op(key, "card.delete", { cardId: "1", expectedContentVersion: 1, expectedPlacementVersion: 1 });
  await apply("trash-owner", deletion);
  assert.equal((await apply("trash-owner", deletion)).status, "duplicate");
  await assert.rejects(getV2Card("trash-owner", { boardKey: key, id: "1" }, pool), { code: "not_found" });
  const trash = await listV2Trash("trash-owner", { boardKey: key }, pool);
  assert.equal(trash.items.length, 1);
  const restore = op(key, "card.restore", { cardId: "1", deletionId: trash.items[0].deletionId });
  await apply("trash-owner", restore);
  assert.equal((await apply("trash-owner", restore)).status, "duplicate");
  const restored = (await pool.query(`SELECT * FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"='1'`, [key])).rows[0];
  for (const field of ["id", "title", "description", "dueDate", "color", "createdAt"]) assert.deepEqual(restored[field], original[field]);
  assert.equal(restored.position, 2);
  assert.equal(restored.contentVersion, 2);
  assert.equal(restored.placementVersion, 2);
  await assert.rejects(apply("trash-owner", op(key, "card.update", { cardId: "1", expectedContentVersion: 1, changes: { title: "stale before deletion" } })), { code: "conflict" });
  assert.equal((await listV2Trash("trash-owner", { boardKey: key }, pool)).items.length, 0);
  await snapshot("trash-owner");
});

test("Trash authorization, repeated deletion tokens, missing-list restore and explicit permanent deletion", async () => {
  const key = await account("trash-lifecycle");
  await account("trash-editor"); await account("trash-stranger");
  await pool.query('INSERT INTO "KanbanBoardMember" ("boardKey","userId") VALUES ($1,$2)', [key, "trash-editor"]);
  await apply("trash-editor", op(key, "card.delete", { cardId: "1", expectedContentVersion: 1, expectedPlacementVersion: 1 }));
  const first = (await listV2Trash("trash-editor", { boardKey: key }, pool)).items[0];
  await assert.rejects(listV2Trash("trash-stranger", { boardKey: key }, pool), { code: "not_found" });
  await assert.rejects(apply("trash-editor", op(key, "card.purge", { cardId: "1", deletionId: first.deletionId, confirmPermanent: true })), { code: "not_found" });
  await apply("trash-editor", op(key, "card.restore", { cardId: "1", deletionId: first.deletionId }));
  await apply("trash-editor", op(key, "card.delete", { cardId: "1", expectedContentVersion: 2, expectedPlacementVersion: 2 }));
  const second = (await listV2Trash("trash-lifecycle", { boardKey: key }, pool)).items[0];
  assert.notEqual(first.deletionId, second.deletionId);
  await assert.rejects(apply("trash-lifecycle", op(key, "card.purge", { cardId: "1", deletionId: first.deletionId, confirmPermanent: true })), { code: "conflict" });
  await apply("trash-lifecycle", op(key, "list.delete", { listId: "todo", expectedRevision: second.revision ?? (await listV2Trash("trash-lifecycle", { boardKey: key }, pool)).revision }));
  await apply("trash-lifecycle", op(key, "card.restore", { cardId: "1", deletionId: second.deletionId }));
  assert.equal((await getV2Card("trash-lifecycle", { boardKey: key, id: "1" }, pool)).result.card.listId, "doing");
  await snapshot("trash-lifecycle");
  await apply("trash-lifecycle", op(key, "card.delete", { cardId: "1", expectedContentVersion: 3, expectedPlacementVersion: 3 }));
  const third = (await listV2Trash("trash-lifecycle", { boardKey: key }, pool)).items[0];
  await assert.rejects(apply("trash-lifecycle", op(key, "card.purge", { cardId: "1", deletionId: third.deletionId })), { code: "invalid" });
  const purge = op(key, "card.purge", { cardId: "1", deletionId: third.deletionId, confirmPermanent: true });
  await apply("trash-lifecycle", purge); assert.equal((await apply("trash-lifecycle", purge)).status, "duplicate");
  await assert.rejects(apply("trash-lifecycle", op(key, "card.restore", { cardId: "1", deletionId: third.deletionId })), { code: "not_found" });
});

test("the migration protects old modular DELETE writers and leaves legacy shadow rebuilds intact", async () => {
  const key = await account("old-delete-writer");
  await pool.query(`DELETE FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"='1'`, [key]);
  assert.equal((await listV2Trash("old-delete-writer", { boardKey: key }, pool)).items[0].id, "1");
});

test("Trash pages stay bounded, invalidate after changes, and follow board deletion", async () => {
  const owner = "trash-pages", key = await account(owner);
  await pool.query('UPDATE "KanbanCard" SET "title"=$2 WHERE "boardKey"=$1 AND "id"=$3', [key, "Long legacy title 🌳".repeat(10000), "1"]);
  for (const cardId of ["3", "2", "1"]) await apply(owner, op(key, "card.delete", { cardId, expectedContentVersion: 1, expectedPlacementVersion: 1 }));
  const first = await listV2Trash(owner, { boardKey: key, limit: 1 }, pool);
  assert.ok(first.nextCursor);
  const entries = [...first.items];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await listV2Trash(owner, { boardKey: key, limit: 1, cursor }, pool);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 65536);
    entries.push(...page.items); cursor = page.nextCursor;
  }
  assert.equal(entries.length, 3);
  assert.equal(new Set(entries.map(card => card.id)).size, 3);
  const restored = await apply(owner, op(key, "card.restore", { cardId: entries[0].id, deletionId: entries[0].deletionId }));
  await assert.rejects(listV2Trash(owner, { boardKey: key, cursor: first.nextCursor }, pool), { code: "restart_read" });
  await apply(owner, op(key, "board.delete", { expectedRevision: restored.revision }));
  assert.equal((await pool.query('SELECT count(*)::int n FROM "KanbanCardTrash" WHERE "boardKey"=$1', [key])).rows[0].n, 0);
});

test("Delete all archive is owner-only, revision guarded, atomic, bounded and replay safe", async () => {
  const owner = "bulk-archive-owner", key = await account(owner, false, 64);
  await account("bulk-archive-editor");
  const otherKey = await account("bulk-archive-other");
  await pool.query('INSERT INTO "KanbanBoardMember" ("boardKey","userId") VALUES ($1,$2)', [key, "bulk-archive-editor"]);
  for (let i = 64; i > 1; i--) await apply(owner, op(key, "card.archive", { cardId: String(i), expectedContentVersion: 1, expectedPlacementVersion: 1 }));
  await apply("bulk-archive-other", op(otherKey, "card.archive", { cardId: "3", expectedContentVersion: 1, expectedPlacementVersion: 1 }));
  const first = await listV2Trash(owner, { boardKey: key }, pool);
  const deletion = op(key, "archive.purge", { expectedRevision: first.revision, confirmPermanent: true });
  await assert.rejects(apply("bulk-archive-editor", deletion), { code: "not_found" });
  await assert.rejects(apply("bulk-archive-other", deletion), { code: "not_found" });
  await assert.rejects(apply(owner, op(key, "archive.purge", { expectedRevision: first.revision })), { code: "invalid" });
  await apply(owner, op(key, "card.update", { cardId: "1", expectedContentVersion: 1, changes: { title: "Keep active" } }));
  await assert.rejects(apply(owner, deletion), { code: "conflict" });
  assert.equal((await pool.query('SELECT count(*)::int n FROM "KanbanCardTrash" WHERE "boardKey"=$1', [key])).rows[0].n, 63);
  const current = await listV2Trash(owner, { boardKey: key }, pool);
  const confirmed = op(key, "archive.purge", { expectedRevision: current.revision, confirmPermanent: true });
  const result = await apply(owner, confirmed);
  assert.equal(result.status, "applied"); assert.ok(result.changed.length <= 50); assert.equal(result.refreshRequired, true);
  assert.equal((await apply(owner, confirmed)).status, "duplicate");
  assert.equal((await listV2Trash(owner, { boardKey: key }, pool)).items.length, 0);
  assert.equal((await getV2Card(owner, { boardKey: key, id: "1" }, pool)).result.card.title, "Keep active");
  assert.equal((await listV2Trash("bulk-archive-other", { boardKey: otherKey }, pool)).items.length, 1);
  await snapshot(owner);
});
