import assert from "node:assert/strict";
import test from "node:test";
import { kanbanPool } from "../lib/kanban-v2-db.ts";

test("schema-scoped pool uses the direct endpoint before a transaction pooler", async () => {
  const saved = { ...process.env };
  delete process.env.KANBAN_DIRECT_URL;
  process.env.SUITE_DATABASE_URL_UNPOOLED = "postgresql://user:test@localhost:5433/direct?schema=kanban";
  process.env.KANBAN_DATABASE_URL = "postgresql://user:test@localhost:5434/pooled";
  delete process.env.KANBAN_DATABASE_SCHEMA;
  delete process.env.DATABASE_SCHEMA;
  const pool = kanbanPool();
  try {
    assert.equal(new URL(pool.options.connectionString).port, "5433");
    assert.equal(pool.options.options, "-c search_path=kanban");
  } finally {
    await pool.end();
    process.env = saved;
  }
});
