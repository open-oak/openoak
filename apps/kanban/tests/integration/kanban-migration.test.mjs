import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test, { before, after } from "node:test";
import pg from "pg";
import { backfillOwner, cutoverOwner, migrationTransaction, lockMigrationOwner, rollbackOwner, retireCompatibilityMirror, checkpointOwner, verifyShadow, readShadowDocument, migrationDigest } from "../../lib/kanban-migration.ts";
import { reconcileRolledBackOwner } from "../../lib/kanban-legacy-bridge.ts";
import { applyKanbanOperation } from "../../lib/kanban-operations.ts";
import { cleanBoards, starterBoards } from "../../lib/kanban-data.ts";
import { createKanbanBackup, parseKanbanBackup } from "../../lib/kanban-backup.ts";
import { postgresConnectionConfig } from "../../lib/postgres-connection.ts";
import { listV2Boards, listV2Lists, listV2Cards, getV2Card, readV2CardDetails, readV2DetailChunk } from "../../lib/kanban-v2-reads.ts";
import { v2Envelope } from "../../lib/kanban-v2-common.ts";
import { kanbanReadResponse } from "../../lib/kanban-v2-http.ts";
import { kanbanV2ReadSchemas } from "../../lib/kanban-v2-schemas.ts";

// A separate explicit command: never silently skip database proof in CI.
if (!process.env.KANBAN_TEST_DATABASE_URL) throw new Error("Set KANBAN_TEST_DATABASE_URL to a disposable PostgreSQL database");
const database = new URL(process.env.KANBAN_TEST_DATABASE_URL);
database.searchParams.delete("schema");
const schema = `kan02_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool(postgresConnectionConfig(database.toString()));
const pool = new pg.Pool({ ...postgresConnectionConfig(database.toString()), options: `-c search_path=${schema}`, max: 8 });
const cwd = fileURLToPath(new URL("../../", import.meta.url));
let created = false;

before(async () => {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  created = true;
  const url = new URL(database);
  url.searchParams.set("schema", schema);
  for (let attempt = 0; attempt < 2; attempt++) {
    await promisify(execFile)("npx", ["prisma", "migrate", "deploy", "--config", "prisma.config.ts"], {
      cwd, env: { ...process.env, KANBAN_DATABASE_URL: url.toString(), KANBAN_DIRECT_URL: url.toString() }, timeout: 60000,
    });
  }
  // Catch a CLI that exits 0 without actually executing the migration.
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).rows[0].count, 6);
  await promisify(execFile)("npx", ["prisma", "migrate", "diff", "--config", "prisma.config.ts", "--from-config-datasource", "--to-schema", "prisma/kanban.prisma", "--exit-code"], {
    cwd, env: { ...process.env, KANBAN_DATABASE_URL: url.toString(), KANBAN_DIRECT_URL: url.toString() }, timeout: 60000,
  }).catch((error) => { throw new Error(error.stdout || error.message); });
});
after(async () => {
  await pool.end();
  if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
});

function fixture() {
  const boards = structuredClone(starterBoards);
  boards[0].tasks[0].title = "";
  boards[0].tasks[0].description = "Long note 🌳\n".repeat(4000);
  boards[0].theme = "purple";
  boards[0].wallpaper = "4";
  boards[0].wallpaperBlur = true;
  boards.push({ ...structuredClone(boards[0]), id: "project", name: "Project" });
  return { boards, activeBoardId: "project", revision: 7 };
}
async function seed(ownerId, source = fixture(), client = pool) {
  await client.query('INSERT INTO "KanbanDocument" ("userId", "boards", "activeBoardId", "revision") VALUES ($1,$2::jsonb,$3,$4)', [ownerId, JSON.stringify(source.boards), source.activeBoardId, source.revision]);
  return source;
}
async function verify(ownerId) {
  return migrationTransaction(pool, ownerId, (client) => verifyShadow(client, ownerId));
}
async function waitForLock(pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await admin.query("SELECT wait_event FROM pg_stat_activity WHERE pid=$1", [pid]);
    if (result.rows[0]?.wait_event === "advisory") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected blocked advisory lock");
}

test("migration replay, twice-run backfill, full content/order/selection, export and owner isolation", async () => {
  const source = await seed("alice");
  await seed("bob");
  const before = (await pool.query('SELECT * FROM "KanbanDocument" ORDER BY "userId"')).rows;
  const first = await backfillOwner(pool, "alice");
  assert.equal(first.status, "verified");
  assert.deepEqual(first.counts, { boards: 2, lists: 6, cards: 6 });
  const keys = (await pool.query('SELECT * FROM "KanbanBoardIdentity" ORDER BY "boardKey"')).rows;
  const cards = (await pool.query('SELECT * FROM "KanbanCard" ORDER BY "boardKey", "id"')).rows;
  assert.deepEqual(await backfillOwner(pool, "alice"), first);
  assert.deepEqual((await pool.query('SELECT * FROM "KanbanBoardIdentity" ORDER BY "boardKey"')).rows, keys);
  assert.deepEqual((await pool.query('SELECT * FROM "KanbanCard" ORDER BY "boardKey", "id"')).rows, cards);
  await backfillOwner(pool, "bob");
  assert.equal((await pool.query('SELECT count(DISTINCT "boardKey")::int AS n FROM "KanbanBoardIdentity"')).rows[0].n, 4);
  assert.deepEqual((await pool.query('SELECT * FROM "KanbanDocument" ORDER BY "userId"')).rows, before);
  await migrationTransaction(pool, "alice", async (client) => {
    const { document } = await readShadowDocument(client, "alice");
    assert.deepEqual(document, { boards: source.boards, activeBoardId: source.activeBoardId });
    assert.deepEqual(parseKanbanBackup(createKanbanBackup(document.boards, document.activeBoardId)), document);
  });
});

test("legacy updates, deletes and re-additions reconcile with stable aliases; corruption blocks verification", async () => {
  const source = await seed("reconcile");
  await backfillOwner(pool, "reconcile");
  const keys = (await pool.query('SELECT * FROM "KanbanBoardIdentity" WHERE "ownerId"=$1 ORDER BY "id"', ["reconcile"])).rows;
  source.boards[1].tasks[0].title = "Saved while migration was running";
  source.boards[1].lists.reverse();
  source.boards[1] = cleanBoards([source.boards[1]])[0];
  source.boards.reverse();
  await pool.query('UPDATE "KanbanDocument" SET "boards"=$2::jsonb, "revision"="revision"+1 WHERE "userId"=$1', ["reconcile", JSON.stringify(source.boards)]);
  await assert.rejects(verify("reconcile"), /Legacy source changed/);
  assert.equal((await backfillOwner(pool, "reconcile")).status, "verified");
  await pool.query('UPDATE "KanbanDocument" SET "boards"=$2::jsonb, "revision"="revision"+1 WHERE "userId"=$1', ["reconcile", JSON.stringify([source.boards[0]])]);
  await backfillOwner(pool, "reconcile");
  await pool.query('UPDATE "KanbanDocument" SET "boards"=$2::jsonb, "revision"="revision"+1 WHERE "userId"=$1', ["reconcile", JSON.stringify(source.boards)]);
  await backfillOwner(pool, "reconcile");
  assert.deepEqual((await pool.query('SELECT * FROM "KanbanBoardIdentity" WHERE "ownerId"=$1 ORDER BY "id"', ["reconcile"])).rows, keys);
  const key = keys[0].boardKey;
  await pool.query('UPDATE "KanbanCard" SET "description"=$2 WHERE "boardKey"=$1 AND "id"=$3', [key, "corrupt", "1"]);
  await assert.rejects(verify("reconcile"), /Shadow verification failed/);
  await assert.rejects(backfillOwner(pool, "reconcile"), /Shadow verification failed/);
});

test("malformed input has repair evidence; ambiguity and partial failure preserve source and prior shadow", async () => {
  const source = await seed("malformed", { boards: [{ id: "main", name: " Old ", cards: [{ id: "1", title: "Card", column: "todo" }, null] }], activeBoardId: "missing", revision: 1 });
  const result = await backfillOwner(pool, "malformed");
  assert.equal(result.status, "review_required");
  await assert.rejects(cutoverOwner(pool, "malformed"), /review and repair/);
  assert.ok(result.repairs.length);
  assert.deepEqual((await pool.query('SELECT "sourceDocument" FROM "KanbanTransition" WHERE "ownerId"=$1', ["malformed"])).rows[0].sourceDocument, source);
  assert.deepEqual(await backfillOwner(pool, "malformed"), result);
  const duplicate = fixture();
  duplicate.boards[0].tasks.push(structuredClone(duplicate.boards[0].tasks[0]));
  await seed("duplicate", duplicate);
  await assert.rejects(backfillOwner(pool, "duplicate"), /Ambiguous duplicate/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM "KanbanBoard" WHERE "ownerId"=$1', ["duplicate"])).rows[0].n, 0);
  assert.deepEqual((await pool.query('SELECT "boards" FROM "KanbanDocument" WHERE "userId"=$1', ["duplicate"])).rows[0].boards, duplicate.boards);
  const valid = await seed("atomic");
  await backfillOwner(pool, "atomic");
  valid.boards[0].tasks[0].title = "cause insert failure";
  await pool.query('UPDATE "KanbanDocument" SET "boards"=$2::jsonb, "revision"=8 WHERE "userId"=$1', ["atomic", JSON.stringify(valid.boards)]);
  await pool.query(`ALTER TABLE "KanbanCard" ADD CONSTRAINT test_failure CHECK ("title" <> 'cause insert failure')`);
  await assert.rejects(backfillOwner(pool, "atomic"), /test_failure/);
  assert.equal((await pool.query('SELECT "sourceRevision" FROM "KanbanTransition" WHERE "ownerId"=$1', ["atomic"])).rows[0].sourceRevision, 7);
  await pool.query('ALTER TABLE "KanbanCard" DROP CONSTRAINT test_failure');
  assert.equal((await backfillOwner(pool, "atomic")).sourceRevision, 8);
});

test("SQL constraints prevent cross-board placement, owner alias changes and cross-owner active selection", async () => {
  const alice = (await pool.query('SELECT "boardKey" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "id"', ["alice"])).rows[0].boardKey;
  const bob = (await pool.query('SELECT "boardKey" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "id"', ["bob"])).rows[0].boardKey;
  await pool.query('INSERT INTO "KanbanList" ("boardKey","id","name","color","icon","position","updatedAt") VALUES ($1,$2,$2,$3,$4,3,NOW())', [bob, "bob-only", "blue", "circle"]);
  await assert.rejects(pool.query('UPDATE "KanbanCard" SET "listId"=$2 WHERE "boardKey"=$1', [alice, "bob-only"]), { code: "23503" });
  await assert.rejects(pool.query('UPDATE "KanbanProfile" SET "activeBoardKey"=$2 WHERE "userId"=$1', ["alice", bob]), { code: "23503" });
  await assert.rejects(pool.query('UPDATE "KanbanBoard" SET "ownerId"=$2 WHERE "boardKey"=$1', [alice, "mallory"]), { code: "23503" });
  await assert.rejects(pool.query('UPDATE "KanbanCard" SET "contentVersion"=0 WHERE "boardKey"=$1', [alice]), { code: "23514" });
});

test("a legacy writer that wins the lock is reconciled before the final checkpoint", async () => {
  await seed("writer-first");
  await backfillOwner(pool, "writer-first");
  const writer = await pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query('UPDATE "KanbanDocument" SET "revision"=8 WHERE "userId"=$1', ["writer-first"]);
    const pending = backfillOwner(pool, "writer-first");
    // Separate verification after completion proves the source revision committed.
    await writer.query("COMMIT");
    assert.equal((await pending).sourceRevision, 8);
    assert.equal((await verify("writer-first")).sourceRevision, 8);
  } finally { await writer.query("ROLLBACK"); writer.release(); }
});

test("cutover fence rejects a blocked old UPDATE and DELETE, and missing-document INSERT", async () => {
  for (const operation of ["UPDATE", "DELETE", "INSERT"]) {
    const owner = `fence-${operation}`;
    if (operation !== "INSERT") await seed(owner);
    await backfillOwner(pool, owner);
    const cutover = await pool.connect();
    const writer = await pool.connect();
    try {
      await cutover.query("BEGIN");
      await lockMigrationOwner(cutover, owner);
      await verifyShadow(cutover, owner);
      const pid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const pending = (operation === "INSERT" ? seed(owner, fixture(), writer)
        : writer.query(`${operation === "UPDATE" ? 'UPDATE "KanbanDocument" SET "revision"=999' : 'DELETE FROM "KanbanDocument"'} WHERE "userId"=$1`, [owner]))
        .then(() => null, (error) => error);
      await waitForLock(pid);
      // Hold the fence explicitly to exercise an old binary blocked at cutover.
      await cutover.query('UPDATE "KanbanTransition" SET "storageMode"=$2, "migrationEpoch"="migrationEpoch"+1 WHERE "ownerId"=$1', [owner, "modular"]);
      await cutover.query("COMMIT");
      assert.equal((await pending)?.message, "kanban_upgrade_required");
      const rows = (await pool.query('SELECT "revision" FROM "KanbanDocument" WHERE "userId"=$1', [owner])).rows;
      assert.deepEqual(rows, operation === "INSERT" ? [] : [{ revision: 7 }]);
      await assert.rejects(backfillOwner(pool, owner), /forbidden after authority changes/);
    } finally {
      await cutover.query("ROLLBACK"); cutover.release(); writer.release();
    }
  }
});

test("repeatable-read legacy writes cannot bypass the fence using a stale snapshot", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await assert.rejects(client.query('UPDATE "KanbanDocument" SET "revision"=999 WHERE "userId"=$1', ["alice"]), /requires_read_committed/);
  } finally { await client.query("ROLLBACK"); client.release(); }
});

test("operator commands exercise explicit targeting, verification and nonzero review/blocked exits", async () => {
  await seed("operator");
  const url = new URL(database);
  url.searchParams.set("schema", schema);
  const run = (...args) => promisify(execFile)(process.execPath, ["scripts/kanban-shadow.mjs", ...args], {
    cwd, env: { ...process.env, KANBAN_MIGRATION_DATABASE_URL: url.toString() }, timeout: 10000,
  });
  assert.equal(JSON.parse((await run("backfill", "--owner", "operator")).stdout).status, "verified");
  assert.equal(JSON.parse((await run("verify", "--owner", "operator")).stdout).status, "verified");
  await assert.rejects(run("backfill", "--owner", "malformed"), (error) => error.code === 2 && JSON.parse(error.stdout).status === "review_required");
  await assert.rejects(run("verify", "--owner", "reconcile"), (error) => error.code === 1 && JSON.parse(error.stderr).status === "blocked");
  const cutover = JSON.parse((await promisify(execFile)(process.execPath, ["scripts/kanban-cutover.mjs", "cutover", "--owner", "operator"], {
    cwd, env: { ...process.env, KANBAN_MIGRATION_DATABASE_URL: url.toString() }, timeout: 10000,
  })).stdout);
  assert.equal(cutover.status, "cutover");
  assert.equal((await pool.query('SELECT "storageMode" FROM "KanbanTransition" WHERE "ownerId"=$1', ["operator"])).rows[0].storageMode, "modular");
  await assert.rejects(run("verify", "--owner", "operator"), (error) => error.code === 1);
});

test("controlled rollback restores the modular snapshot and mirror retirement fences legacy writes", async () => {
  await seed("cutover-lifecycle");
  await backfillOwner(pool, "cutover-lifecycle");
  const cutover = await cutoverOwner(pool, "cutover-lifecycle");
  assert.equal(cutover.status, "cutover");
  const rollback = await rollbackOwner(pool, "cutover-lifecycle");
  assert.equal(rollback.status, "rollback");
  assert.equal((await pool.query('SELECT "storageMode" FROM "KanbanTransition" WHERE "ownerId"=$1', ["cutover-lifecycle"])).rows[0].storageMode, "legacy");
  await cutoverOwner(pool, "cutover-lifecycle");
  const retired = await retireCompatibilityMirror(pool, "cutover-lifecycle");
  assert.equal(retired.status, "mirror_retired");
  const transition = (await pool.query('SELECT "storageMode","compatibilityMirror" FROM "KanbanTransition" WHERE "ownerId"=$1', ["cutover-lifecycle"])).rows[0];
  assert.deepEqual(transition, { storageMode: "modular", compatibilityMirror: false });
  await assert.rejects(pool.query('UPDATE "KanbanDocument" SET "revision"="revision"+1 WHERE "userId"=$1', ["cutover-lifecycle"]), /kanban_upgrade_required/);
});

test("retired mirror recovery checkpoints, rollback and re-cutover preserve published versions", async () => {
  const owner = "recovery-history";
  await seed(owner); await backfillOwner(pool, owner); await cutoverOwner(pool, owner);
  const retired = await retireCompatibilityMirror(pool, owner);
  const board = (await pool.query('SELECT * FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "position"', [owner])).rows[0];
  await applyKanbanOperation(owner, { contractVersion: 2, operationId: randomUUID(), epoch: retired.epoch, boardKey: board.boardKey, type: "card.update", cardId: "1", expectedContentVersion: 1, changes: { title: "After mirror retirement" } }, pool);
  await assert.rejects(rollbackOwner(pool, owner), /snapshot is stale/);
  await checkpointOwner(pool, owner);
  await pool.query('UPDATE "KanbanRollbackSnapshot" SET "digest"=$2 WHERE "ownerId"=$1', [owner, "tampered"]);
  await assert.rejects(rollbackOwner(pool, owner), /snapshot is stale/);
  await checkpointOwner(pool, owner);
  await rollbackOwner(pool, owner);
  const source = (await pool.query('SELECT "boards","activeBoardId","revision" FROM "KanbanDocument" WHERE "userId"=$1', [owner])).rows[0];
  assert.equal(source.boards[0].tasks[0].title, "After mirror retirement");
  source.boards[0].tasks[0].title = "Edited on legacy after rollback";
  await pool.query('UPDATE "KanbanDocument" SET "boards"=$2::jsonb,"revision"="revision"+1 WHERE "userId"=$1', [owner, JSON.stringify(source.boards)]);
  await assert.rejects(backfillOwner(pool, owner), /must not reset published item versions/);
  await assert.rejects(cutoverOwner(pool, owner), /Legacy source changed/);
  assert.equal((await reconcileRolledBackOwner(pool, owner)).status, "verified");
  const published = (await pool.query('SELECT "contentVersion","title" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [board.boardKey, "1"])).rows[0];
  assert.deepEqual(published, { contentVersion: 3, title: "Edited on legacy after rollback" });
  const next = await cutoverOwner(pool, owner);
  assert.ok(next.epoch > retired.epoch);
  assert.equal((await pool.query('SELECT "contentVersion" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [board.boardKey, "1"])).rows[0].contentVersion, 3);
});

test("rollback rehearsal restores the latest verified compatibility snapshot, preserving modular rows", async () => {
  await seed("rollback");
  await backfillOwner(pool, "rollback");
  await migrationTransaction(pool, "rollback", async (client) => {
    await verifyShadow(client, "rollback");
    await client.query('UPDATE "KanbanTransition" SET "storageMode"=$2, "migrationEpoch"=2 WHERE "ownerId"=$1', ["rollback", "modular"]);
    // Simulate a future service transaction: content, revision and snapshot commit together.
    await client.query('UPDATE "KanbanCard" c SET "title"=$2,"contentVersion"=2 FROM "KanbanBoard" b WHERE c."boardKey"=b."boardKey" AND b."ownerId"=$1 AND c."id"=$3', ["rollback", "Post-cutover work survives", "1"]);
    await client.query('UPDATE "KanbanBoard" SET "revision"=2 WHERE "ownerId"=$1', ["rollback"]);
    const { document } = await readShadowDocument(client, "rollback");
    const checkpoint = (await client.query('SELECT "boardKey","revision" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "boardKey"', ["rollback"])).rows;
    await client.query('INSERT INTO "KanbanRollbackSnapshot" ("ownerId","document","compatibilityRevision","checkpoint","digest","updatedAt") VALUES ($1,$2::jsonb,8,$3::jsonb,$4,NOW())', ["rollback", JSON.stringify(document), JSON.stringify(checkpoint), migrationDigest(document)]);
  });
  await migrationTransaction(pool, "rollback", async (client) => {
    await client.query('UPDATE "KanbanTransition" SET "storageMode"=$2 WHERE "ownerId"=$1', ["rollback", "paused"]);
    const snapshot = (await client.query('SELECT * FROM "KanbanRollbackSnapshot" WHERE "ownerId"=$1', ["rollback"])).rows[0];
    const { document } = await readShadowDocument(client, "rollback");
    const checkpoint = (await client.query('SELECT "boardKey","revision" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "boardKey"', ["rollback"])).rows;
    assert.deepEqual(snapshot.checkpoint, checkpoint);
    assert.equal(snapshot.digest, migrationDigest(document));
    assert.deepEqual(snapshot.document, document);
    assert.ok(Buffer.byteLength(JSON.stringify(document)) <= 2 * 1024 * 1024);
    // Controlled maintenance transaction: mode is not visible until the restore
    // commits. The held owner lock continues to fence old writers throughout.
    await client.query('UPDATE "KanbanTransition" SET "storageMode"=$2,"migrationEpoch"=3 WHERE "ownerId"=$1', ["rollback", "legacy"]);
    await client.query('UPDATE "KanbanDocument" SET "boards"=$2::jsonb,"activeBoardId"=$3,"revision"=$4 WHERE "userId"=$1', ["rollback", JSON.stringify(document.boards), document.activeBoardId, snapshot.compatibilityRevision]);
  });
  const restored = (await pool.query('SELECT * FROM "KanbanDocument" WHERE "userId"=$1', ["rollback"])).rows[0];
  assert.equal(restored.revision, 8);
  assert.equal(restored.boards[0].tasks[0].title, "Post-cutover work survives");
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM "KanbanBoard" WHERE "ownerId"=$1', ["rollback"])).rows[0].n, 2);
});

let roadmapKey;
const roadmap = structuredClone(starterBoards[0]);
roadmap.tasks = Array.from({ length: 88 }, (_, index) => ({
  id: `card-${String(index).padStart(3, "0")}`, title: `Roadmap ${index}`, description: '"\\\n🌳'.repeat(index === 0 ? 20000 : 1000), dueDate: "2026-10-12", color: "green", listId: "todo", order: index,
}));
function bounded(result) {
  assert.ok(Buffer.byteLength(JSON.stringify(v2Envelope(result))) <= 65536);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 65536);
}

test("v2 reads traverse all 88 complete details and reconstruct an oversized Unicode card", async () => {
  await seed("roadmap", { boards: [roadmap], activeBoardId: roadmap.id, revision: 1 });
  await backfillOwner(pool, "roadmap");
  await pool.query('UPDATE "KanbanTransition" SET "storageMode"=$2 WHERE "ownerId"=$1', ["roadmap", "modular"]);
  const boards = await listV2Boards("roadmap", {}, pool);
  kanbanV2ReadSchemas.boards.output.parse(boards);
  roadmapKey = boards.items[0].boardKey;
  const lists = await listV2Lists("roadmap", { boardKey: roadmapKey }, pool);
  kanbanV2ReadSchemas.lists.output.parse(lists);
  const summaries = await listV2Cards("roadmap", { boardKey: roadmapKey, limit: 50 }, pool);
  kanbanV2ReadSchemas.cards.output.parse(summaries);
  assert.equal(summaries.items.length, 50);
  assert.equal(summaries.items[0].description, undefined);
  const recovered = [];
  let cursor;
  let pageCount = 0;
  do {
    const page = await readV2CardDetails("roadmap", { boardKey: roadmapKey, limit: 50, cursor }, pool);
    bounded(page);
    kanbanV2ReadSchemas["card-details"].output.parse(page);
    assert.ok(page.items.length > 0);
    pageCount++;
    for (const item of page.items) {
      if (item.kind === "card") { recovered.push(item.card); continue; }
      let chunkCursor = item.cursor;
      let json = "";
      do {
        const chunk = await readV2DetailChunk("roadmap", { boardKey: roadmapKey, id: item.id, cursor: chunkCursor }, pool);
        bounded(chunk);
        kanbanV2ReadSchemas["detail-chunks"].output.parse(chunk);
        assert.ok(chunk.jsonFragment.length > 0);
        json += chunk.jsonFragment;
        chunkCursor = chunk.nextCursor;
      } while (chunkCursor);
      recovered.push(JSON.parse(json));
    }
    cursor = page.nextCursor;
  } while (cursor);
  assert.ok(pageCount > 2, "byte budget, not only 50-card limit, must paginate");
  assert.equal(recovered.length, 88);
  assert.equal(new Set(recovered.map((card) => card.id)).size, 88);
  assert.deepEqual(recovered.map((card) => Object.fromEntries(Object.keys(roadmap.tasks[0]).map((key) => [key, card[key]]))), roadmap.tasks);
});

test("v2 one-card query footprint excludes the legacy document and unrelated card rows", async () => {
  const statements = [];
  const tracedPool = { connect: async () => {
    const client = await pool.connect();
    return { query: async (...args) => {
      const result = await client.query(...args);
      statements.push({ sql: args[0], values: args[1], rowCount: result.rowCount });
      return result;
    }, release: () => client.release() };
  } };
  const result = await getV2Card("roadmap", { boardKey: roadmapKey, id: "card-001" }, tracedPool);
  kanbanV2ReadSchemas.card.output.parse(result);
  assert.equal(result.result.kind, "card");
  assert.equal(result.result.card.description, roadmap.tasks[1].description);
  assert.equal(statements.filter((query) => query.sql.includes('FROM "KanbanCard"')).length, 1);
  const cardRead = statements.find((query) => query.sql.includes('FROM "KanbanCard"'));
  assert.equal(cardRead.rowCount, 1);
  assert.deepEqual(cardRead.values, [roadmapKey, "card-001"]);
  assert.ok(statements.every((query) => !query.sql.includes("KanbanDocument")));
  statements.length = 0;
  await listV2Cards("roadmap", { boardKey: roadmapKey, query: "🌳", limit: 2 }, tracedPool);
  assert.ok(statements.some((query) => query.sql.includes('left(c."description",240)')));
  assert.ok(statements.every((query) => !query.sql.includes("KanbanDocument")));
});

test("v2 cursors bind account, board, filters and projection, and restart after a revision change", async () => {
  await pool.query('UPDATE "KanbanTransition" SET "storageMode"=$2 WHERE "ownerId"=$1', ["bob", "modular"]);
  const first = await listV2Cards("roadmap", { boardKey: roadmapKey, limit: 2 }, pool);
  await assert.rejects(listV2Cards("bob", { boardKey: roadmapKey, cursor: first.nextCursor }, pool), { code: "not_found" });
  await assert.rejects(listV2Cards("roadmap", { boardKey: roadmapKey, query: "other", cursor: first.nextCursor }, pool), { code: "invalid" });
  await assert.rejects(readV2CardDetails("roadmap", { boardKey: roadmapKey, cursor: first.nextCursor }, pool), { code: "invalid" });
  const filtered = await listV2Cards("roadmap", { boardKey: roadmapKey, ids: ["card-004", "card-006"] }, pool);
  assert.deepEqual(filtered.items.map((card) => card.id), ["card-004", "card-006"]);
  const otherBoards = await listV2Boards("bob", { limit: 1 }, pool);
  await assert.rejects(listV2Boards("roadmap", { cursor: otherBoards.nextCursor }, pool), { code: "invalid" });
  await pool.query('UPDATE "KanbanBoard" SET "revision"="revision"+1 WHERE "boardKey"=$1', [roadmapKey]);
  await assert.rejects(listV2Cards("roadmap", { boardKey: roadmapKey, cursor: first.nextCursor }, pool), { code: "restart_read" });
  const oversized = await getV2Card("roadmap", { boardKey: roadmapKey, id: "card-000" }, pool);
  assert.equal(oversized.result.kind, "detail_required");
  const chunk = await readV2DetailChunk("roadmap", { boardKey: roadmapKey, id: "card-000", cursor: oversized.result.cursor }, pool);
  await pool.query('UPDATE "KanbanCard" SET "contentVersion"="contentVersion"+1 WHERE "boardKey"=$1 AND "id"=$2', [roadmapKey, "card-000"]);
  await assert.rejects(readV2DetailChunk("roadmap", { boardKey: roadmapKey, id: "card-000", cursor: chunk.nextCursor }, pool), { code: "restart_read" });
});

test("v2 HTTP projections validate inputs, preserve details and bound response bodies", async () => {
  const response = await kanbanReadResponse("roadmap", "card-details", new URLSearchParams({ boardKey: roadmapKey, limit: "50" }), pool);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.text();
  assert.ok(Buffer.byteLength(body) <= 65536);
  kanbanV2ReadSchemas["card-details"].output.parse(JSON.parse(body));
  assert.equal((await kanbanReadResponse("roadmap", "cards", new URLSearchParams({ boardKey: roadmapKey, limit: "51" }), pool)).status, 400);
  const denied = await kanbanReadResponse("bob", "card", new URLSearchParams({ boardKey: roadmapKey, id: "card-001" }), pool);
  assert.equal(denied.status, 404);
  assert.deepEqual((await denied.json()).error, { code: "not_found", message: "Board unavailable." });
  const legacy = await kanbanReadResponse("alice", "boards", new URLSearchParams(), pool);
  assert.equal(legacy.status, 409);
  assert.equal((await legacy.json()).error.code, "upgrade_required");
});


test("legacy rollback requires recovering Trash first", async () => {
  const owner = randomUUID();
  await seed(owner); await backfillOwner(pool, owner); await cutoverOwner(pool, owner);
  const board = (await pool.query('SELECT "boardKey" FROM "KanbanBoard" WHERE "ownerId"=$1 ORDER BY "position" LIMIT 1', [owner])).rows[0];
  await pool.query('DELETE FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [board.boardKey, "1"]);
  await assert.rejects(rollbackOwner(pool, owner), /cards in Trash/);
  assert.equal((await pool.query('SELECT "storageMode" FROM "KanbanTransition" WHERE "ownerId"=$1', [owner])).rows[0].storageMode, "modular");
});
