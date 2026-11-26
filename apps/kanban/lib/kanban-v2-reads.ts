import type { Pool, PoolClient } from "pg";
import { boundedV2Result, decodeReadCursor, encodeReadCursor, fitsV2Result, kanbanBoardUrl, KanbanError, readLimit, scopeDigest } from "./kanban-v2-common.ts";
import { kanbanPool, requireBoard, withKanbanRead, accessibleBoardSql } from "./kanban-v2-db.ts";

type PageInput = { limit?: number; cursor?: string };
type CardsInput = PageInput & { boardKey: string; listId?: string; query?: string; ids?: string[] };
type CardRecord = { boardKey: string; boardId: string; id: string; listId: string; order: number; title: string; description: string; dueDate: string; color: "green" | "yellow" | "red" | null; contentVersion: number; placementVersion: number; url: string; archivedAt?: string; deletionId?: string };
type DetailRequired = { kind: "detail_required"; boardKey: string; id: string; cursor: string };

function page<T>(rows: T[], limit: number, metadata: Record<string, unknown>, cursor: (row: T) => string) {
  const items: T[] = [];
  for (const row of rows.slice(0, limit)) {
    const candidate = { ...metadata, items: [...items, row], nextCursor: cursor(row) };
    if (!fitsV2Result(candidate)) break;
    items.push(row);
  }
  if (rows.length && !items.length) throw new KanbanError("too_large", "A metadata record cannot fit in one response.");
  return boundedV2Result({ ...metadata, items, ...(items.length < rows.length ? { nextCursor: cursor(items.at(-1)!) } : {}) });
}

function afterKey(cursor: ReturnType<typeof decodeReadCursor>, types: ("string" | "number")[]) {
  if (!cursor) return null;
  if (cursor.after.length !== types.length || cursor.after.some((value, index) => typeof value !== types[index])) throw new KanbanError("invalid", "Invalid ordered cursor key.");
  return cursor.after;
}

export async function listV2Boards(ownerId: string, input: PageInput = {}, database: Pool = kanbanPool()) {
  const limit = readLimit(input.limit);
  return withKanbanRead(database, ownerId, async (client, epoch) => {
    const profile = (await client.query('SELECT "boardOrderVersion" FROM "KanbanProfile" WHERE "userId"=$1', [ownerId])).rows[0];
    if (!profile) throw new KanbanError("upgrade_required", "Initialize the account before listing its boards.");
    const stamp = (await client.query(`SELECT md5(COALESCE(string_agg("boardKey" || ':' || "revision" || ':' || "position", ',' ORDER BY "boardKey"), '')) AS stamp FROM "KanbanBoard" b WHERE ${accessibleBoardSql()} AND EXISTS (SELECT 1 FROM "KanbanTransition" t WHERE t."ownerId"=b."ownerId" AND t."storageMode"='modular')`, [ownerId])).rows[0].stamp;
    const scope = scopeDigest([ownerId, epoch, "boards"]);
    const after = afterKey(decodeReadCursor(input.cursor, scope, stamp), ["number", "string"]);
    const result = await client.query(`SELECT b."boardKey",CASE WHEN b."ownerId"=$1 THEN b."id" ELSE b."boardKey" END AS "id",CASE WHEN b."ownerId"=$1 THEN 'owner' ELSE 'editor' END AS "accessLevel",EXISTS(SELECT 1 FROM "KanbanBoardMember" m WHERE m."boardKey"=b."boardKey") AS "shared",b."name",b."theme",b."wallpaper",b."wallpaperBlur",b."position",b."cardCount",b."revision",b."metadataVersion",b."listOrderVersion",b."updatedAt",(SELECT count(*)::int FROM "KanbanList" l WHERE l."boardKey"=b."boardKey") AS "listCount" FROM "KanbanBoard" b WHERE ${accessibleBoardSql()} AND EXISTS (SELECT 1 FROM "KanbanTransition" t WHERE t."ownerId"=b."ownerId" AND t."storageMode"='modular') AND ($2::int IS NULL OR (b."position",b."boardKey")>($2,$3)) ORDER BY b."position",b."boardKey" LIMIT $4`, [ownerId, after?.[0] ?? null, after?.[1] ?? null, limit + 1]);
    const rows = result.rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString(), url: kanbanBoardUrl(row.id) }));
    return page(rows, limit, { epoch, boardOrderVersion: profile.boardOrderVersion }, (row) => encodeReadCursor(scope, stamp, [row.position, row.boardKey]));
  });
}

export async function listV2Lists(ownerId: string, input: PageInput & { boardKey: string }, database: Pool = kanbanPool()) {
  const limit = readLimit(input.limit);
  return withKanbanRead(database, ownerId, async (client, epoch) => {
    const board = await requireBoard(client, ownerId, input.boardKey);
    const stamp = String(board.revision);
    const scope = scopeDigest([ownerId, epoch, input.boardKey, "lists"]);
    const after = afterKey(decodeReadCursor(input.cursor, scope, stamp), ["number", "string"]);
    const rows = (await client.query('SELECT "id","name","color","icon","position","metadataVersion","orderVersion","cardCount" FROM "KanbanList" WHERE "boardKey"=$1 AND ($2::int IS NULL OR ("position","id")>($2,$3)) ORDER BY "position","id" LIMIT $4', [input.boardKey, after?.[0] ?? null, after?.[1] ?? null, limit + 1])).rows;
    return page(rows, limit, { epoch, boardKey: input.boardKey, revision: board.revision }, (row) => encodeReadCursor(scope, stamp, [row.position, row.id]));
  });
}

export async function listV2Trash(ownerId: string, input: PageInput & { boardKey: string; id?: string; query?: string }, database: Pool = kanbanPool()) {
  const limit = readLimit(input.limit);
  return withKanbanRead(database, ownerId, async (client, epoch) => {
    const board = await requireBoard(client, ownerId, input.boardKey);
    const stamp = String(board.revision);
    const scope = scopeDigest([ownerId, epoch, input.boardKey, "trash", input.id ?? "", ...(input.query ? [input.query] : [])]);
    const after = afterKey(decodeReadCursor(input.cursor, scope, stamp), ["string", "string"]);
    const rows = (await client.query('SELECT "id","listId",left("title",500) AS "title","color","deletionId",("deletedAt" AT TIME ZONE \'UTC\') AS "deletedAt","contentVersion","placementVersion" FROM "KanbanCardTrash" WHERE "boardKey"=$1 AND ($2::text IS NULL OR "id"=$2) AND ($3::timestamp IS NULL OR ("deletedAt","id")<($3,$4)) AND ($6::text IS NULL OR strpos(lower("title" || E\'\\n\' || "description"),lower($6))>0) ORDER BY "deletedAt" DESC,"id" DESC LIMIT $5', [input.boardKey, input.id ?? null, after?.[0] ?? null, after?.[1] ?? null, limit + 1, input.query?.trim() || null])).rows.map((row) => ({ ...row, deletedAt: row.deletedAt.toISOString() }));
    return page(rows, limit, { epoch, boardKey: input.boardKey, revision: board.revision }, (row) => encodeReadCursor(scope, stamp, [row.deletedAt, row.id]));
  });
}

export async function listV2Archive(ownerId: string, input: PageInput & { boardKey: string; query?: string }, database: Pool = kanbanPool()) {
  if ((input.query?.length ?? 0) > 200) throw new KanbanError("invalid", "Search is too long.");
  const result = await listV2Trash(ownerId, input, database);
  return { ...result, items: result.items.map(({ deletedAt, ...card }) => ({ ...card, archivedAt: deletedAt })) };
}

const cardColumns = 'c."boardKey",c."id",c."listId",c."position" AS "order",c."title",c."dueDate",c."color",c."contentVersion",c."placementVersion"';
async function fullCard(client: PoolClient, ownerId: string, boardKey: string, id: string, archived = false): Promise<CardRecord> {
  const board = await requireBoard(client, ownerId, boardKey);
  // Authorization is board-scoped; this fetch reads only the requested card.
  const result = await client.query(`SELECT ${cardColumns},c."description",b."id" AS "boardId"${archived ? ",c.\"deletionId\",(c.\"deletedAt\" AT TIME ZONE 'UTC') AS \"archivedAt\"" : ""} FROM "${archived ? "KanbanCardTrash" : "KanbanCard"}" c JOIN "KanbanBoard" b USING ("boardKey") WHERE c."boardKey"=$1 AND c."id"=$2 `, [boardKey, id]);
  if (!result.rows[0]) throw new KanbanError("not_found", "Card not found.");
  const row = result.rows[0];
  return { ...row, ...(archived ? { archivedAt: row.archivedAt.toISOString() } : {}), boardId: board.id, url: kanbanBoardUrl(board.id, row.id) };
}

function detailCursor(ownerId: string, epoch: number, card: CardRecord, offset: number) {
  return encodeReadCursor(scopeDigest([ownerId, epoch, card.boardKey, card.id, "detail", ...(card.deletionId ? [card.deletionId] : [])]), `${card.contentVersion}:${card.placementVersion}`, [offset]);
}

function detailEntry(ownerId: string, epoch: number, card: CardRecord): ({ kind: "card"; card: CardRecord } | DetailRequired) {
  const full = { kind: "card" as const, card };
  // Reserve the actual maximum page cursor allowance, including JSON syntax.
  if (fitsV2Result({ epoch, items: [full], nextCursor: "x".repeat(8192) })) return full;
  return { kind: "detail_required", boardKey: card.boardKey, id: card.id, cursor: detailCursor(ownerId, epoch, card, 0) };
}

export async function getV2Card(ownerId: string, input: { boardKey: string; id: string; archived?: boolean }, database: Pool = kanbanPool()) {
  return withKanbanRead(database, ownerId, async (client, epoch) => {
    const card = await fullCard(client, ownerId, input.boardKey, input.id, input.archived);
    return boundedV2Result({ epoch, result: detailEntry(ownerId, epoch, card) });
  });
}

async function cardsPage(ownerId: string, input: CardsInput, details: boolean, database: Pool) {
  const limit = readLimit(input.limit);
  const query = input.query?.trim() || "";
  if (query.length > 200 || (input.ids && (input.ids.length > 50 || !input.ids.every((id) => typeof id === "string")))) throw new KanbanError("invalid", "Invalid search or card ID filter.");
  return withKanbanRead(database, ownerId, async (client, epoch) => {
    const board = await requireBoard(client, ownerId, input.boardKey);
    if (input.listId !== undefined && !(await client.query('SELECT 1 FROM "KanbanList" WHERE "boardKey"=$1 AND "id"=$2', [input.boardKey, input.listId])).rowCount) throw new KanbanError("not_found", "List not found.");
    const stamp = String(board.revision);
    const scope = scopeDigest([ownerId, epoch, input.boardKey, input.listId ?? null, query, input.ids ? [...input.ids].sort() : null, details ? "details" : "summaries"]);
    const after = afterKey(decodeReadCursor(input.cursor, scope, stamp), ["number", "string", "number", "string"]);
    const rows = (await client.query(`SELECT ${cardColumns},${details ? 'c."description"' : 'left(c."description",240) AS "descriptionExcerpt"'}, l."position" AS "listPosition" FROM "KanbanCard" c JOIN "KanbanList" l ON l."boardKey"=c."boardKey" AND l."id"=c."listId" WHERE c."boardKey"=$1 AND ($2::text IS NULL OR c."listId"=$2) AND ($3='' OR strpos(lower(c."title" || E'\\n' || c."description"),lower($3))>0) AND ($4::text[] IS NULL OR c."id"=ANY($4)) AND ($5::int IS NULL OR (l."position",l."id",c."position",c."id")>($5,$6,$7,$8)) ORDER BY l."position",l."id",c."position",c."id" LIMIT $9`, [input.boardKey, input.listId ?? null, query, input.ids ?? null, after?.[0] ?? null, after?.[1] ?? null, after?.[2] ?? null, after?.[3] ?? null, limit + 1])).rows;
    const entries = rows.map(({ listPosition, ...row }) => {
      const card = { ...row, boardId: board.id, url: kanbanBoardUrl(board.id, row.id) };
      return { key: [listPosition, row.listId, row.order, row.id] as (string | number)[], value: details ? detailEntry(ownerId, epoch, card as CardRecord) : { ...card, descriptionExcerpt: row.descriptionExcerpt.slice(0, 240) } };
    });
    const items: unknown[] = [];
    for (const entry of entries.slice(0, limit)) {
      if (!fitsV2Result({ epoch, boardKey: board.boardKey, revision: board.revision, items: [...items, entry.value], nextCursor: encodeReadCursor(scope, stamp, entry.key) })) break;
      items.push(entry.value);
    }
    if (rows.length && !items.length) throw new KanbanError("too_large", "Card metadata exceeds the response limit.");
    return boundedV2Result({ epoch, boardKey: board.boardKey, revision: board.revision, items, ...(items.length < rows.length ? { nextCursor: encodeReadCursor(scope, stamp, entries[items.length - 1].key) } : {}) });
  });
}

export function listV2Cards(ownerId: string, input: CardsInput, database: Pool = kanbanPool()) { return cardsPage(ownerId, input, false, database); }
export function readV2CardDetails(ownerId: string, input: CardsInput, database: Pool = kanbanPool()) { return cardsPage(ownerId, input, true, database); }

export async function readV2DetailChunk(ownerId: string, input: { boardKey: string; id: string; cursor: string; archived?: boolean }, database: Pool = kanbanPool()) {
  return withKanbanRead(database, ownerId, async (client, epoch) => {
    const card = await fullCard(client, ownerId, input.boardKey, input.id, input.archived);
    const scope = scopeDigest([ownerId, epoch, card.boardKey, card.id, "detail", ...(card.deletionId ? [card.deletionId] : [])]);
    const after = afterKey(decodeReadCursor(input.cursor, scope, `${card.contentVersion}:${card.placementVersion}`), ["number"]);
    const offset = after?.[0] as number;
    const json = JSON.stringify(card);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= json.length || (offset > 0 && /[\uD800-\uDBFF]/.test(json[offset - 1]))) throw new KanbanError("invalid", "Invalid detail offset.");
    function result(end: number) {
      return { epoch, boardKey: card.boardKey, id: card.id, jsonFragment: json.slice(offset, end), ...(end < json.length ? { nextCursor: detailCursor(ownerId, epoch, card, end) } : {}) };
    }
    let low = offset;
    let high = json.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fitsV2Result(result(middle))) low = middle;
      else high = middle - 1;
    }
    if (low < json.length && /[\uD800-\uDBFF]/.test(json[low - 1])) low--;
    if (low <= offset) throw new KanbanError("too_large", "Detail metadata prevents a bounded chunk from making progress.");
    return boundedV2Result(result(low));
  });
}

export async function getV2Changes(ownerId: string, input: PageInput & { boardKey: string; sinceRevision?: number }, database: Pool = kanbanPool()) {
  const limit = readLimit(input.limit);
  const since = input.sinceRevision ?? 0;
  if (!Number.isSafeInteger(since) || since < 0) throw new KanbanError("invalid", "Invalid change revision.");
  return withKanbanRead(database, ownerId, async (client, epoch) => {
    const board = await requireBoard(client, ownerId, input.boardKey);
    const scope = scopeDigest([ownerId, epoch, input.boardKey, "changes", since]);
    const stamp = String(board.revision);
    const after = afterKey(decodeReadCursor(input.cursor, scope, stamp), ["number", "number"]);
    const rows = (await client.query('SELECT "revision","sequence","kind","id","deleted" FROM "KanbanChange" WHERE "boardKey"=$1 AND "revision">$2 AND ($3::int IS NULL OR ("revision","sequence")>($3,$4)) ORDER BY "revision","sequence" LIMIT $5', [input.boardKey, since, after?.[0] ?? null, after?.[1] ?? null, limit + 1])).rows;
    return page(rows, limit, { epoch, boardKey: board.boardKey, revision: board.revision }, (row) => encodeReadCursor(scope, stamp, [row.revision, row.sequence]));
  });
}

export async function getV2Profile(ownerId: string, database: Pool = kanbanPool()) {
  return withKanbanRead(database, ownerId, async (client, epoch) => {
    const profile = (await client.query(`SELECT COALESCE((SELECT b."boardKey" FROM "KanbanBoard" b JOIN "KanbanTransition" t ON t."ownerId"=b."ownerId" AND t."storageMode"='modular' WHERE b."boardKey"=p."selectedBoardKey" AND ${accessibleBoardSql()}),p."activeBoardKey") AS "activeBoardKey",p."boardOrderVersion",p."version" FROM "KanbanProfile" p WHERE p."userId"=$1`, [ownerId])).rows[0];
    if (!profile) throw new KanbanError("upgrade_required", "Initialize the account before reading its profile.");
    return boundedV2Result({ epoch, accountKey: scopeDigest([ownerId]), ...profile });
  });
}

export async function searchModularKanban(ownerId: string, query: string, limit = 20, database: Pool = kanbanPool()) {
  const state = (await database.query('SELECT "storageMode" FROM "KanbanTransition" WHERE "ownerId"=$1', [ownerId])).rows[0];
  if (!state || state.storageMode === "legacy") return null;
  const maximum = Math.min(50, Math.max(1, Math.trunc(limit)));
  return withKanbanRead(database, ownerId, async (client) => {
    const rows = (await client.query(`SELECT * FROM (
      SELECT 'board' AS type,b."id",b."name" AS title,NULL::text AS description,CASE WHEN b."ownerId"=$1 THEN b."id" ELSE b."boardKey" END AS "boardId",0 AS priority FROM "KanbanBoard" b WHERE ${accessibleBoardSql()} AND EXISTS (SELECT 1 FROM "KanbanTransition" t WHERE t."ownerId"=b."ownerId" AND t."storageMode"='modular') AND strpos(lower(b."name"),lower($2))>0
      UNION ALL SELECT 'list',l."id",l."name",NULL::text,CASE WHEN b."ownerId"=$1 THEN b."id" ELSE b."boardKey" END,1 FROM "KanbanList" l JOIN "KanbanBoard" b USING ("boardKey") WHERE ${accessibleBoardSql()} AND EXISTS (SELECT 1 FROM "KanbanTransition" t WHERE t."ownerId"=b."ownerId" AND t."storageMode"='modular') AND strpos(lower(l."name"),lower($2))>0
      UNION ALL SELECT 'card',c."id",c."title",left(c."description",240),CASE WHEN b."ownerId"=$1 THEN b."id" ELSE b."boardKey" END,2 FROM "KanbanCard" c JOIN "KanbanBoard" b USING ("boardKey") WHERE ${accessibleBoardSql()} AND EXISTS (SELECT 1 FROM "KanbanTransition" t WHERE t."ownerId"=b."ownerId" AND t."storageMode"='modular') AND strpos(lower(c."title" || E'\\n' || c."description"),lower($2))>0
    ) found ORDER BY priority,"boardId","id" LIMIT $3`, [ownerId, query.trim(), maximum])).rows;
    return rows.map((row) => ({ type: row.type as "board" | "list" | "card", id: row.id as string, title: row.title as string, ...(row.description !== null ? { description: (row.description as string).slice(0, 240) } : {}), boardId: row.boardId as string, url: kanbanBoardUrl(row.boardId, row.type === "card" ? row.id : undefined) }));
  });
}
