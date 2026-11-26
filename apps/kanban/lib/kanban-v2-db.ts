import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { postgresConnectionConfig } from "./postgres-connection.ts";
import { KanbanError } from "./kanban-v2-common.ts";

let pool: Pool | undefined;
export function kanbanPool() {
  if (pool) return pool;
  // Schema-scoped raw SQL needs a direct connection: transaction poolers such
  // as Neon reject search_path in the PostgreSQL startup options.
  const connectionString = process.env.KANBAN_DIRECT_URL || process.env.SUITE_DATABASE_URL_UNPOOLED || process.env.DIRECT_URL || process.env.KANBAN_DATABASE_URL || process.env.DATABASE_URL || process.env.ACCOUNT_DATABASE_URL;
  if (!connectionString) throw new Error("Kanban database is not configured");
  const url = new URL(connectionString);
  const schema = process.env.KANBAN_DATABASE_SCHEMA || process.env.DATABASE_SCHEMA || url.searchParams.get("schema") || "public";
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Invalid Kanban database schema");
  url.searchParams.delete("schema");
  pool = new pg.Pool({ ...postgresConnectionConfig(url.toString()), options: `-c search_path=${schema}` });
  return pool;
}

export async function withKanbanRead<T>(database: Pool, ownerId: string, read: (client: PoolClient, epoch: number) => Promise<T>) {
  const client = await database.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const state = (await client.query('SELECT "storageMode", "migrationEpoch" FROM "KanbanTransition" WHERE "ownerId"=$1', [ownerId])).rows[0];
    if (state?.storageMode !== "modular") throw new KanbanError("upgrade_required", "Modular reads are not active for this account.");
    const result = await read(client, state.migrationEpoch);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export type BoardCapability = "read" | "editContent" | "manageAccess" | "deleteBoard";
// Internal SQL fragment: aliases and parameter names are supplied by our queries.
export function accessibleBoardSql(actor = "$1") {
  return `(b."ownerId"=${actor} OR EXISTS (SELECT 1 FROM "KanbanBoardMember" m WHERE m."boardKey"=b."boardKey" AND m."userId"=${actor}))`;
}

export async function requireBoard(client: PoolClient, actorId: string, boardKey: string, capability: BoardCapability = "read", lock = false) {
  // Lock before checking membership. Removal/join use this same board lock, so
  // authorization cannot become stale between a write's check and its commit.
  const row = (await client.query(`SELECT "boardKey","ownerId","id","revision","metadataVersion","listOrderVersion" FROM "KanbanBoard" WHERE "boardKey"=$1${lock ? " FOR UPDATE" : ""}`, [boardKey])).rows[0];
  if (!row) throw new KanbanError("not_found", "Board unavailable.");
  const owner = row.ownerId === actorId;
  const member = !owner && (await client.query('SELECT 1 FROM "KanbanBoardMember" WHERE "boardKey"=$1 AND "userId"=$2', [boardKey, actorId])).rowCount === 1;
  if ((!owner && !member) || (!owner && ["manageAccess", "deleteBoard"].includes(capability))) throw new KanbanError("not_found", "Board unavailable.");
  if (!["read", "editContent", "manageAccess", "deleteBoard"].includes(capability)) throw new KanbanError("not_found", "Board unavailable.");
  const state = (await client.query('SELECT "storageMode" FROM "KanbanTransition" WHERE "ownerId"=$1', [row.ownerId])).rows[0];
  // Public owner requests already hold the actor mode gate. Internal recovery
  // deliberately uses the same executor while that owner is in legacy mode.
  if (!owner && state?.storageMode !== "modular") throw new KanbanError("not_found", "Board unavailable.");
  // Older boards can have the same local ID in different accounts. Joined
  // boards use their globally unique key in navigation and public links.
  return { ...row, id: owner ? row.id : row.boardKey, accessLevel: owner ? "owner" : "editor" } as {
    boardKey: string; ownerId: string; id: string; revision: number; metadataVersion: number; listOrderVersion: number; accessLevel: "owner" | "editor";
  };
}
