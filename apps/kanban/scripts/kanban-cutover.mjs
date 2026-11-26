import pg from "pg";
import { cutoverOwner, rollbackOwner, retireCompatibilityMirror, checkpointOwner } from "../lib/kanban-migration.ts";
import { reconcileRolledBackOwner } from "../lib/kanban-legacy-bridge.ts";
import { postgresConnectionConfig } from "../lib/postgres-connection.ts";

const [command, selector, ownerId, ...extra] = process.argv.slice(2);
if (!["cutover", "rollback", "retire-mirror", "checkpoint", "reconcile"].includes(command) || selector !== "--owner" || !ownerId || extra.length) {
  throw new Error("Usage: node scripts/kanban-cutover.mjs cutover|rollback|retire-mirror|checkpoint|reconcile --owner <id>");
}
if (!process.env.KANBAN_MIGRATION_DATABASE_URL) throw new Error("Set KANBAN_MIGRATION_DATABASE_URL explicitly for the intended database.");
const url = new URL(process.env.KANBAN_MIGRATION_DATABASE_URL);
const schema = url.searchParams.get("schema") || "public";
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Migration schema must be a lowercase PostgreSQL identifier");
url.searchParams.delete("schema");
const pool = new pg.Pool({ ...postgresConnectionConfig(url.toString()), options: `-c search_path=${schema}`, max: 1 });
try {
  const action = { cutover: cutoverOwner, rollback: rollbackOwner, "retire-mirror": retireCompatibilityMirror, checkpoint: checkpointOwner, reconcile: reconcileRolledBackOwner }[command];
  console.log(JSON.stringify(await action(pool, ownerId)));
} catch (error) {
  console.error(JSON.stringify({ ownerId, status: "blocked", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
