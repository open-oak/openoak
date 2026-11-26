import "dotenv/config";
import pg from "pg";
import { deletionSchemas, deleteSuiteAccountData } from "../apps/account/lib/account-deletion.ts";
import { postgresConnectionConfig } from "../apps/account/lib/postgres-connection.ts";

const args = process.argv.slice(2);
const userId = args[args.indexOf("--user-id") + 1];
const confirm = args.includes("--confirm-delete") ? args[args.indexOf("--confirm-delete") + 1] : null;
if (!args.includes("--user-id") || !userId || userId.startsWith("--") || (confirm !== null && confirm !== userId)) throw new Error("Use --user-id ID for a rollback-only review. Add --confirm-delete ID only after verifying the request.");
const schemas = deletionSchemas(process.env.ACCOUNT_DELETION_SCHEMAS);
const url = process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL;
if (!schemas || !url) throw new Error("Set ACCOUNT_DELETION_SCHEMAS and ACCOUNT_DATABASE_URL.");
const pool = new pg.Pool(postgresConnectionConfig(url));
const client = await pool.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='60s'");
  const result = await deleteSuiteAccountData({ query: async (sql, ...values) => (await client.query(sql, values)).rows, execute: async (sql, ...values) => (await client.query(sql, values)).rowCount }, schemas, userId);
  await client.query(confirm === userId ? "COMMIT" : "ROLLBACK");
  console.log(JSON.stringify({ mode: confirm === userId ? "committed" : "review-rolled-back", found: result.deleted, at: new Date().toISOString() }));
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
