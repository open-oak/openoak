import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { kanbanPool, requireBoard } from "./kanban-v2-db.ts";
import { KanbanError } from "./kanban-v2-common.ts";
import { insertBoard } from "./kanban-operations.ts";
import { migrationTransaction, readShadowDocument, migrationDigest } from "./kanban-migration.ts";

const tokenPattern = /^[A-Za-z0-9_-]{24}$/;
export type SharingAction = "enable" | "rotate" | "disable" | "remove" | "leave";

/** Initialize only a genuinely new account. Existing legacy data is never migrated implicitly. */
export async function initializeNewKanbanAccount(actorId: string, database: Pool = kanbanPool()) {
  return migrationTransaction(database, actorId, async (client) => {
    const state = (await client.query('SELECT "storageMode" FROM "KanbanTransition" WHERE "ownerId"=$1', [actorId])).rows[0];
    if (state?.storageMode === "modular") return true;
    if (state || (await client.query('SELECT 1 FROM "KanbanDocument" WHERE "userId"=$1', [actorId])).rowCount) return false;
    const id = randomUUID();
    await insertBoard(client, actorId, id, id, "Main board", 0);
    await client.query('INSERT INTO "KanbanProfile" ("userId","activeBoardKey") VALUES ($1,$2)', [actorId, id]);
    await client.query('INSERT INTO "KanbanTransition" ("ownerId","storageMode","compatibilityMirror") VALUES ($1,\'modular\',false)', [actorId]);
    const { document } = await readShadowDocument(client, actorId);
    await client.query('INSERT INTO "KanbanRollbackSnapshot" ("ownerId","document","compatibilityRevision","checkpoint","digest","updatedAt") VALUES ($1,$2::jsonb,1,$3::jsonb,$4,NOW())', [actorId, JSON.stringify(document), JSON.stringify([{ boardKey: id, revision: 1 }]), migrationDigest(document)]);
    return true;
  });
}

async function sharingTransaction<T>(database: Pool, boardKey: string, run: (client: PoolClient) => Promise<T>) {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='10s'");
    // Same lock order as item operations and recovery: transition then board.
    const state = (await client.query('SELECT t."storageMode" FROM "KanbanTransition" t JOIN "KanbanBoardIdentity" i ON i."ownerId"=t."ownerId" WHERE i."boardKey"=$1 FOR SHARE OF t', [boardKey])).rows[0];
    if (state?.storageMode !== "modular") throw new KanbanError("not_found", "Board unavailable.");
    const result = await run(client);
    await client.query("COMMIT"); return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function getBoardSharing(actorId: string, boardKey: string, database: Pool = kanbanPool(), afterMember = "") {
  return sharingTransaction(database, boardKey, async (client) => {
    const board = await requireBoard(client, actorId, boardKey, "read", true);
    const owner = board.accessLevel === "owner";
    const invite = owner ? (await client.query('SELECT "inviteNonce" FROM "KanbanBoard" WHERE "boardKey"=$1', [boardKey])).rows[0].inviteNonce : null;
    // Members cannot enumerate fellow member identities or retrieve invite links.
    const members = owner ? (await client.query('SELECT "userId" FROM "KanbanBoardMember" WHERE "boardKey"=$1 AND "userId">$2 ORDER BY "userId" LIMIT 51', [boardKey, afterMember])).rows.map((row) => row.userId as string) : [];
    return { boardKey, accessLevel: board.accessLevel, ownerId: board.ownerId, invitePath: invite ? `/i/${invite}` : null, members: members.slice(0, 50), nextMember: members.length > 50 ? members[49] : null };
  });
}

export async function changeBoardSharing(actorId: string, boardKey: string, action: SharingAction, memberId?: string, database: Pool = kanbanPool()) {
  return sharingTransaction(database, boardKey, async (client) => {
    const board = await requireBoard(client, actorId, boardKey, action === "leave" ? "read" : "manageAccess", true);
    if (action === "leave" && board.accessLevel === "owner") throw new KanbanError("invalid", "The board owner cannot leave.");
    if (["enable", "rotate", "disable"].includes(action)) {
      const nonce = action === "disable" ? null : randomBytes(18).toString("base64url");
      await client.query(`UPDATE "KanbanBoard" SET "inviteNonce"=${action === "enable" ? 'COALESCE("inviteNonce",$2)' : '$2'} WHERE "boardKey"=$1`, [boardKey, nonce]);
    } else {
      const target = action === "leave" ? actorId : memberId;
      if (!target || target === board.ownerId) throw new KanbanError("invalid", "Choose a board member.");
      await client.query('DELETE FROM "KanbanBoardMember" WHERE "boardKey"=$1 AND "userId"=$2', [boardKey, target]);
    }
    return { ok: true };
  });
}

export async function previewBoardInvite(token: string, database: Pool = kanbanPool()) {
  if (!tokenPattern.test(token)) return null;
  const row = (await database.query('SELECT b."boardKey",b."name",b."ownerId" FROM "KanbanBoard" b JOIN "KanbanTransition" t ON t."ownerId"=b."ownerId" WHERE b."inviteNonce"=$1 AND t."storageMode"=\'modular\'', [token])).rows[0];
  return row as { boardKey: string; name: string; ownerId: string } | undefined ?? null;
}

export async function acceptBoardInvite(actorId: string, token: string, database: Pool = kanbanPool()) {
  const preview = await previewBoardInvite(token, database);
  if (!preview) throw new KanbanError("not_found", "This invite is unavailable.");
  if (!await initializeNewKanbanAccount(actorId, database)) throw new KanbanError("upgrade_required", "Your existing boards need a storage upgrade before joining. Your boards have not been changed.");
  return sharingTransaction(database, preview.boardKey, async (client) => {
    const row = (await client.query('SELECT "boardKey","ownerId","id","inviteNonce" FROM "KanbanBoard" WHERE "boardKey"=$1 FOR UPDATE', [preview.boardKey])).rows[0];
    if (!row || row.inviteNonce !== token) throw new KanbanError("not_found", "This invite is unavailable.");
    if (row.ownerId !== actorId) await client.query('INSERT INTO "KanbanBoardMember" ("boardKey","userId") VALUES ($1,$2) ON CONFLICT DO NOTHING', [row.boardKey, actorId]);
    return { boardKey: row.boardKey as string, boardId: (row.ownerId === actorId ? row.id : row.boardKey) as string };
  });
}
