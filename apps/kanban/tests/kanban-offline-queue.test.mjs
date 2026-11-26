import assert from "node:assert/strict";
import test from "node:test";
import { compactOfflineQueue, drainOfflineQueue, enqueueOfflineOperation, exportOfflineQueue, markOfflineOperation, offlineQueueKey, readOfflineQueue } from "../lib/kanban-offline-queue.ts";

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
function update(id, title, expectedContentVersion = 1, cardId = "card-1") {
  return { contractVersion: 2, operationId: id, epoch: 2, boardKey: "board-key", type: "card.update", cardId, expectedContentVersion, changes: { title } };
}

test("offline queue persists, deduplicates and exports item operations", () => {
  const db = storage();
  const first = enqueueOfflineOperation(db, "queue", update("one", "first"), "2026-01-01T00:00:00.000Z");
  assert.equal(first.length, 1);
  assert.equal(enqueueOfflineOperation(db, "queue", update("one", "first")).length, 1);
  assert.deepEqual(readOfflineQueue(db, "queue")[0].operation.changes, { title: "first" });
  assert.match(exportOfflineQueue(first), /openoak-kanban-offline-queue/);
  assert.equal(offlineQueueKey("user/1"), "open-kanban-offline-operations:user/1");
});

test("adjacent card edits compact while retaining the first read version", () => {
  const db = storage();
  enqueueOfflineOperation(db, "queue", update("one", "first", 3));
  enqueueOfflineOperation(db, "queue", update("two", "second", 4));
  const compacted = compactOfflineQueue(readOfflineQueue(db, "queue"));
  assert.equal(compacted.length, 1);
  assert.deepEqual(compacted[0].operation.changes, { title: "second" });
  assert.equal(compacted[0].operation.expectedContentVersion, 3);
});

test("applied operations leave the queue and conflicts remain blocked for recovery", () => {
  const db = storage();
  enqueueOfflineOperation(db, "queue", update("one", "first"));
  enqueueOfflineOperation(db, "queue", update("two", "second"));
  markOfflineOperation(db, "queue", "one", { status: "applied" });
  assert.equal(readOfflineQueue(db, "queue").length, 1);
  const blocked = markOfflineOperation(db, "queue", "two", { status: "conflict", message: "stale version" });
  assert.equal(blocked[0].state, "blocked");
  assert.equal(blocked[0].attempts, 1);
  assert.equal(blocked[0].lastError, "stale version");
});

test("drain replays in order and stops at the first conflict", async () => {
  const db = storage();
  enqueueOfflineOperation(db, "queue", update("one", "first"));
  enqueueOfflineOperation(db, "queue", update("two", "second", 1, "card-2"));
  const sent = [];
  const remaining = await drainOfflineQueue(db, "queue", async (operation) => {
    sent.push(operation.operationId);
    if (operation.operationId === "two") throw new Error("conflict: stale version");
    return { status: "applied" };
  });
  assert.deepEqual(sent, ["one", "two"]);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].state, "blocked");
});
