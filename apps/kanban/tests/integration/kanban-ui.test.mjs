import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseKanbanBackup } from "../../lib/kanban-backup.ts";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import AxeBuilder from "@axe-core/playwright";
import { chromium, devices } from "playwright";
import { createKanbanTestDatabase } from "../helpers/database.mjs";
import { starterBoards } from "../../lib/kanban-data.ts";
import { backfillOwner, cutoverOwner, retireCompatibilityMirror } from "../../lib/kanban-migration.ts";

const database = await createKanbanTestDatabase();
const port = Number(process.env.KANBAN_UI_TEST_PORT || 3417);
const origin = "http://localhost:" + port;
let logs = "", browser, currentPage;
const server = spawn(process.execPath, [createRequire(import.meta.url).resolve("next/dist/bin/next"), "start", "-p", String(port)], {
  cwd: fileURLToPath(new URL("../../", import.meta.url)),
  env: { ...process.env, DATABASE_URL: database.url, KANBAN_DATABASE_URL: database.url, KANBAN_DIRECT_URL: database.url, DATABASE_SCHEMA: database.schema, KANBAN_DATABASE_SCHEMA: database.schema,
    ACCOUNT_DATABASE_URL: "", ACCOUNT_DATABASE_SCHEMA: "", NEXT_PUBLIC_ACCOUNT_URL: "", AUTH_COOKIE_DOMAIN: "", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "kanban-browser-test-only-secret-never-production", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (data) => { logs += data; });
server.stderr.on("data", (data) => { logs += data; });
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + "/login")).ok) break; } catch {}
    if (i === 99) throw new Error("Test server failed to start: " + logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  for (const device of ["desktop", "mobile"]) {
    const context = await browser.newContext(device === "mobile" ? { ...devices["Pixel 7"] } : { viewport: { width: 1440, height: 1000 } });
    const email = randomUUID() + "@example.test";
    const registration = await context.request.post(origin + "/api/auth/sign-up/email", { data: { email, password: "test-password-only", name: "Offline Test" }, headers: { origin } });
    assert.equal(registration.status(), 200, await registration.text());
    const { user } = await registration.json();
    const linked = { ...structuredClone(starterBoards[0]), id: "linked", tasks: starterBoards[0].tasks.map((card) => ({ ...card, id: "linked-" + card.id })) };
    await database.pool.query('INSERT INTO "KanbanDocument" ("userId","boards","activeBoardId","revision") VALUES ($1,$2::jsonb,$3,1)', [user.id, JSON.stringify([...starterBoards, linked]), starterBoards[0].id]);
    await backfillOwner(database.pool, user.id); await cutoverOwner(database.pool, user.id); await retireCompatibilityMirror(database.pool, user.id);
    const board = (await database.pool.query('SELECT * FROM "KanbanBoard" WHERE "ownerId"=$1 AND "id"=$2', [user.id, starterBoards[0].id])).rows[0];
    const epoch = (await database.pool.query('SELECT "migrationEpoch" FROM "KanbanTransition" WHERE "ownerId"=$1', [user.id])).rows[0].migrationEpoch;
    const page = await context.newPage();
    currentPage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") logs += "\nBrowser: " + message.text(); });
    const calls = [];
    page.on("request", (request) => { if (request.url().includes("/api/")) calls.push(request.url()); });
    await page.goto(origin);
    await page.locator('[data-task-id="1"]').waitFor();
    await page.evaluate(async () => { await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("Offline shell failed to install")), 15000))]); });
    await page.locator('[data-task-id="1"]').click();
    const notes = page.getByPlaceholder("Add notes, links, or context");
    await notes.fill("Draft survives remote refresh");
    await page.waitForFunction(() => document.body.textContent.includes("Synced"));
    // A second independent session writes through the same public HTTP route.
    const second = await browser.newContext();
    const signIn = await second.request.post(origin + "/api/auth/sign-in/email", { data: { email, password: "test-password-only" }, headers: { origin } });
    assert.equal(signIn.status(), 200);
    const remote = await second.request.post(origin + "/api/kanban/v2/operations", { headers: { origin }, data: { contractVersion: 2, operationId: randomUUID(), epoch, boardKey: board.boardKey, type: "card.update", cardId: "2", expectedContentVersion: 1, changes: { title: "Other session edit" } } });
    assert.equal(remote.status(), 200, await remote.text());
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(() => document.body.textContent.includes("Other session edit"));
    assert.equal(await notes.inputValue(), "Draft survives remote refresh");
    assert.equal(await notes.isVisible(), true);
    await context.setOffline(true);
    await notes.fill("Offline work retained " + device);
    await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.startsWith("open-kanban-modular:") && localStorage.getItem(key).includes("Offline work retained")));
    await page.locator('.sync-badge-offline').filter({ visible: true }).waitFor();
    const offlineCalls = calls.length;
    await new Promise(resolve => setTimeout(resolve, 2300));
    assert.ok(calls.length - offlineCalls <= 1, "Offline failures must not start a 650ms retry loop");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-task-id="1"]').waitFor();
    await page.locator('[data-task-id="1"]').click();
    assert.equal(await page.getByPlaceholder("Add notes, links, or context").inputValue(), "Offline work retained " + device);
    // A deployment/schema mismatch during reconnect must keep the saved draft,
    // offer a reload, and resume the same queue without a discard action.
    const incompatible = route => route.fulfill({ json: { epoch: "incompatible" } });
    await page.route("**/api/kanban/v2/boards?*", incompatible);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByRole("button", { name: "Close task details", exact: true }).click();
    await page.getByRole("button", { name: "Reload OpenKanban", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Discard this edit", exact: true }).count(), 0);
    assert.equal(await page.getByText("Working offline", { exact: true }).count(), 0);
    await page.unroute("**/api/kanban/v2/boards?*", incompatible);
    await page.getByRole("button", { name: "Reload OpenKanban", exact: true }).click();
    await page.locator('[data-task-id="1"]').waitFor();
    await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.startsWith("open-kanban-modular:") && JSON.parse(localStorage.getItem(key)).queue.length === 0));
    const saved = (await database.pool.query('SELECT "description" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [board.boardKey, "1"])).rows[0];
    assert.equal(saved.description, "Offline work retained " + device);
    assert.equal(calls.some((url) => new URL(url).pathname === "/api/boards"), false);
    assert.deepEqual(errors, []);
    await page.locator('[data-task-id="1"]').focus();
    await page.keyboard.press("Alt+ArrowRight");
    await page.waitForFunction(() => Object.keys(localStorage).some((key) => key.startsWith("open-kanban-modular:") && JSON.parse(localStorage.getItem(key)).queue.length === 0));
    const moved = (await database.pool.query('SELECT "listId" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [board.boardKey, "1"])).rows[0];
    assert.equal(moved.listId, "doing");
    const synced = () => page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith("open-kanban-modular:") && JSON.parse(localStorage.getItem(key)).queue.length === 0));
    const archiveCard = async () => {
      const toolbar = page.getByRole("button", { name: "Board actions", exact: true }).filter({ visible: true });
      const before = await toolbar.boundingBox();
      await page.locator('[data-task-id="1"]').click();
      await page.getByRole("button", { name: "Archive", exact: true }).click();
      await synced();
      assert.equal(await page.locator('[data-task-id="1"]').count(), 0);
      assert.equal(await page.locator('.data-banner-sync-conflict').count(), 0, "Ordinary archiving must not raise a sync alert");
      assert.equal(await page.locator('.action-notice').count(), 1);
      assert.equal((await toolbar.boundingBox()).y, before.y, "Feedback must not shift the board");
      await page.screenshot({ path: "/tmp/openkanban-archive-notice-" + device + ".png", fullPage: true });
      assert.equal(await page.getByRole("alertdialog").count(), 0, "Archiving needs no confirmation");
    };
    const openArchive = async () => {
      await page.getByRole("button", { name: "Board actions", exact: true }).filter({ visible: true }).click();
      await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
      await page.getByRole("menu", { name: "Board actions", exact: true }).waitFor({ state: "hidden" });
      await page.getByRole("dialog", { name: "Archived cards", exact: true }).evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
      await page.getByRole("button", { name: /^Restore / }).first().waitFor();
    };
    const closeArchive = () => page.getByRole("button", { name: "Close archive", exact: true }).click();
    await archiveCard();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.locator('[data-task-id="1"]').waitFor(); await synced();
    await archiveCard(); await page.reload();
    await page.locator('[data-task-id="2"]').waitFor(); await openArchive();
    const archiveDialog = page.getByRole("dialog", { name: "Archived cards", exact: true });
    await archiveDialog.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    const panelBounds = await archiveDialog.boundingBox();
    assert.equal(panelBounds.y, 0);
    assert.ok(panelBounds.x >= 0 && panelBounds.x + panelBounds.width <= page.viewportSize().width + 1);
    assert.equal(Math.round(panelBounds.height), page.viewportSize().height);
    if (device === "desktop") {
      assert.equal(panelBounds.width, 350);
      assert.equal(await page.locator('[data-slot="dialog-overlay"]').count(), 0, "Desktop archive does not dim or block the board");
      await page.locator('[data-task-id="2"]').click();
      await page.getByRole("button", { name: "Close task details", exact: true }).click();
      await archiveDialog.waitFor({ state: "visible" });
    }
    const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    assert.deepEqual(accessibility.violations, []);
    const search = page.getByRole("textbox", { name: "Search archived cards" });
    await search.fill("does not match"); await page.getByText("No matching cards", { exact: true }).waitFor();
    await search.fill("Offline work retained"); await page.getByRole("button", { name: /^Restore / }).first().waitFor();
    await page.screenshot({ path: "/tmp/openkanban-archive-" + device + ".png", fullPage: true });
    await page.locator(".archive-card").filter({ hasText: "Map the project shape" }).click();
    assert.equal(await page.getByPlaceholder("Add notes, links, or context").inputValue(), "Offline work retained " + device);
    await page.getByRole("dialog", { name: "Archived card", exact: true }).evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    await page.screenshot({ path: "/tmp/openkanban-archive-detail-" + device + ".png", fullPage: true });
    await page.getByRole("button", { name: "Close task details", exact: true }).click();
    assert.equal(await search.inputValue(), "Offline work retained");
    await page.getByRole("button", { name: /^Restore / }).click();
    await page.getByText("No matching cards", { exact: true }).waitFor();
    assert.equal(await archiveDialog.isVisible(), true, "Restore keeps the archive open");
    await closeArchive();
    await page.locator('[data-task-id="1"]').waitFor(); await synced();
    assert.equal((await database.pool.query('SELECT "description" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [board.boardKey, "1"])).rows[0].description, "Offline work retained " + device);
    await archiveCard();
    const revision = (await database.pool.query('SELECT "revision" FROM "KanbanBoard" WHERE "boardKey"=$1', [board.boardKey])).rows[0].revision;
    const removedList = await context.request.post(origin + "/api/kanban/v2/operations", { headers: { origin }, data: { contractVersion: 2, operationId: randomUUID(), epoch, boardKey: board.boardKey, type: "list.delete", listId: "doing", expectedRevision: revision } });
    assert.equal(removedList.status(), 200, await removedList.text());
    await page.reload(); await page.locator('[data-task-id="2"]').waitFor(); await openArchive();
    await page.getByRole("button", { name: /^Restore / }).click();
    await page.getByRole("combobox", { name: "Restore to list" }).selectOption("done");
    await page.getByRole("button", { name: "Restore card", exact: true }).click();
    await page.getByText("No archived cards", { exact: true }).waitFor();
    await closeArchive(); await synced();
    assert.equal((await database.pool.query('SELECT "listId" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [board.boardKey, "1"])).rows[0].listId, "done");
    await archiveCard(); await openArchive();
    await page.getByRole("button", { name: "Delete Map the project shape", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await database.pool.query('SELECT count(*)::int n FROM "KanbanCardTrash" WHERE "boardKey"=$1', [board.boardKey])).rows[0].n, 1);
    await page.getByRole("button", { name: "Delete Map the project shape", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
    await page.getByText("No archived cards", { exact: true }).waitFor();
    await archiveDialog.waitFor({ state: "visible" });
    await closeArchive(); await synced();
    assert.equal((await database.pool.query('SELECT count(*)::int n FROM "KanbanCardTrash" WHERE "boardKey"=$1', [board.boardKey])).rows[0].n, 0);
    const seedArchive = { contractVersion: 2, epoch, boardKey: board.boardKey };
    for (const title of ["Bulk visible", "Bulk hidden"]) {
      const list = (await database.pool.query('SELECT "orderVersion" FROM "KanbanList" WHERE "boardKey"=$1 AND "id"=$2', [board.boardKey, "todo"])).rows[0];
      const cardId = randomUUID();
      const created = await context.request.post(origin + "/api/kanban/v2/operations", { headers: { origin }, data: { ...seedArchive, type: "card.create", operationId: randomUUID(), cardId, listId: "todo", title, expectedOrderVersion: list.orderVersion } });
      assert.equal(created.status(), 200, await created.text());
      const archived = await context.request.post(origin + "/api/kanban/v2/operations", { headers: { origin }, data: { ...seedArchive, type: "card.archive", operationId: randomUUID(), cardId, expectedContentVersion: 1, expectedPlacementVersion: 1 } });
      assert.equal(archived.status(), 200, await archived.text());
    }
    await openArchive();
    await page.screenshot({ path: "/tmp/openkanban-archive-" + device + ".png", fullPage: true });
    await search.fill("Bulk visible");
    await page.locator(".archive-card").filter({ hasText: "Bulk visible" }).waitFor();
    await page.getByRole("button", { name: "Delete all archived cards", exact: true }).click();
    await page.getByRole("alertdialog").getByText(/all 2 archived cards/).waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await database.pool.query('SELECT count(*)::int n FROM "KanbanCardTrash" WHERE "boardKey"=$1', [board.boardKey])).rows[0].n, 2);
    await page.getByRole("button", { name: "Delete all archived cards", exact: true }).click();
    await page.getByRole("button", { name: "Delete 2 archived cards", exact: true }).click();
    await page.getByText("All archived cards deleted", { exact: true }).waitFor();
    assert.equal((await database.pool.query('SELECT count(*)::int n FROM "KanbanCardTrash" WHERE "boardKey"=$1', [board.boardKey])).rows[0].n, 0);
    assert.equal((await database.pool.query('SELECT count(*)::int n FROM "KanbanCard" WHERE "boardKey"=$1', [board.boardKey])).rows[0].n, 2);
    await closeArchive(); await synced();
    assert.deepEqual(errors, []);
    console.log(device + ": Archive, Undo, search, inspect, restore destination, in-place actions, explicit deletion and accessibility: PASS");
    await page.getByRole("button", { name: "Board actions", exact: true }).filter({ visible: true }).click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Export this board", exact: true }).click();
    const archive = await readFile(await (await downloaded).path());
    const parsed = parseKanbanBackup(archive.toString());
    assert.equal(parsed.boards.length, 1);
    assert.equal(parsed.boards[0].tasks.length, 2);
    const countBoards = async () => (await database.pool.query('SELECT count(*)::int n FROM "KanbanBoard" WHERE "ownerId"=$1', [user.id])).rows[0].n;
    const originalCount = await countBoards();
    await page.locator('input[type="file"]').setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"format":"openkanban","version":999,"boards":[]}') });
    await page.getByText(/This file has invalid or unsupported board data/).waitFor();
    assert.equal(await countBoards(), originalCount);
    for (let copy = 1; copy <= 2; copy++) {
      await page.locator('input[type="file"]').setInputFiles({ name: "board.json", mimeType: "application/json", buffer: archive });
      await page.getByRole("alertdialog", { name: "Import board copies?", exact: true }).waitFor();
      await page.getByText(/2 lists, 2 cards, 0 archived/).waitFor();
      await page.getByRole("button", { name: "Import boards", exact: true }).click();
      await synced();
      assert.equal(await countBoards(), originalCount + copy);
    }
    assert.equal((await database.pool.query('SELECT count(*)::int n FROM "KanbanCard" WHERE "boardKey"=$1', [board.boardKey])).rows[0].n, 2);
    console.log(device + ": single-board download, malformed import rejection, preview and repeated independent copies: PASS");

    await page.screenshot({ path: "/tmp/openkanban-" + device + "-acceptance.png", fullPage: true });
    await page.goto(origin + "/?board=linked&card=linked-1");
    await page.getByPlaceholder("Add notes, links, or context").waitFor();
    assert.equal(await page.getByPlaceholder("Add notes, links, or context").isVisible(), true);
    console.log(device + ": authenticated UI, second-session refresh, open draft, offline reload/reconnect, keyboard move, no aggregate requests: PASS");
    await second.close(); await context.close();
  }
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    console.error(await currentPage.locator("body").innerText());
    await currentPage.screenshot({ path: "/tmp/openkanban-ui-failure.png", fullPage: true });
  }
  console.error(logs.slice(-5000)); throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => { if (server.exitCode !== null) resolve(); else server.once("exit", resolve); });
  await database.close();
}
