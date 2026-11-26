import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { cleanBoards, type Board } from "./kanban-data.ts";
import type { BoardState } from "./kanban-reducer.ts";
import type { KanbanOperation } from "./kanban-operations-schema.ts";
import { executeKanbanOperation, mirrorCompatibility } from "./kanban-operations.ts";
import { kanbanPool } from "./kanban-v2-db.ts";
import { KanbanError } from "./kanban-v2-common.ts";
import { lockMigrationOwner, prepareLegacyDocument, readShadowDocument, differences, migrationTransaction, migrationDigest, verifyShadow } from "./kanban-migration.ts";

type LegacyDocument = { boards: unknown; activeBoardId: string; revision: number; updatedAt: Date };
function legacySnapshot(row: { document: BoardState; compatibilityRevision: number; updatedAt: Date }): LegacyDocument {
  return { ...row.document, revision: row.compatibilityRevision, updatedAt: row.updatedAt };
}

export async function readLegacyKanbanDocument(ownerId: string, database: Pool = kanbanPool()): Promise<LegacyDocument | null> {
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const state = (await client.query('SELECT "storageMode","compatibilityMirror" FROM "KanbanTransition" WHERE "ownerId"=$1', [ownerId])).rows[0];
    let result: LegacyDocument | null;
    if (!state || state.storageMode === "legacy") {
      result = (await client.query('SELECT "boards","activeBoardId","revision","updatedAt" FROM "KanbanDocument" WHERE "userId"=$1', [ownerId])).rows[0] ?? null;
    } else {
      if (state.storageMode !== "modular" || !state.compatibilityMirror) throw new KanbanError("upgrade_required", "Use the OpenKanban v2 tools. Legacy document access has been retired.");
      const snapshot = (await client.query('SELECT "document","compatibilityRevision","updatedAt" FROM "KanbanRollbackSnapshot" WHERE "ownerId"=$1', [ownerId])).rows[0];
      if (!snapshot) throw new KanbanError("upgrade_required", "The compatibility snapshot is unavailable.");
      result = legacySnapshot(snapshot);
    }
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

type Mutation = { state: BoardState; result: Record<string, unknown>; write?: boolean };
/** Reconcile legacy edits after rollback without resetting published versions. */
export async function reconcileRolledBackOwner(database: Pool, ownerId: string) {
  return migrationTransaction(database, ownerId, async (client) => {
    const state = (await client.query('SELECT * FROM "KanbanTransition" WHERE "ownerId"=$1', [ownerId])).rows[0];
    if (!state || state.storageMode !== "legacy" || state.migrationEpoch <= 1) throw new Error("Reconciliation requires a rolled-back owner");
    const source = (await client.query('SELECT "boards","activeBoardId","revision" FROM "KanbanDocument" WHERE "userId"=$1', [ownerId])).rows[0];
    const prepared = prepareLegacyDocument(source ?? null);
    if (prepared.repairs.length) throw new Error("Repair the legacy source before reconciliation");
    await applyLegacyDiff(client, ownerId, state.migrationEpoch, prepared.document);
    await client.query('UPDATE "KanbanTransition" SET "sourceRevision"=$2,"sourceDigest"=$3,"sourceDocument"=$4::jsonb WHERE "ownerId"=$1', [ownerId, source.revision, migrationDigest(source), JSON.stringify(source)]);
    const evidence = await verifyShadow(client, ownerId);
    await client.query('UPDATE "KanbanTransition" SET "evidence"=$2::jsonb,"verifiedAt"=NOW() WHERE "ownerId"=$1', [ownerId, JSON.stringify(evidence)]);
    return evidence;
  });
}
// Returns null only while the existing legacy table is authoritative. A guarded
// compatibility write applies an item diff and advances one legacy revision.
export async function mutateLegacyKanbanDocument(ownerId: string, expectedRevision: number, mutate: (state: BoardState) => Mutation, database: Pool = kanbanPool()) {
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const state = (await client.query('SELECT "storageMode","compatibilityMirror","migrationEpoch" FROM "KanbanTransition" WHERE "ownerId"=$1 FOR SHARE', [ownerId])).rows[0];
    if (!state || state.storageMode === "legacy") { await client.query("COMMIT"); return null; }
    if (state.storageMode !== "modular" || !state.compatibilityMirror) throw new KanbanError("upgrade_required", "Legacy aggregate writes are retired. Preserve drafts and reload to use v2.");
    await lockMigrationOwner(client, ownerId);
    const snapshot = (await client.query('SELECT "document","compatibilityRevision","updatedAt" FROM "KanbanRollbackSnapshot" WHERE "ownerId"=$1', [ownerId])).rows[0];
    if (!snapshot) throw new KanbanError("upgrade_required", "The compatibility snapshot is unavailable.");
    if (snapshot.compatibilityRevision !== expectedRevision) throw new KanbanError("conflict", "The Kanban document changed after it was read.", { currentRevision: snapshot.compatibilityRevision, conflict: { ...snapshot.document, revision: snapshot.compatibilityRevision, updatedAt: snapshot.updatedAt.toISOString() } });
    const mutation = mutate(structuredClone(snapshot.document));
    if (mutation.write !== false) {
      if (Buffer.byteLength(JSON.stringify(mutation.state)) > 2 * 1024 * 1024) throw new KanbanError("too_large", "The compatibility document must fit in 2 MiB.");
      // Check ambiguous identities before cleaning can discard duplicate data.
      prepareLegacyDocument({ ...mutation.state, revision: expectedRevision });
      const desired = { boards: cleanBoards(mutation.state.boards), activeBoardId: mutation.state.activeBoardId };
      if (!desired.boards.length || !desired.boards.some((board) => board.id === desired.activeBoardId)) throw new KanbanError("invalid", "A compatible document needs a valid active board.");
      await applyLegacyDiff(client, ownerId, state.migrationEpoch, desired);
      const projected = await readShadowDocument(client, ownerId);
      if (projected.problems.length || differences(desired, projected.document).length) throw new Error("Legacy compatibility diff failed preservation verification");
      await mirrorCompatibility(client, ownerId);
    }
    const saved = (await client.query('SELECT "document","compatibilityRevision","updatedAt" FROM "KanbanRollbackSnapshot" WHERE "ownerId"=$1', [ownerId])).rows[0];
    await client.query("COMMIT");
    return { result: mutation.result, document: legacySnapshot(saved) };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function applyLegacyDiff(client: PoolClient, ownerId: string, epoch: number, desired: BoardState) {
  // Legacy CAS already guarded the complete proposed snapshot. Resolve current
  // versions inside the locked transaction, then use the same item primitives.
  await client.query('SELECT "userId" FROM "KanbanProfile" WHERE "userId"=$1 FOR UPDATE', [ownerId]);
  const run = async (boardKey: string, fields: Record<string, unknown>) => {
    const operation = { contractVersion: 2, operationId: `legacy-${randomUUID()}`, epoch, boardKey, ...fields } as KanbanOperation;
    // Historical oversized field values stay compatible here; new v2 writes go
    // through the strict schema/64 KiB gate. All IDs, ordering and CAS invariants
    // are enforced by this same executor.
    return executeKanbanOperation(client, ownerId, operation);
  };
  for (const board of desired.boards) {
    let stored = (await client.query('SELECT * FROM "KanbanBoard" WHERE "ownerId"=$1 AND "id"=$2', [ownerId, board.id])).rows[0];
    const { name, theme, wallpaper, wallpaperBlur } = board;
    if (!stored) {
      const profile = (await client.query('SELECT "boardOrderVersion" FROM "KanbanProfile" WHERE "userId"=$1', [ownerId])).rows[0];
      const key = randomUUID();
      await run(key, { type: "board.create", id: board.id, name, theme, wallpaper, wallpaperBlur, expectedBoardOrderVersion: profile.boardOrderVersion });
      stored = (await client.query('SELECT * FROM "KanbanBoard" WHERE "boardKey"=$1', [key])).rows[0];
    } else await run(stored.boardKey, { type: "board.update", expectedMetadataVersion: stored.metadataVersion, changes: { name, theme, wallpaper, wallpaperBlur } });
    await reconcileBoard(client, stored.boardKey, board, (fields) => run(stored.boardKey, fields));
  }
  const retained = desired.boards.map((board) => board.id);
  const removed = (await client.query('SELECT "boardKey","revision" FROM "KanbanBoard" WHERE "ownerId"=$1 AND NOT ("id"=ANY($2::text[])) ORDER BY "boardKey"', [ownerId, retained])).rows;
  for (const board of removed) await run(board.boardKey, { type: "board.delete", expectedRevision: board.revision });
  let reordered = false;
  for (const [position, board] of desired.boards.entries()) {
    const updated = await client.query('UPDATE "KanbanBoard" SET "position"=$3 WHERE "ownerId"=$1 AND "id"=$2 AND "position"<>$3', [ownerId, board.id, position]);
    reordered ||= Boolean(updated.rowCount);
  }
  if (reordered) await client.query('UPDATE "KanbanProfile" SET "boardOrderVersion"="boardOrderVersion"+1 WHERE "userId"=$1', [ownerId]);
  const active = (await client.query('SELECT "boardKey" FROM "KanbanBoard" WHERE "ownerId"=$1 AND "id"=$2', [ownerId, desired.activeBoardId])).rows[0];
  const profile = (await client.query('SELECT "version" FROM "KanbanProfile" WHERE "userId"=$1', [ownerId])).rows[0];
  await run(active.boardKey, { type: "profile.selectBoard", expectedProfileVersion: profile.version });
}

async function reconcileBoard(client: PoolClient, key: string, desired: Board, run: (fields: Record<string, unknown>) => Promise<unknown>) {
  for (const list of desired.lists) {
    const existing = (await client.query('SELECT "metadataVersion" FROM "KanbanList" WHERE "boardKey"=$1 AND "id"=$2', [key, list.id])).rows[0];
    const { name, color, icon } = list;
    if (existing) await run({ type: "list.update", listId: list.id, expectedMetadataVersion: existing.metadataVersion, changes: { name, color, icon } });
    else {
      const board = (await client.query('SELECT "listOrderVersion" FROM "KanbanBoard" WHERE "boardKey"=$1', [key])).rows[0];
      await run({ type: "list.create", listId: list.id, name, color, icon, expectedListOrderVersion: board.listOrderVersion });
    }
  }
  const removedCards = (await client.query('SELECT "id","contentVersion","placementVersion" FROM "KanbanCard" WHERE "boardKey"=$1 AND NOT ("id"=ANY($2::text[])) ORDER BY "position" DESC', [key, desired.tasks.map((task) => task.id)])).rows;
  for (const card of removedCards) await run({ type: "card.delete", cardId: card.id, expectedContentVersion: card.contentVersion, expectedPlacementVersion: card.placementVersion });
  for (const task of desired.tasks) {
    let current = (await client.query('SELECT "contentVersion","placementVersion","listId","position" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [key, task.id])).rows[0];
    const { title, description, dueDate, color } = task;
    if (!current) {
      const list = (await client.query('SELECT "orderVersion" FROM "KanbanList" WHERE "boardKey"=$1 AND "id"=$2', [key, task.listId])).rows[0];
      await run({ type: "card.create", cardId: task.id, listId: task.listId, title, description, dueDate, color, expectedOrderVersion: list.orderVersion });
      current = (await client.query('SELECT "contentVersion","placementVersion","listId","position" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [key, task.id])).rows[0];
    } else await run({ type: "card.update", cardId: task.id, expectedContentVersion: current.contentVersion, changes: { title, description, dueDate, color } });
    if (current.listId !== task.listId || current.position !== task.order) {
      const lists = (await client.query('SELECT "id","orderVersion" FROM "KanbanList" WHERE "boardKey"=$1 AND "id"=ANY($2::text[])', [key, [current.listId, task.listId]])).rows;
      await run({ type: "card.move", cardId: task.id, expectedPlacementVersion: current.placementVersion, sourceListId: current.listId, destinationListId: task.listId, index: task.order, expectedOrderVersions: Object.fromEntries(lists.map((list) => [list.id, list.orderVersion])) });
    }
  }
  const removedLists = (await client.query('SELECT "id" FROM "KanbanList" WHERE "boardKey"=$1 AND NOT ("id"=ANY($2::text[]))', [key, desired.lists.map((list) => list.id)])).rows;
  for (const list of removedLists) {
    const board = (await client.query('SELECT "revision" FROM "KanbanBoard" WHERE "boardKey"=$1', [key])).rows[0];
    await run({ type: "list.delete", listId: list.id, expectedRevision: board.revision });
  }
  for (const [index, list] of desired.lists.entries()) {
    const board = (await client.query('SELECT "listOrderVersion" FROM "KanbanBoard" WHERE "boardKey"=$1', [key])).rows[0];
    await run({ type: "list.move", listId: list.id, index, expectedListOrderVersion: board.listOrderVersion });
  }
}
