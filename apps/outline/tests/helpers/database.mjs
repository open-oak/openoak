import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { postgresConnectionConfig } from "../../lib/postgres-connection.ts";

export async function createOutlineTestDatabase() {
  if (!process.env.OUTLINE_TEST_DATABASE_URL) throw new Error("Set OUTLINE_TEST_DATABASE_URL to a disposable PostgreSQL database");
  const url = new URL(process.env.OUTLINE_TEST_DATABASE_URL);
  url.searchParams.delete("schema");
  const schema = `outline_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool(postgresConnectionConfig(url.toString()));
  const pool = new pg.Pool({ ...postgresConnectionConfig(url.toString()), options: `-c search_path=${schema}` });
  let created = false;
  const close = async () => {
    await pool.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  };
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    url.searchParams.set("schema", schema);
    await promisify(execFile)("npx", ["prisma", "migrate", "deploy", "--config", "prisma.config.ts"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: { ...process.env, OUTLINE_DATABASE_URL: url.toString(), OUTLINE_DIRECT_URL: url.toString() }, timeout: 60000,
    });
    return { pool, schema, url: url.toString(), close };
  } catch (error) { await close(); throw error; }
}
