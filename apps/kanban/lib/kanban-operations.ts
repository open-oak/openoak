import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { defaultBoardAppearance, defaultLists } from "./kanban-data.ts";
import { kanbanOperationSchema, type KanbanOperation, type KanbanOperationResult } from "./kanban-operations-schema.ts";
import { boundedV2Result, fitsV2Result, KanbanError, encodeReadCursor, scopeDigest } from "./kanban-v2-common.ts";
import { kanbanPool, requireBoard } from "./kanban-v2-db.ts";
import { lockMigrationOwner, migrationDigest, readShadowDocument } from "./kanban-migration.ts";

type Changed = KanbanOperationResult["changed"][number];
function expectVersion(actual: number, expected: number) {
  if (actual !== expected) throw new KanbanError("conflict", "This item changed after it was read.", { currentVersion: actual });
}
async function entity(client: PoolClient, table: "KanbanCard" | "KanbanList", boardKey: string, id: string) {
  // Call only after authorized board lock. Metadata lookups intentionally omit content.
  const columns = table === "KanbanCard" ? '"id","listId","position","contentVersion","placementVersion"' : '"id","position","metadataVersion","orderVersion","cardCount"';
  const row = (await client.query(`SELECT ${columns} FROM "${table}" WHERE "boardKey"=$1 AND "id"=$2`, [boardKey, id])).rows[0];
  if (!row) throw new KanbanError("not_found", "Item not found.");
  return row;
}
async function reserve(client: PoolClient, boardKey: string, kind: "card" | "list", id: string) {
  const result = await client.query('INSERT INTO "KanbanEntityIdentity" ("boardKey","kind","id") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING "id"', [boardKey, kind, id]);
  if (!result.rowCount) throw new KanbanError("conflict", "This item ID has already been used. Create a new ID.");
}
async function patch(client: PoolClient, table: "KanbanCard" | "KanbanList" | "KanbanBoard", boardKey: string, id: string, changes: Record<string, unknown>, versionColumn: "contentVersion" | "metadataVersion") {
  // Field names come only from the strict operation schema, never raw JSON.
  const entries = Object.entries(changes);
  const keys = entries.map(([key]) => `"${key}"`);
  const current = (await client.query(`SELECT ${keys.join(",")} FROM "${table}" WHERE "boardKey"=$1${table === "KanbanBoard" ? "" : ' AND "id"=$2'}`, table === "KanbanBoard" ? [boardKey] : [boardKey, id])).rows[0];
  if (entries.every(([key, value]) => current[key] === value)) return null;
  const values = [boardKey, ...entries.map(([, value]) => value), ...(table === "KanbanBoard" ? [] : [id])];
  const result = await client.query(`UPDATE "${table}" SET ${keys.map((key, index) => `${key}=$${index + 2}`).join(",")},"${versionColumn}"="${versionColumn}"+1,"updatedAt"=NOW() WHERE "boardKey"=$1${table === "KanbanBoard" ? "" : ` AND "id"=$${values.length}`} RETURNING "${versionColumn}"`, values);
  return result.rows[0][versionColumn] as number;
}

export async function insertBoard(client: PoolClient, ownerId: string, boardKey: string, id: string, name: string, position: number, appearance: Partial<typeof defaultBoardAppearance> = {}) {
  const identity = await client.query('INSERT INTO "KanbanBoardIdentity" ("boardKey","ownerId","id") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING "boardKey"', [boardKey, ownerId, id]);
  if (!identity.rowCount) throw new KanbanError("conflict", "This board identity has already been used.");
  const style = { ...defaultBoardAppearance, ...appearance };
  await client.query('INSERT INTO "KanbanBoard" ("boardKey","ownerId","id","name","theme","wallpaper","wallpaperBlur","position","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())', [boardKey, ownerId, id, name, style.theme, style.wallpaper, style.wallpaperBlur, position]);
  for (const [index, list] of defaultLists.entries()) {
    await reserve(client, boardKey, "list", list.id);
    await client.query('INSERT INTO "KanbanList" ("boardKey","id","name","color","icon","position","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW())', [boardKey, list.id, list.name, list.color, list.icon, index]);
  }
}

export async function mirrorCompatibility(client: PoolClient, ownerId: string) {
  const { document, problems } = await readShadowDocument(client, ownerId);
  if (problems.length) throw new Error("Invalid modular ordering/counts during compatibility snapshot");
  if (Buffer.byteLength(JSON.stringify(document)) > 2 * 1024 * 1024) throw new KanbanError("too_large", "The temporary rollback window retains the legacy 2 MiB limit.");
  const checkpoint = (await client.query('SELECT "boardKey","revision" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "boardKey"', [ownerId])).rows;
  const updated = await client.query('UPDATE "KanbanRollbackSnapshot" SET "document"=$2::jsonb,"compatibilityRevision"="compatibilityRevision"+1,"checkpoint"=$3::jsonb,"digest"=$4,"updatedAt"=NOW() WHERE "ownerId"=$1', [ownerId, JSON.stringify(document), JSON.stringify(checkpoint), migrationDigest(document)]);
  if (!updated.rowCount) throw new KanbanError("upgrade_required", "The compatibility snapshot must be initialized before writes are enabled.");
}

export async function applyKanbanOperation(actorId: string, raw: unknown, database: Pool = kanbanPool(), allowImport = false): Promise<KanbanOperationResult> {
  if (Buffer.byteLength(JSON.stringify(raw) ?? "") > (allowImport ? 2 * 1024 * 1024 : 65536)) throw new KanbanError("too_large", allowImport ? "A board import must fit in 2 MiB." : "An operation must fit in 64 KiB.");
  const parsed = kanbanOperationSchema.safeParse(raw);
  if (!parsed.success) throw new KanbanError("invalid", "Invalid operation fields or versions.");
  const operation = parsed.data;
  if (operation.type === "board.import" && !allowImport) throw new KanbanError("invalid", "Use the explicit board import endpoint.");
  const inputHash = migrationDigest(operation);
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SET LOCAL lock_timeout='10s'");
    // Serialize only identical receipt IDs, including retries with another target.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('kanban-receipt:' || current_schema() || ':' || $1 || ':' || $2,0))", [actorId, operation.operationId]);
    const identity = (await client.query('SELECT "ownerId" FROM "KanbanBoardIdentity" WHERE "boardKey"=$1', [operation.boardKey])).rows[0];
    const creating = ["board.create", "board.import"].includes(operation.type);
    if (!identity && !creating) throw new KanbanError("not_found", "Board unavailable.");
    if (creating && identity && identity.ownerId !== actorId) throw new KanbanError("not_found", "Board unavailable.");
    const boardOwnerId = identity?.ownerId ?? actorId;
    const states = (await client.query('SELECT "ownerId","storageMode","migrationEpoch","compatibilityMirror" FROM "KanbanTransition" WHERE "ownerId"=ANY($1::text[]) ORDER BY "ownerId" FOR SHARE', [[actorId, boardOwnerId]])).rows;
    const actorState = states.find((row) => row.ownerId === actorId);
    const ownerState = states.find((row) => row.ownerId === boardOwnerId);
    if (actorState?.storageMode !== "modular" || actorState.migrationEpoch !== operation.epoch) throw new KanbanError("upgrade_required", "Refresh the account state before submitting this operation.");
    if (ownerState?.storageMode !== "modular") throw new KanbanError("not_found", "Board unavailable.");
    const storageOwnerId = operation.type === "profile.selectBoard" ? actorId : boardOwnerId;
    const state = operation.type === "profile.selectBoard" ? actorState : ownerState;
    if (state.compatibilityMirror) await lockMigrationOwner(client, storageOwnerId);
    // Even exact retries must reauthorize a current member before returning a
    // receipt. Only an owner's already-completed board deletion may lack a row.
    if (!creating && !(operation.type === "board.delete" && boardOwnerId === actorId && !(await client.query('SELECT 1 FROM "KanbanBoard" WHERE "boardKey"=$1', [operation.boardKey])).rowCount)) {
      await requireBoard(client, actorId, operation.boardKey, ["board.delete", "card.purge", "archive.purge"].includes(operation.type) ? "deleteBoard" : "editContent", true);
    }
    const receipt = (await client.query('SELECT "inputHash","result" FROM "KanbanOperationReceipt" WHERE "actorId"=$1 AND "operationId"=$2', [actorId, operation.operationId])).rows[0];
    if (receipt) {
      if (receipt.inputHash !== inputHash) throw new KanbanError("operation_id_reused", "This operation ID is already bound to another payload.");
      await client.query("COMMIT");
      return { ...receipt.result, status: "duplicate" };
    }

    const result = await executeKanbanOperation(client, actorId, operation);
    if (result.status !== "no_op" && state.compatibilityMirror) await mirrorCompatibility(client, storageOwnerId);
    await client.query('INSERT INTO "KanbanOperationReceipt" ("actorId","operationId","ownerId","boardKey","inputHash","result") VALUES ($1,$2,$6,$3,$4,$5::jsonb)', [actorId, operation.operationId, operation.boardKey, inputHash, JSON.stringify(result), boardOwnerId]);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

// Internal shared executor: caller holds the mode/compatibility locks and transaction.
export async function executeKanbanOperation(client: PoolClient, actorId: string, operation: KanbanOperation): Promise<KanbanOperationResult> {
  const lifecycle = ["board.create", "board.import", "board.delete", "profile.selectBoard"].includes(operation.type);
  const profile = lifecycle ? (await client.query('SELECT * FROM "KanbanProfile" WHERE "userId"=$1 FOR UPDATE', [actorId])).rows[0] : null;
  if (lifecycle && !profile) throw new KanbanError("upgrade_required", "Initialize the account before writing.");
  const board = !["board.create", "board.import"].includes(operation.type) ? await requireBoard(client, actorId, operation.boardKey, ["board.delete", "card.purge", "archive.purge"].includes(operation.type) ? "deleteBoard" : "editContent", true) : null;
  const changed: Changed[] = [];
  const result: KanbanOperationResult = { operationId: operation.operationId, status: "applied", epoch: operation.epoch, boardKey: operation.boardKey, revision: board?.revision ?? 1, changed, refreshRequired: false };
  const acted = await applyEntityOperation(client, actorId, operation, board, profile, changed, result);
  if (!acted) result.status = "no_op";
  else if (!["profile.selectBoard", "board.create", "board.import"].includes(operation.type)) {
    result.revision = (board?.revision ?? 0) + 1;
    if (operation.type !== "board.delete") await client.query('UPDATE "KanbanBoard" SET "revision"=$2,"updatedAt"=NOW() WHERE "boardKey"=$1', [operation.boardKey, result.revision]);
  }
  if (acted && operation.type !== "profile.selectBoard") {
    // Markers contain identities, not bodies. Large order changes page separately.
    for (const [sequence, entry] of changed.entries()) await client.query('INSERT INTO "KanbanChange" ("boardKey","revision","sequence","kind","id","deleted") VALUES ($1,$2,$3,$4,$5,$6)', [operation.boardKey, result.revision, sequence, entry.kind, entry.id, entry.deleted ?? false]);
  }
  result.changed = changed.slice(0, 50);
  for (;;) {
    if (result.changed.length < changed.length) {
      result.refreshRequired = true;
      result.refreshCursor = encodeReadCursor(scopeDigest([actorId, operation.epoch, operation.boardKey, "changes", 0]), String(result.revision), [result.revision, result.changed.length - 1]);
    }
    if (fitsV2Result(result) || result.changed.length <= 1) break;
    result.changed.pop();
  }
  boundedV2Result(result);
  return result;
}

async function applyEntityOperation(client: PoolClient, ownerId: string, op: KanbanOperation, board: Awaited<ReturnType<typeof requireBoard>> | null, profile: { activeBoardKey: string; version: number; boardOrderVersion: number } | null, changed: Changed[], result: KanbanOperationResult): Promise<boolean> {
  const key = op.boardKey;
  switch (op.type) {
    case "board.import": {
      expectVersion(profile!.boardOrderVersion, op.expectedBoardOrderVersion);
      const count = (await client.query('SELECT count(*)::int AS count FROM "KanbanBoard" WHERE "ownerId"=$1', [ownerId])).rows[0].count;
      await insertBoard(client, ownerId, key, op.board.id, op.board.name, count, op.board);
      await client.query('DELETE FROM "KanbanList" WHERE "boardKey"=$1', [key]);
      // Draft records and their publication share one transaction. No partial
      // import is visible, and the receipt makes a lost-response retry harmless.
      for (const [position, list] of op.board.lists.entries()) {
        await client.query('INSERT INTO "KanbanEntityIdentity" ("boardKey","kind","id") VALUES ($1,\'list\',$2) ON CONFLICT DO NOTHING', [key, list.id]);
        await client.query('INSERT INTO "KanbanList" ("boardKey","id","name","color","icon","position","cardCount","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())', [key, list.id, list.name, list.color, list.icon, position, op.board.tasks.filter((task) => task.listId === list.id).length]);
      }
      for (const card of op.board.tasks) {
        await reserve(client, key, "card", card.id);
        await client.query('INSERT INTO "KanbanCard" ("boardKey","id","listId","position","title","description","dueDate","color","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())', [key, card.id, card.listId, card.order, card.title, card.description, card.dueDate, card.color]);
      }
      for (const card of op.board.archivedTasks ?? []) {
        await reserve(client, key, "card", card.id);
        await client.query('INSERT INTO "KanbanCardTrash" ("boardKey","id","listId","position","title","description","dueDate","color","contentVersion","placementVersion","createdAt","updatedAt","deletedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,1,NOW(),NOW(),$9)', [key, card.id, card.listId, card.order, card.title, card.description, card.dueDate, card.color, card.archivedAt]);
      }
      await client.query('UPDATE "KanbanBoard" SET "cardCount"=$2 WHERE "boardKey"=$1', [key, op.board.tasks.length]);
      await client.query('UPDATE "KanbanProfile" SET "boardOrderVersion"="boardOrderVersion"+1 WHERE "userId"=$1', [ownerId]);
      changed.push({ kind: "board", id: op.board.id });
      return true;
    }
    case "board.create": {
      expectVersion(profile!.boardOrderVersion, op.expectedBoardOrderVersion);
      const count = (await client.query('SELECT count(*)::int AS count FROM "KanbanBoard" WHERE "ownerId"=$1', [ownerId])).rows[0].count;
      const appearance = Object.fromEntries(Object.entries(op).filter(([key]) => ["theme", "wallpaper", "wallpaperBlur"].includes(key)));
      await insertBoard(client, ownerId, key, op.id, op.name, count, appearance);
      await client.query('UPDATE "KanbanProfile" SET "boardOrderVersion"="boardOrderVersion"+1 WHERE "userId"=$1', [ownerId]);
      changed.push({ kind: "board", id: op.id, metadataVersion: 1 });
      return true;
    }
    case "profile.selectBoard": {
      expectVersion(profile!.version, op.expectedProfileVersion);
      const selection = (await client.query('SELECT "selectedBoardKey" FROM "KanbanProfile" WHERE "userId"=$1', [ownerId])).rows[0];
      if ((selection.selectedBoardKey ?? profile!.activeBoardKey) === key) return false;
      await client.query('UPDATE "KanbanProfile" SET "selectedBoardKey"=$2,"activeBoardKey"=CASE WHEN $3 THEN $2 ELSE "activeBoardKey" END,"version"="version"+1 WHERE "userId"=$1', [ownerId, key, board!.ownerId === ownerId]);
      changed.push({ kind: "profile", id: ownerId });
      return true;
    }
    case "board.update": {
      expectVersion(board!.metadataVersion, op.expectedMetadataVersion);
      const version = await patch(client, "KanbanBoard", key, board!.id, op.changes, "metadataVersion");
      if (version === null) return false;
      changed.push({ kind: "board", id: board!.id, metadataVersion: version });
      return true;
    }
    case "board.delete": {
      expectVersion(board!.revision, op.expectedRevision);
      const current = (await client.query('SELECT "position" FROM "KanbanBoard" WHERE "boardKey"=$1', [key])).rows[0];
      await client.query('DELETE FROM "KanbanCard" WHERE "boardKey"=$1', [key]);
      await client.query('DELETE FROM "KanbanList" WHERE "boardKey"=$1', [key]);
      await client.query('DELETE FROM "KanbanBoard" WHERE "boardKey"=$1', [key]);
      await client.query('UPDATE "KanbanBoard" SET "position"="position"-1 WHERE "ownerId"=$1 AND "position">$2', [ownerId, current.position]);
      let replacement = (await client.query('SELECT "boardKey","id" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "position" LIMIT 1', [ownerId])).rows[0];
      if (!replacement) {
        replacement = op.replacement ?? { boardKey: randomUUID(), id: randomUUID() };
        await insertBoard(client, ownerId, replacement.boardKey, replacement.id, "Main board", 0);
        result.replacement = replacement;
      }
      await client.query('UPDATE "KanbanProfile" SET "boardOrderVersion"="boardOrderVersion"+1,"activeBoardKey"=CASE WHEN "activeBoardKey"=$2 THEN $3 ELSE "activeBoardKey" END,"version"="version"+1 WHERE "userId"=$1', [ownerId, key, replacement.boardKey]);
      changed.push({ kind: "board", id: board!.id, deleted: true });
      return true;
    }
    case "list.create": {
      expectVersion(board!.listOrderVersion, op.expectedListOrderVersion);
      await reserve(client, key, "list", op.listId);
      const count = (await client.query('SELECT count(*)::int AS count FROM "KanbanList" WHERE "boardKey"=$1', [key])).rows[0].count;
      await client.query('INSERT INTO "KanbanList" ("boardKey","id","name","color","icon","position","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,NOW())', [key, op.listId, op.name, op.color ?? "blue", op.icon ?? "circle", count]);
      await client.query('UPDATE "KanbanBoard" SET "listOrderVersion"="listOrderVersion"+1 WHERE "boardKey"=$1', [key]);
      changed.push({ kind: "list", id: op.listId, metadataVersion: 1, orderVersion: 1 });
      return true;
    }
    case "list.update": {
      const list = await entity(client, "KanbanList", key, op.listId);
      expectVersion(list.metadataVersion, op.expectedMetadataVersion);
      const version = await patch(client, "KanbanList", key, op.listId, op.changes, "metadataVersion");
      if (version === null) return false;
      changed.push({ kind: "list", id: op.listId, metadataVersion: version });
      return true;
    }
    case "list.move": {
      expectVersion(board!.listOrderVersion, op.expectedListOrderVersion);
      const list = await entity(client, "KanbanList", key, op.listId);
      const count = (await client.query('SELECT count(*)::int AS count FROM "KanbanList" WHERE "boardKey"=$1', [key])).rows[0].count;
      if (op.index >= count) throw new KanbanError("invalid", "List index is out of range.");
      if (op.index === list.position) return false;
      const moved = await client.query('UPDATE "KanbanList" SET "position"=CASE WHEN "id"=$2 THEN $3 WHEN $3::int<$4::int THEN "position"+1 ELSE "position"-1 END,"updatedAt"=NOW() WHERE "boardKey"=$1 AND "position" BETWEEN LEAST($3::int,$4::int) AND GREATEST($3::int,$4::int) RETURNING "id"', [key, op.listId, op.index, list.position]);
      await client.query('UPDATE "KanbanBoard" SET "listOrderVersion"="listOrderVersion"+1 WHERE "boardKey"=$1', [key]);
      changed.push(...moved.rows.map(({ id }) => ({ kind: "list" as const, id })));
      return true;
    }
    case "list.delete": {
      expectVersion(board!.revision, op.expectedRevision);
      const list = await entity(client, "KanbanList", key, op.listId);
      const target = (await client.query('SELECT "id","cardCount" FROM "KanbanList" WHERE "boardKey"=$1 AND "id"<>$2 ORDER BY "position" LIMIT 1', [key, op.listId])).rows[0];
      if (!target) throw new KanbanError("invalid", "A board must retain at least one list.");
      const moved = await client.query('UPDATE "KanbanCard" SET "listId"=$3,"position"="position"+$4,"placementVersion"="placementVersion"+1,"updatedAt"=NOW() WHERE "boardKey"=$1 AND "listId"=$2 RETURNING "id","placementVersion"', [key, op.listId, target.id, target.cardCount]);
      await client.query('UPDATE "KanbanList" SET "cardCount"="cardCount"+$3,"orderVersion"="orderVersion"+1,"updatedAt"=NOW() WHERE "boardKey"=$1 AND "id"=$2', [key, target.id, list.cardCount]);
      await client.query('DELETE FROM "KanbanList" WHERE "boardKey"=$1 AND "id"=$2', [key, op.listId]);
      const shifted = await client.query('UPDATE "KanbanList" SET "position"="position"-1 WHERE "boardKey"=$1 AND "position">$2 RETURNING "id"', [key, list.position]);
      await client.query('UPDATE "KanbanBoard" SET "listOrderVersion"="listOrderVersion"+1 WHERE "boardKey"=$1', [key]);
      changed.push({ kind: "list", id: op.listId, deleted: true }, { kind: "list", id: target.id }, ...shifted.rows.map(({ id }) => ({ kind: "list" as const, id })), ...moved.rows.map((card) => ({ kind: "card" as const, ...card })));
      return true;
    }
    case "card.create": {
      const list = await entity(client, "KanbanList", key, op.listId);
      expectVersion(list.orderVersion, op.expectedOrderVersion);
      await reserve(client, key, "card", op.cardId);
      await client.query('INSERT INTO "KanbanCard" ("boardKey","id","listId","position","title","description","dueDate","color","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())', [key, op.cardId, op.listId, list.cardCount, op.title, op.description ?? "", op.dueDate ?? "", op.color ?? null]);
      await client.query('UPDATE "KanbanList" SET "cardCount"="cardCount"+1,"orderVersion"="orderVersion"+1,"updatedAt"=NOW() WHERE "boardKey"=$1 AND "id"=$2', [key, op.listId]);
      await client.query('UPDATE "KanbanBoard" SET "cardCount"="cardCount"+1 WHERE "boardKey"=$1', [key]);
      changed.push({ kind: "card", id: op.cardId, contentVersion: 1, placementVersion: 1 }, { kind: "list", id: op.listId, orderVersion: list.orderVersion + 1 });
      return true;
    }
    case "card.update": {
      const card = await entity(client, "KanbanCard", key, op.cardId);
      expectVersion(card.contentVersion, op.expectedContentVersion);
      const version = await patch(client, "KanbanCard", key, op.cardId, op.changes, "contentVersion");
      if (version === null) return false;
      changed.push({ kind: "card", id: op.cardId, contentVersion: version });
      return true;
    }
    case "card.move": {
      const card = await entity(client, "KanbanCard", key, op.cardId);
      expectVersion(card.placementVersion, op.expectedPlacementVersion);
      if (card.listId !== op.sourceListId) throw new KanbanError("conflict", "The card moved to another list.");
      const source = await entity(client, "KanbanList", key, op.sourceListId);
      const target = await entity(client, "KanbanList", key, op.destinationListId);
      const expectedKeys = [...new Set([source.id, target.id])].sort();
      if (JSON.stringify(Object.keys(op.expectedOrderVersions).sort()) !== JSON.stringify(expectedKeys)) throw new KanbanError("invalid", "Supply exactly the source and destination order versions.");
      expectVersion(source.orderVersion, op.expectedOrderVersions[source.id]);
      expectVersion(target.orderVersion, op.expectedOrderVersions[target.id]);
      const sameList = source.id === target.id;
      if (op.index > target.cardCount - (sameList ? 1 : 0)) throw new KanbanError("invalid", "Card index is out of range.");
      if (sameList && op.index === card.position) return false;
      if (sameList) {
        const shifted = await client.query('UPDATE "KanbanCard" SET "position"=CASE WHEN $3::int<$4::int THEN "position"+1 ELSE "position"-1 END,"placementVersion"="placementVersion"+1,"updatedAt"=NOW() WHERE "boardKey"=$1 AND "listId"=$2 AND "id"<>$5 AND "position" BETWEEN LEAST($3::int,$4::int) AND GREATEST($3::int,$4::int) RETURNING "id","placementVersion"', [key, source.id, op.index, card.position, card.id]);
        changed.push(...shifted.rows.map((row) => ({ kind: "card" as const, ...row })));
      } else {
        for (const [listId, start, delta, inclusive] of [[source.id, card.position, -1, false], [target.id, op.index, 1, true]] as const) {
          const shifted = await client.query(`UPDATE "KanbanCard" SET "position"="position"+$4,"placementVersion"="placementVersion"+1,"updatedAt"=NOW() WHERE "boardKey"=$1 AND "listId"=$2 AND "position"${inclusive ? ">=" : ">"}$3 RETURNING "id","placementVersion"`, [key, listId, start, delta]);
          changed.push(...shifted.rows.map((row) => ({ kind: "card" as const, ...row })));
        }
        await client.query('UPDATE "KanbanList" SET "cardCount"="cardCount"+CASE WHEN "id"=$2 THEN -1 ELSE 1 END WHERE "boardKey"=$1 AND "id"=ANY($3::text[])', [key, source.id, [source.id, target.id]]);
      }
      await client.query('UPDATE "KanbanCard" SET "listId"=$3,"position"=$4,"placementVersion"="placementVersion"+1,"updatedAt"=NOW() WHERE "boardKey"=$1 AND "id"=$2', [key, card.id, target.id, op.index]);
      const lists = await client.query('UPDATE "KanbanList" SET "orderVersion"="orderVersion"+1,"updatedAt"=NOW() WHERE "boardKey"=$1 AND "id"=ANY($2::text[]) RETURNING "id","orderVersion"', [key, expectedKeys]);
      changed.push({ kind: "card", id: card.id, placementVersion: card.placementVersion + 1 }, ...lists.rows.map((row) => ({ kind: "list" as const, ...row })));
      return true;
    }
    case "archive.purge": {
      expectVersion(board!.revision, op.expectedRevision);
      const deleted = await client.query('DELETE FROM "KanbanCardTrash" WHERE "boardKey"=$1 RETURNING "id"', [key]);
      changed.push(...deleted.rows.map((row) => ({ kind: "card" as const, id: row.id, deleted: true })));
      return Boolean(deleted.rowCount);
    }
    case "card.restore":
    case "card.purge": {
      const card = (await client.query('SELECT * FROM "KanbanCardTrash" WHERE "boardKey"=$1 AND "id"=$2', [key, op.cardId])).rows[0];
      if (!card) throw new KanbanError("not_found", "This card is no longer in the archive. Refresh before continuing.");
      if (card.deletionId !== op.deletionId) throw new KanbanError("conflict", "This card was archived again. Review its current archive entry.");
      if (op.type === "card.purge") {
        await client.query('DELETE FROM "KanbanCardTrash" WHERE "boardKey"=$1 AND "id"=$2', [key, card.id]);
        changed.push({ kind: "card", id: card.id, deleted: true });
        return true;
      }
      const targetId = op.destinationListId ?? (await client.query('SELECT "id" FROM "KanbanList" WHERE "boardKey"=$1 ORDER BY ("id"=$2) DESC,"position" LIMIT 1', [key, card.listId])).rows[0]?.id;
      const target = await entity(client, "KanbanList", key, targetId);
      await client.query('DELETE FROM "KanbanCardTrash" WHERE "boardKey"=$1 AND "id"=$2', [key, card.id]);
      await client.query('INSERT INTO "KanbanCard" ("boardKey","id","listId","position","title","description","dueDate","color","contentVersion","placementVersion","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())', [key, card.id, target.id, target.cardCount, card.title, card.description, card.dueDate, card.color, card.contentVersion + 1, card.placementVersion + 1, card.createdAt]);
      await client.query('UPDATE "KanbanList" SET "cardCount"="cardCount"+1,"orderVersion"="orderVersion"+1,"updatedAt"=NOW() WHERE "boardKey"=$1 AND "id"=$2', [key, target.id]);
      await client.query('UPDATE "KanbanBoard" SET "cardCount"="cardCount"+1 WHERE "boardKey"=$1', [key]);
      changed.push({ kind: "card", id: card.id, contentVersion: card.contentVersion + 1, placementVersion: card.placementVersion + 1 }, { kind: "list", id: target.id, orderVersion: target.orderVersion + 1 });
      return true;
    }
    case "card.archive":
    case "card.delete": {
      const card = await entity(client, "KanbanCard", key, op.cardId);
      expectVersion(card.contentVersion, op.expectedContentVersion);
      expectVersion(card.placementVersion, op.expectedPlacementVersion);
      await client.query('DELETE FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [key, card.id]);
      const shifted = await client.query('UPDATE "KanbanCard" SET "position"="position"-1,"placementVersion"="placementVersion"+1,"updatedAt"=NOW() WHERE "boardKey"=$1 AND "listId"=$2 AND "position">$3 RETURNING "id","placementVersion"', [key, card.listId, card.position]);
      const list = await client.query('UPDATE "KanbanList" SET "cardCount"="cardCount"-1,"orderVersion"="orderVersion"+1,"updatedAt"=NOW() WHERE "boardKey"=$1 AND "id"=$2 RETURNING "orderVersion"', [key, card.listId]);
      await client.query('UPDATE "KanbanBoard" SET "cardCount"="cardCount"-1 WHERE "boardKey"=$1', [key]);
      changed.push({ kind: "card", id: card.id, deleted: true }, ...shifted.rows.map((row) => ({ kind: "card" as const, ...row })), { kind: "list", id: card.listId, orderVersion: list.rows[0].orderVersion });
      return true;
    }
  }
}
