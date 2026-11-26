import pg from "pg";
import { backfillOwner, migrationTransaction, verifyShadow } from "../lib/kanban-migration.ts";
import { postgresConnectionConfig } from "../lib/postgres-connection.ts";

const [command, selector, ownerId, ...extra] = process.argv.slice(2);
if (!["backfill", "verify"].includes(command) || !["--owner", "--all"].includes(selector)
  || (selector === "--owner" ? !ownerId : ownerId) || extra.length) {
  throw new Error("Usage: node scripts/kanban-shadow.mjs backfill|verify --owner <id>|--all");
}
// Deliberately no fallback to the application's production connection variables.
if (!process.env.KANBAN_MIGRATION_DATABASE_URL) throw new Error("Set KANBAN_MIGRATION_DATABASE_URL explicitly; this tool never switches authority.");
const url = new URL(process.env.KANBAN_MIGRATION_DATABASE_URL);
const schema = url.searchParams.get("schema") || "public";
if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("Migration schema must be a lowercase PostgreSQL identifier");
url.searchParams.delete("schema");
const pool = new pg.Pool({ ...postgresConnectionConfig(url.toString()), options: `-c search_path=${schema}`, max: 1 });
try {
  const owners = selector === "--owner" ? [ownerId] : (await pool.query('SELECT "userId" FROM "KanbanDocument" ORDER BY "userId"')).rows.map((row) => row.userId);
  for (const owner of owners) {
    try {
      const evidence = command === "backfill" ? await backfillOwner(pool, owner)
        : await migrationTransaction(pool, owner, (client) => verifyShadow(client, owner));
      console.log(JSON.stringify({ ownerId: owner, ...evidence }));
      if (evidence.status !== "verified" && process.exitCode !== 1) process.exitCode = 2;
    } catch (error) {
      console.error(JSON.stringify({ ownerId: owner, status: "blocked", error: error.message }));
      process.exitCode = 1;
    }
  }
} finally {
  await pool.end();
}
