import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient as TodoClient } from "../apps/todo/generated/prisma/client.ts";
import { PrismaClient as OutlineClient } from "../apps/outline/generated/prisma/client.ts";
import { PrismaClient as AccountClient } from "../apps/account/generated/prisma/client.ts";
import { PrismaClient as KanbanClient } from "../apps/kanban/generated/kanban/client.ts";
import { postgresConnectionConfig } from "../apps/account/lib/postgres-connection.ts";
import { moveTaskToTrash, restoreTrashedTask } from "../apps/todo/lib/task-recovery.ts";
import { moveNoteToTrash, restoreTrashedNote } from "../apps/outline/lib/note-recovery.ts";
import { installSuiteAccountLinks, deleteSuiteAccountData } from "../apps/account/lib/account-deletion.ts";
import { accountTokenIsRevoked } from "../apps/mcp/lib/account-token-state.ts";

if (!process.env.SUITE_TEST_DATABASE_URL) throw new Error("Set SUITE_TEST_DATABASE_URL to a disposable PostgreSQL database.");
const base = new URL(process.env.SUITE_TEST_DATABASE_URL);
base.searchParams.delete("schema");
const connection = postgresConnectionConfig(base.toString());
const admin = new pg.Pool(connection);
const schemas = Object.fromEntries(["account", "todo", "outline", "kanban"].map((app) => [app, `recovery_${randomUUID().replaceAll("-", "")}_${app}`]));
const clients = [];
const created = [];
const command = promisify(execFile);
const database = (client) => ({ query: async (sql, ...params) => (await client.query(sql, params)).rows, execute: async (sql, ...params) => (await client.query(sql, params)).rowCount });
async function transaction(operation) {
  const client = await admin.connect();
  try { await client.query("BEGIN ISOLATION LEVEL READ COMMITTED"); const result = await operation(database(client)); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
function productClient(Client, app) {
  const client = new Client({ adapter: new PrismaPg(connection, { schema: schemas[app] }) });
  clients.push(client);
  return client;
}

try {
  for (const app of Object.keys(schemas)) {
    await admin.query(`CREATE SCHEMA "${schemas[app]}"`); created.push(schemas[app]);
    const url = new URL(base); url.searchParams.set("schema", schemas[app]);
    await command("npx", ["prisma", "migrate", "deploy", "--config", "prisma.config.ts"], {
      cwd: new URL(`../apps/${app}/`, import.meta.url), timeout: 60_000,
      env: { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString(), [`${app.toUpperCase()}_DATABASE_URL`]: url.toString(), [`${app.toUpperCase()}_DIRECT_URL`]: url.toString() },
    });
  }
  const todoUrl = new URL(base); todoUrl.searchParams.set("schema", schemas.todo);
  await command("npm", ["run", "test", "--workspace=@openoak/todo", "--", "tests/todoSharing.integration.test.ts"], {
    cwd: new URL("../", import.meta.url), timeout: 60_000,
    env: { ...process.env, TODO_INTEGRATION_DATABASE_URL: todoUrl.toString(), TODO_DATABASE_URL: todoUrl.toString(), TODO_DATABASE_SCHEMA: schemas.todo },
  });
  console.log("Passed all seven existing Todo sharing database tests without skips.");

  const todo = productClient(TodoClient, "todo"), outline = productClient(OutlineClient, "outline"), account = productClient(AccountClient, "account"), kanban = productClient(KanbanClient, "kanban");
  for (const id of ["owner", "editor", "outsider"]) {
    await account.user.create({ data: { id, email: `${id}@example.test`, emailVerified: true } });
    await todo.todoProfile.create({ data: { id } });
    await outline.notesProfile.create({ data: { id } });
  }
  await todo.list.create({ data: { id: "shared", name: "Shared list", ownerId: "owner", members: { create: { userId: "editor" } } } });
  await todo.list.create({ data: { id: "other-list", name: "Another person's list", ownerId: "editor" } });
  await todo.task.create({ data: { id: "task", title: "Recover me", notes: "Keep my notes", listId: "shared", createdById: "owner", dueDate: new Date("2026-12-01"), subtasks: { create: { id: "step", title: "Keep my step" } }, personalStates: { create: [{ userId: "owner", isImportant: true }, { userId: "editor", isMyDay: true }] } } });
  await assert.rejects(todo.$transaction(async (tx) => { await moveTaskToTrash(tx, "editor", "task"); throw new Error("rollback"); }), /rollback/);
  assert.equal(await todo.task.count({ where: { id: "task" } }), 1);
  assert.equal(await todo.taskTrash.count(), 0);
  assert.equal(await todo.$transaction((tx) => moveTaskToTrash(tx, "outsider", "task")), false);
  assert.equal(await todo.$transaction((tx) => moveTaskToTrash(tx, "editor", "task", new Date(0))), false);
  await todo.$transaction((tx) => moveTaskToTrash(tx, "editor", "task"), { isolationLevel: "Serializable" });
  const taskTrash = await todo.taskTrash.findUniqueOrThrow({ where: { taskId: "task" } });
  assert.equal(await todo.task.count(), 0); assert.equal(await todo.subtask.count(), 0);
  await assert.rejects(todo.$transaction((tx) => restoreTrashedTask(tx, "outsider", taskTrash.id)), /unavailable/);
  await todo.listMember.deleteMany({ where: { userId: "editor" } });
  await assert.rejects(todo.$transaction((tx) => restoreTrashedTask(tx, "editor", taskTrash.id)), /unavailable/);
  await todo.$transaction((tx) => restoreTrashedTask(tx, "owner", taskTrash.id), { isolationLevel: "Serializable" });
  const task = await todo.task.findUniqueOrThrow({ where: { id: "task" }, include: { subtasks: true, personalStates: true } });
  assert.equal(task.notes, "Keep my notes"); assert.equal(task.subtasks[0].id, "step");
  assert.deepEqual(task.personalStates.map((state) => state.userId), ["owner"]);
  await todo.$transaction((tx) => moveTaskToTrash(tx, "owner", "task"));
  const secondTrash = await todo.taskTrash.findUniqueOrThrow({ where: { taskId: "task" } });
  assert.notEqual(secondTrash.id, taskTrash.id);
  await assert.rejects(todo.$transaction((tx) => restoreTrashedTask(tx, "owner", taskTrash.id)), /unavailable/);
  console.log("Passed task snapshot, rollback, access removal, step recovery and stale restore checks.");

  await outline.folder.create({ data: { id: "folder", name: "Folder", nameKey: "folder", ownerId: "owner" } });
  await outline.note.create({ data: { id: "note", title: "Note", body: "# Preserve markdown", ownerId: "owner", folderId: "folder" } });
  assert.equal(await outline.$transaction((tx) => moveNoteToTrash(tx, "outsider", "note")), false);
  await outline.$transaction((tx) => moveNoteToTrash(tx, "owner", "note"));
  const noteTrash = await outline.noteTrash.findUniqueOrThrow({ where: { noteId: "note" } });
  await assert.rejects(outline.$transaction((tx) => restoreTrashedNote(tx, "outsider", noteTrash.id)), /unavailable/);
  await outline.folder.delete({ where: { id: "folder" } });
  const note = await outline.$transaction((tx) => restoreTrashedNote(tx, "owner", noteTrash.id));
  assert.equal(note.folderId, null); assert.equal(note.body, "# Preserve markdown");
  await outline.$transaction((tx) => moveNoteToTrash(tx, "owner", "note"));
  await outline.note.create({ data: { id: "other-note", title: "Other person's note", body: "Keep", ownerId: "editor" } });
  console.log("Passed note ownership, folder deletion and exact body recovery checks.");
  await todo.task.create({ data: { id: "other-recovery", title: "Other owner's recovery", listId: "other-list", createdById: "editor", personalStates: { create: [{ userId: "owner", isMyDay: true }, { userId: "editor", isImportant: true }] } } });
  await todo.$transaction((tx) => moveTaskToTrash(tx, "editor", "other-recovery"));


  for (const [ownerId, boardKey] of [["owner", "board-1"], ["editor", "board-2"]]) {
    await kanban.kanbanDocument.create({ data: { userId: ownerId, boards: [], activeBoardId: boardKey } });
    await kanban.kanbanBoardIdentity.create({ data: { boardKey, ownerId, id: boardKey } });
    await kanban.kanbanBoard.create({ data: { boardKey, ownerId, id: boardKey, name: boardKey, theme: "green", wallpaper: "none", wallpaperBlur: false, position: 0 } });
    await kanban.kanbanList.create({ data: { boardKey, id: "list", name: "List", color: "", icon: "", position: 0 } });
    await kanban.kanbanCard.create({ data: { boardKey, id: "card", listId: "list", position: 0, title: "Card", description: "Keep", dueDate: "" } });
    await kanban.kanbanProfile.create({ data: { userId: ownerId, activeBoardKey: boardKey, selectedBoardKey: boardKey === "board-1" ? "board-1" : "board-1" } });
    await kanban.kanbanTransition.create({ data: { ownerId, storageMode: "modular", sourceDocument: { ownerId } } });
    await kanban.kanbanRollbackSnapshot.create({ data: { ownerId, document: { ownerId }, checkpoint: {}, compatibilityRevision: 1, digest: "fixture" } });
    await kanban.kanbanEntityIdentity.create({ data: { boardKey, kind: "card", id: "card" } });
    await kanban.kanbanChange.create({ data: { boardKey, revision: 1, sequence: 0, kind: "card", id: "card" } });
  }
  await kanban.kanbanBoardMember.createMany({ data: [{ boardKey: "board-1", userId: "editor" }, { boardKey: "board-2", userId: "owner" }] });
  await kanban.kanbanOperationReceipt.createMany({ data: [{ actorId: "owner", operationId: "actor", ownerId: "editor", boardKey: "board-2", inputHash: "x", result: {} }, { actorId: "editor", operationId: "owned", ownerId: "owner", boardKey: "board-1", inputHash: "x", result: {} }, { actorId: "editor", operationId: "keep", ownerId: "editor", boardKey: "board-2", inputHash: "x", result: {} }] });
  const card = await kanban.kanbanCard.findUniqueOrThrow({ where: { boardKey_id: { boardKey: "board-1", id: "card" } } });
  await kanban.kanbanCardTrash.create({ data: { ...card, id: "trash-card" } });
  await account.session.create({ data: { id: "session", token: "fixture-token", userId: "owner", expiresAt: new Date(Date.now() + 60000) } });
  await account.oauthClient.create({ data: { id: "client", clientId: "client", scopes: [], contacts: [], redirectUris: [], grantTypes: [], responseTypes: [] } });
  await account.verification.createMany({ data: [{ id: "reset", identifier: "reset-password:fixture", value: "owner", expiresAt: new Date(Date.now() + 60000) }, { id: "keep", identifier: "reset-password:other", value: "editor", expiresAt: new Date(Date.now() + 60000) }] });
  assert.equal(await accountTokenIsRevoked(admin, schemas.account, "owner", "client", 100), false);
  await transaction((db) => installSuiteAccountLinks(db, schemas));
  await transaction((db) => installSuiteAccountLinks(db, schemas));
  await assert.rejects(transaction(async (db) => { await deleteSuiteAccountData(db, schemas, "owner"); throw new Error("rollback suite"); }), /rollback suite/);
  assert.equal(await account.user.count({ where: { id: "owner" } }), 1);
  assert.equal(await kanban.kanbanBoard.count({ where: { ownerId: "owner" } }), 1);
  assert.deepEqual(await account.$transaction((tx) => deleteSuiteAccountData({ query: (sql, ...values) => tx.$queryRawUnsafe(sql, ...values), execute: (sql, ...values) => tx.$executeRawUnsafe(sql, ...values) }, schemas, "owner"), { isolationLevel: "ReadCommitted", timeout: 30000 }), { deleted: true });
  assert.equal(await accountTokenIsRevoked(admin, schemas.account, "owner", "client", 100), true);
  assert.equal(await accountTokenIsRevoked(admin, schemas.account, "editor", "client", 100), false);
  assert.equal(await account.user.count({ where: { id: "owner" } }), 0);
  assert.equal(await account.session.count(), 0);
  assert.equal(await account.verification.count({ where: { value: "owner" } }), 0);
  assert.equal(await account.verification.count({ where: { value: "editor" } }), 1);
  assert.equal(await todo.todoProfile.count({ where: { id: "owner" } }), 0);
  assert.equal(await todo.taskTrash.count({ where: { createdById: "owner" } }), 0);
  const retainedTrash = await todo.taskTrash.findUniqueOrThrow({ where: { taskId: "other-recovery" } });
  assert.deepEqual(retainedTrash.snapshot.personalStates.map((state) => state.userId), ["editor"]);
  assert.equal(await todo.list.count({ where: { id: "other-list" } }), 1);
  assert.equal(await outline.noteTrash.count(), 0);
  assert.equal(await outline.note.count({ where: { id: "other-note" } }), 1);
  for (const model of ["kanbanBoard", "kanbanBoardIdentity"]) assert.equal(await kanban[model].count({ where: { ownerId: "owner" } }), 0);
  for (const model of ["kanbanCard", "kanbanCardTrash", "kanbanEntityIdentity", "kanbanChange"]) assert.equal(await kanban[model].count({ where: { boardKey: "board-1" } }), 0);
  for (const model of ["kanbanTransition", "kanbanRollbackSnapshot"]) assert.equal(await kanban[model].count({ where: { ownerId: "owner" } }), 0);
  assert.equal(await kanban.kanbanDocument.count({ where: { userId: "owner" } }), 0);
  assert.equal(await kanban.kanbanBoard.count({ where: { boardKey: "board-2" } }), 1);
  assert.equal(await kanban.kanbanOperationReceipt.count(), 1);
  assert.equal((await kanban.kanbanProfile.findUniqueOrThrow({ where: { userId: "editor" } })).selectedBoardKey, null);
  await assert.rejects(todo.todoProfile.create({ data: { id: "owner" } }));
  await assert.rejects(kanban.kanbanOperationReceipt.create({ data: { actorId: "owner", operationId: "late", ownerId: "editor", inputHash: "x", result: {} } }));
  assert.deepEqual(await transaction((db) => deleteSuiteAccountData(db, schemas, "owner")), { deleted: false });
  console.log("Passed modular suite deletion, rollback, legacy fence, retained collaborator data, token rejection and late-write prevention checks.");
  if (process.env.RECOVERY_UI_TESTS === "true") {
    const { testRecoveryUi } = await import("./tests/recovery-ui.mjs");
    await testRecoveryUi({ schemas, databaseUrl: base.toString(), account, todo, outline });
  }
} finally {
  await Promise.allSettled(clients.map((client) => client.$disconnect()));
  for (const schema of created.reverse()) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
