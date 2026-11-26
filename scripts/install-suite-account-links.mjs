import "dotenv/config";
import pg from "pg";
import { deletionSchemas, installSuiteAccountLinks } from "../apps/account/lib/account-deletion.ts";
import { postgresConnectionConfig } from "../apps/account/lib/postgres-connection.ts";

const schemas = deletionSchemas(process.env.ACCOUNT_DELETION_SCHEMAS);
const url = process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL;
if (!schemas || !url) throw new Error("Set ACCOUNT_DELETION_SCHEMAS and ACCOUNT_DATABASE_URL for the shared suite.");
const pool = new pg.Pool(postgresConnectionConfig(url));
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='60s'");
  await installSuiteAccountLinks({ query: async (sql, ...values) => (await client.query(sql, values)).rows, execute: async (sql, ...values) => (await client.query(sql, values)).rowCount }, schemas);
  await client.query("COMMIT");
  console.log("Shared-suite account links installed and validated. No account data was deleted.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally { client.release(); await pool.end(); }
