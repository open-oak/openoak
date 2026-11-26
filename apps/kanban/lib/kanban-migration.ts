import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { cleanBoards, starterBoards, type Board } from "./kanban-data.ts";

type Document = { boards: unknown; activeBoardId: string; revision: number };
type VisibleDocument = { boards: Board[]; activeBoardId: string };
type Difference = { path: string; kind: "added" | "removed" | "changed" };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function migrationDigest(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

// Record all normalization differences without putting private content in logs.
export function differences(before: unknown, after: unknown, path = "$"): Difference[] {
  if (canonical(before) === canonical(after)) return [];
  if (before && after && typeof before === "object" && typeof after === "object"
    && Array.isArray(before) === Array.isArray(after)) {
    const left = before as Record<string, unknown>;
    const right = after as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap((key) =>
      differences(left[key], right[key], `${path}[${JSON.stringify(key)}]`));
  }
  return [{ path, kind: before === undefined ? "added" : after === undefined ? "removed" : "changed" }];
}

function uniqueIds(value: unknown, scope: string) {
  if (!Array.isArray(value)) return;
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.id !== "string") continue;
    if (seen.has(item.id)) throw new Error(`Ambiguous duplicate identity at ${scope}`);
    seen.add(item.id);
  }
}

export function prepareLegacyDocument(source: Document | null) {
  uniqueIds(source?.boards, "boards");
  if (Array.isArray(source?.boards)) {
    for (const [index, board] of source.boards.entries()) {
      if (!board || typeof board !== "object") continue;
      uniqueIds(board.lists, `boards[${index}].lists`);
      uniqueIds(board.tasks, `boards[${index}].tasks`);
      uniqueIds(board.cards, `boards[${index}].cards`);
    }
  }
  const cleaned = cleanBoards(source?.boards);
  const boards = cleaned.length ? cleaned : structuredClone(starterBoards);
  const activeBoardId = boards.some((board) => board.id === source?.activeBoardId)
    ? source!.activeBoardId : boards[0].id;
  const document = { boards, activeBoardId };
  const repairs = differences(source ? { boards: source.boards, activeBoardId: source.activeBoardId } : null, document);
  return { document, repairs, sourceDigest: migrationDigest(source) };
}

// Shared with the SQL trigger, scoped to the selected schema. Call before reading
// the source at READ COMMITTED. Never take a document row lock after this lock.
export async function lockMigrationOwner(client: PoolClient, ownerId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('openkanban:' || current_schema() || ':' || $1, 0))", [ownerId]);
}

async function sourceDocument(client: PoolClient, ownerId: string): Promise<Document | null> {
  const result = await client.query('SELECT "boards", "activeBoardId", "revision" FROM "KanbanDocument" WHERE "userId" = $1', [ownerId]);
  return result.rows[0] ?? null;
}

export async function readShadowDocument(client: PoolClient, ownerId: string) {
  const boards = await client.query('SELECT * FROM "KanbanBoard" WHERE "ownerId" = $1 ORDER BY "position", "boardKey"', [ownerId]);
  const lists = await client.query('SELECT l.* FROM "KanbanList" l JOIN "KanbanBoard" b USING ("boardKey") WHERE b."ownerId" = $1 ORDER BY l."position", l."id"', [ownerId]);
  const cards = await client.query('SELECT c.* FROM "KanbanCard" c JOIN "KanbanBoard" b USING ("boardKey") WHERE b."ownerId" = $1 ORDER BY c."position", c."id"', [ownerId]);
  const profile = await client.query('SELECT i."id" FROM "KanbanProfile" p JOIN "KanbanBoardIdentity" i ON i."boardKey" = p."activeBoardKey" AND i."ownerId" = p."userId" WHERE p."userId" = $1', [ownerId]);
  const problems: string[] = [];
  const projected = boards.rows.map((board, index) => {
    const boardLists = lists.rows.filter((list) => list.boardKey === board.boardKey);
    const boardCards = cards.rows.filter((card) => card.boardKey === board.boardKey);
    if (board.position !== index || board.cardCount !== boardCards.length) problems.push(`board[${index}]: position/count`);
    const tasks = boardLists.flatMap((list, listIndex) => {
      const listCards = boardCards.filter((card) => card.listId === list.id);
      if (list.position !== listIndex || list.cardCount !== listCards.length) problems.push(`board[${index}].list[${listIndex}]: position/count`);
      return listCards.map((card, cardIndex) => {
        if (card.position !== cardIndex) problems.push(`board[${index}].list[${listIndex}].card[${cardIndex}]: position`);
        return { id: card.id, title: card.title, description: card.description, dueDate: card.dueDate, color: card.color, listId: card.listId, order: card.position };
      });
    });
    return {
      id: board.id, name: board.name, theme: board.theme, wallpaper: board.wallpaper,
      wallpaperBlur: board.wallpaperBlur,
      lists: boardLists.map(({ id, name, color, icon }) => ({ id, name, color, icon })), tasks,
    };
  });
  const document: VisibleDocument = { boards: projected, activeBoardId: profile.rows[0]?.id };
  if (!document.boards.some((board) => board.id === document.activeBoardId)) problems.push("profile: missing active board");
  return { document, problems, counts: { boards: boards.rowCount!, lists: lists.rowCount!, cards: cards.rowCount! } };
}

// Used inside the owner's lock/transaction. A digest alone is not preservation
// proof: rebuild the old shape from rows and compare every field and position.
export async function verifyShadow(client: PoolClient, ownerId: string) {
  const source = await sourceDocument(client, ownerId);
  const prepared = prepareLegacyDocument(source);
  const transition = (await client.query('SELECT * FROM "KanbanTransition" WHERE "ownerId" = $1', [ownerId])).rows[0];
  if (!transition || transition.storageMode !== "legacy") throw new Error("Owner is not in legacy shadow mode");
  if (transition.sourceDigest !== prepared.sourceDigest) throw new Error("Legacy source changed; rerun backfill before verification");
  if (transition.sourceRevision !== (source?.revision ?? null)) throw new Error("Source revision checkpoint does not match");
  const shadow = await readShadowDocument(client, ownerId);
  const mismatches = differences(prepared.document, shadow.document);
  if (shadow.problems.length || mismatches.length) throw new Error(`Shadow verification failed: ${JSON.stringify({ problems: shadow.problems, mismatches })}`);
  if (migrationDigest(transition.sourceDocument) !== prepared.sourceDigest) throw new Error("Source recovery snapshot does not match its digest");
  return {
    status: prepared.repairs.length ? "review_required" : "verified",
    sourceRevision: source?.revision ?? null, sourceDigest: prepared.sourceDigest,
    visibleDigest: migrationDigest(shadow.document), counts: shadow.counts, repairs: prepared.repairs,
  };
}

export async function migrationTransaction<T>(pool: Pool, ownerId: string, work: (client: PoolClient) => Promise<T>, restoringLegacy = false) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await client.query("SET LOCAL lock_timeout = '10s'");
    // A legacy UPDATE can own its row while waiting for the advisory fence.
    // Recovery must exclude those writers before acquiring that fence, or its
    // document write would deadlock with an old binary. Used only for rollback.
    if (restoringLegacy) await client.query('LOCK TABLE "KanbanDocument" IN SHARE ROW EXCLUSIVE MODE');
    await client.query('SELECT "ownerId" FROM "KanbanTransition" WHERE "ownerId"=$1 FOR UPDATE', [ownerId]);
    await lockMigrationOwner(client, ownerId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function backfillOwner(pool: Pool, ownerId: string) {
  return migrationTransaction(pool, ownerId, async (client) => {
    const source = await sourceDocument(client, ownerId);
    const prepared = prepareLegacyDocument(source); // Ambiguity fails before any writes.
    await client.query('INSERT INTO "KanbanTransition" ("ownerId") VALUES ($1) ON CONFLICT DO NOTHING', [ownerId]);
    const state = (await client.query('SELECT * FROM "KanbanTransition" WHERE "ownerId" = $1', [ownerId])).rows[0];
    if (state.storageMode !== "legacy") throw new Error("Backfill is forbidden after authority changes");
    if (state.migrationEpoch > 1) throw new Error("Use cutover reconciliation after rollback; shadow backfill must not reset published item versions");
    if (state.sourceDigest === prepared.sourceDigest) return verifyShadow(client, ownerId);

    // Reconcile all legacy changes atomically. Mappings survive removed/re-added
    // boards. These are shadow rows only; runtime versions have not been exposed.
    await client.query('DELETE FROM "KanbanCard" c USING "KanbanBoard" b WHERE c."boardKey" = b."boardKey" AND b."ownerId" = $1', [ownerId]);
    await client.query('DELETE FROM "KanbanList" l USING "KanbanBoard" b WHERE l."boardKey" = b."boardKey" AND b."ownerId" = $1', [ownerId]);
    await client.query('DELETE FROM "KanbanBoard" WHERE "ownerId" = $1', [ownerId]);
    let activeBoardKey = "";
    for (const [position, board] of prepared.document.boards.entries()) {
      await client.query('INSERT INTO "KanbanBoardIdentity" ("boardKey", "ownerId", "id") VALUES ($1, $2, $3) ON CONFLICT ("ownerId", "id") DO NOTHING', [randomUUID(), ownerId, board.id]);
      const boardKey = (await client.query('SELECT "boardKey" FROM "KanbanBoardIdentity" WHERE "ownerId" = $1 AND "id" = $2', [ownerId, board.id])).rows[0].boardKey;
      if (board.id === prepared.document.activeBoardId) activeBoardKey = boardKey;
      await client.query('INSERT INTO "KanbanBoard" ("boardKey", "ownerId", "id", "name", "theme", "wallpaper", "wallpaperBlur", "position", "cardCount", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)',
        [boardKey, ownerId, board.id, board.name, board.theme, board.wallpaper, board.wallpaperBlur, position, board.tasks.length]);
      for (const [listPosition, list] of board.lists.entries()) {
        await client.query('INSERT INTO "KanbanEntityIdentity" ("boardKey","kind","id") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [boardKey, "list", list.id]);
        await client.query('INSERT INTO "KanbanList" ("boardKey", "id", "name", "color", "icon", "position", "cardCount", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)',
          [boardKey, list.id, list.name, list.color, list.icon, listPosition, board.tasks.filter((task) => task.listId === list.id).length]);
      }
      for (const task of board.tasks) {
        await client.query('INSERT INTO "KanbanEntityIdentity" ("boardKey","kind","id") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [boardKey, "card", task.id]);
        await client.query('INSERT INTO "KanbanCard" ("boardKey", "id", "listId", "position", "title", "description", "dueDate", "color", "updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP)',
          [boardKey, task.id, task.listId, task.order, task.title, task.description, task.dueDate, task.color]);
      }
    }
    await client.query('INSERT INTO "KanbanProfile" ("userId", "activeBoardKey") VALUES ($1,$2) ON CONFLICT ("userId") DO UPDATE SET "activeBoardKey" = EXCLUDED."activeBoardKey"', [ownerId, activeBoardKey]);
    await client.query('UPDATE "KanbanTransition" SET "sourceRevision"=$2, "sourceDigest"=$3, "sourceDocument"=$4::jsonb, "evidence"=NULL, "verifiedAt"=NULL WHERE "ownerId"=$1',
      [ownerId, source?.revision ?? null, prepared.sourceDigest, JSON.stringify(source)]);
    const evidence = await verifyShadow(client, ownerId);
    await client.query('UPDATE "KanbanTransition" SET "evidence"=$2::jsonb, "verifiedAt"=CURRENT_TIMESTAMP WHERE "ownerId"=$1', [ownerId, JSON.stringify(evidence)]);
    return evidence;
  });
}

async function requireTransition(client: PoolClient, ownerId: string) {
  const row = (await client.query('SELECT * FROM "KanbanTransition" WHERE "ownerId"=$1 FOR UPDATE', [ownerId])).rows[0];
  if (!row) throw new Error("Owner has no migration state; run backfill first");
  return row;
}

function checkpointRows(rows: Array<{ boardKey: string; revision: number }>) {
  return rows.map((row) => ({ boardKey: row.boardKey, revision: row.revision }));
}

/** Publish modular rows as the owner's authority after a verified backfill. */
export async function cutoverOwner(pool: Pool, ownerId: string) {
  return migrationTransaction(pool, ownerId, async (client) => {
    const state = await requireTransition(client, ownerId);
    if (state.storageMode !== "legacy") throw new Error(`Cutover requires legacy mode; current mode is ${state.storageMode}`);
    const evidence = await verifyShadow(client, ownerId);
    if (evidence.status !== "verified") throw new Error("Cutover blocked: review and repair the legacy source, then rerun backfill and verification");
    const shadow = await readShadowDocument(client, ownerId);
    if (Buffer.byteLength(JSON.stringify(shadow.document)) > 2 * 1024 * 1024) throw new Error("Cutover compatibility snapshot exceeds 2 MiB");
    const source = (await client.query('SELECT "revision" FROM "KanbanDocument" WHERE "userId"=$1', [ownerId])).rows[0];
    const checkpoint = checkpointRows((await client.query('SELECT "boardKey","revision" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "boardKey"', [ownerId])).rows);
    const digest = migrationDigest(shadow.document);
    await client.query(
      'INSERT INTO "KanbanRollbackSnapshot" ("ownerId","document","compatibilityRevision","checkpoint","digest","updatedAt") VALUES ($1,$2::jsonb,$3,$4::jsonb,$5,NOW()) ON CONFLICT ("ownerId") DO UPDATE SET "document"=EXCLUDED."document","compatibilityRevision"=EXCLUDED."compatibilityRevision","checkpoint"=EXCLUDED."checkpoint","digest"=EXCLUDED."digest","updatedAt"=NOW()',
      [ownerId, JSON.stringify(shadow.document), Number(source?.revision ?? 1), JSON.stringify(checkpoint), digest]
    );
    const nextEpoch = state.migrationEpoch + 1;
    await client.query(
      'UPDATE "KanbanTransition" SET "storageMode"=\'modular\',"migrationEpoch"=$2,"compatibilityMirror"=true,"evidence"=$3::jsonb,"verifiedAt"=CURRENT_TIMESTAMP WHERE "ownerId"=$1',
      [ownerId, nextEpoch, JSON.stringify(evidence)]
    );
    return { status: "cutover", ownerId, epoch: nextEpoch, digest, counts: shadow.counts };
  });
}

/** Capture a current, explicitly requested recovery snapshot after retirement. */
export async function checkpointOwner(pool: Pool, ownerId: string) {
  return migrationTransaction(pool, ownerId, async (client) => {
    const state = await requireTransition(client, ownerId);
    if (state.storageMode !== "modular") throw new Error("Recovery checkpoint requires modular mode");
    const shadow = await readShadowDocument(client, ownerId);
    if (shadow.problems.length) throw new Error("Recovery checkpoint failed structural verification");
    if (Buffer.byteLength(JSON.stringify(shadow.document)) > 2 * 1024 * 1024) throw new Error("Recovery checkpoint exceeds the legacy 2 MiB limit; use a database backup");
    const checkpoint = checkpointRows((await client.query('SELECT "boardKey","revision" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "boardKey"', [ownerId])).rows);
    const digest = migrationDigest(shadow.document);
    const saved = await client.query('UPDATE "KanbanRollbackSnapshot" SET "document"=$2::jsonb,"checkpoint"=$3::jsonb,"digest"=$4,"compatibilityRevision"="compatibilityRevision"+1,"updatedAt"=NOW() WHERE "ownerId"=$1 RETURNING "ownerId"', [ownerId, JSON.stringify(shadow.document), JSON.stringify(checkpoint), digest]);
    if (saved.rowCount !== 1) throw new Error("No recovery snapshot exists; investigate the missing cutover record");
    return { status: "checkpoint", ownerId, epoch: state.migrationEpoch, digest, counts: shadow.counts };
  });
}

/** Restore the explicitly verified recovery snapshot and retain modular history. */
export async function rollbackOwner(pool: Pool, ownerId: string) {
  return migrationTransaction(pool, ownerId, async (client) => {
    const state = await requireTransition(client, ownerId);
    if (state.storageMode !== "modular") throw new Error(`Rollback requires modular mode; current mode is ${state.storageMode}`);
    const trash = await client.query('SELECT 1 FROM "KanbanCardTrash" t JOIN "KanbanBoard" b ON b."boardKey"=t."boardKey" WHERE b."ownerId"=$1 LIMIT 1', [ownerId]);
    if (trash.rowCount) throw new Error("Restore or permanently delete cards in Trash before rolling back to legacy storage");
    const snapshot = (await client.query('SELECT * FROM "KanbanRollbackSnapshot" WHERE "ownerId"=$1 FOR UPDATE', [ownerId])).rows[0];
    if (!snapshot) throw new Error("No rollback snapshot is available");
    const shadow = await readShadowDocument(client, ownerId);
    const checkpoint = (await client.query('SELECT "boardKey","revision" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "boardKey"', [ownerId])).rows;
    if (shadow.problems.length || migrationDigest(snapshot.document) !== snapshot.digest || migrationDigest(shadow.document) !== snapshot.digest || migrationDigest(snapshot.checkpoint) !== migrationDigest(checkpoint)) throw new Error("Rollback snapshot is stale; reconcile the modular rows before rollback");
    const source = snapshot.document as VisibleDocument;
    const previous = (await client.query('SELECT "revision" FROM "KanbanDocument" WHERE "userId"=$1', [ownerId])).rows[0];
    const revision = Math.max(snapshot.compatibilityRevision + 1, Number(previous?.revision ?? 0) + 1);
    await client.query('UPDATE "KanbanTransition" SET "storageMode"=\'legacy\',"migrationEpoch"="migrationEpoch"+1,"sourceRevision"=$2,"sourceDigest"=$3,"sourceDocument"=$4::jsonb,"evidence"=NULL,"verifiedAt"=NULL,"compatibilityMirror"=true WHERE "ownerId"=$1', [ownerId, revision, migrationDigest({ boards: source.boards, activeBoardId: source.activeBoardId, revision }), JSON.stringify({ boards: source.boards, activeBoardId: source.activeBoardId, revision } )]);
    await client.query('INSERT INTO "KanbanDocument" ("userId","boards","activeBoardId","revision") VALUES ($1,$2::jsonb,$3,$4) ON CONFLICT ("userId") DO UPDATE SET "boards"=EXCLUDED."boards","activeBoardId"=EXCLUDED."activeBoardId","revision"=EXCLUDED."revision"', [ownerId, JSON.stringify(source.boards), source.activeBoardId, revision]);
    const nextEpoch = state.migrationEpoch + 1;
    return { status: "rollback", ownerId, epoch: nextEpoch, revision, digest: snapshot.digest };
  }, true);
}

/** End the temporary legacy mirror after operators have captured recovery evidence. */
export async function retireCompatibilityMirror(pool: Pool, ownerId: string) {
  return migrationTransaction(pool, ownerId, async (client) => {
    const state = await requireTransition(client, ownerId);
    if (state.storageMode !== "modular") throw new Error(`Mirror retirement requires modular mode; current mode is ${state.storageMode}`);
    if (!state.compatibilityMirror) return { status: "already_retired", ownerId, epoch: state.migrationEpoch };
    const snapshot = (await client.query('SELECT * FROM "KanbanRollbackSnapshot" WHERE "ownerId"=$1 FOR UPDATE', [ownerId])).rows[0];
    if (!snapshot) throw new Error("No rollback snapshot is available");
    const shadow = await readShadowDocument(client, ownerId);
    const checkpoint = (await client.query('SELECT "boardKey","revision" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "boardKey"', [ownerId])).rows;
    if (shadow.problems.length || migrationDigest(snapshot.document) !== snapshot.digest || migrationDigest(shadow.document) !== snapshot.digest || migrationDigest(snapshot.checkpoint) !== migrationDigest(checkpoint)) throw new Error("Mirror retirement requires a current compatibility snapshot");
    const epoch = state.migrationEpoch + 1;
    await client.query('UPDATE "KanbanTransition" SET "compatibilityMirror"=false,"migrationEpoch"=$2 WHERE "ownerId"=$1', [ownerId, epoch]);
    return { status: "mirror_retired", ownerId, epoch, digest: snapshot.digest };
  });
}
