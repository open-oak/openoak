import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { chromium, devices } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { hashPassword } from "better-auth/crypto";

const urls = { account: "http://localhost:3500", todo: "http://localhost:3501", outline: "http://localhost:3502", kanban: "http://localhost:3503" };
async function eventually(check, message) {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(message);
}

export async function testRecoveryUi({ schemas, databaseUrl, account, todo, outline }) {
  const servers = [], logs = [];
  let browser, page;
  const password = "test-password-only", secret = "openoak-ui-suite-secret-with-at-least-32-characters";
  try {
    for (const [index, app] of ["account", "todo", "outline"].entries()) {
      let log = "";
      const server = spawn(process.execPath, [createRequire(import.meta.url).resolve("next/dist/bin/next"), "start", "-p", String(3500 + index)], {
        cwd: new URL(`../../apps/${app}/`, import.meta.url), stdio: ["ignore", "pipe", "pipe"], env: {
          ...process.env, NODE_ENV: "production", DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, DATABASE_SCHEMA: schemas[app],
          ACCOUNT_DATABASE_URL: databaseUrl, ACCOUNT_DATABASE_SCHEMA: schemas.account,
          TODO_DATABASE_URL: databaseUrl, TODO_DATABASE_SCHEMA: schemas.todo, OUTLINE_DATABASE_URL: databaseUrl, OUTLINE_DATABASE_SCHEMA: schemas.outline, KANBAN_DATABASE_URL: databaseUrl, KANBAN_DATABASE_SCHEMA: schemas.kanban,
          BETTER_AUTH_URL: urls[app], BETTER_AUTH_SECRET: secret, AUTH_COOKIE_PREFIX: "fixture-suite", AUTH_COOKIE_DOMAIN: "", AUTH_REDIRECT_HOSTS: "",
          NEXT_PUBLIC_ACCOUNT_URL: urls.account, OPENOAK_HOME_URL: urls.account, OPENOAK_ACCOUNT_URL: urls.account, OPENOAK_TODO_URL: urls.todo, OPENOAK_OUTLINE_URL: urls.outline, OPENOAK_KANBAN_URL: urls.kanban, MCP_RESOURCE_URL: "http://localhost:3504",
          ACCOUNT_DELETION_SCHEMAS: JSON.stringify(schemas), RESEND_API_KEY: "",
        },
      });
      servers.push(server); logs.push(() => log);
      server.stdout.on("data", (data) => { log += data; }); server.stderr.on("data", (data) => { log += data; });
      await eventually(async () => { try { return (await fetch(urls[app] + "/login")).ok; } catch { return false; } }, `Could not start ${app}: ${log}`);
    }
    browser = await chromium.launch({ headless: true });
    for (const mode of ["desktop", "mobile"]) {
      const context = await browser.newContext({ ...(mode === "mobile" ? devices["Pixel 7"] : { viewport: { width: 1440, height: 1000 } }), reducedMotion: "reduce" });
      page = await context.newPage(); page.setDefaultTimeout(15000);
      const errors = []; page.on("pageerror", (error) => errors.push(error.message));
      const id = randomUUID(), email = `${id}@example.test`, title = `UI task ${mode}`;
      await account.user.create({ data: { id, email, emailVerified: true, name: "Recovery UI test" } });
      await account.account.create({ data: { id: randomUUID(), issuer: "local:credential", providerId: "credential", accountId: id, userId: id, password: await hashPassword(password) } });
      await todo.todoProfile.create({ data: { id } });
      const list = await todo.list.create({ data: { ownerId: id, name: `UI list ${mode}` } });
      const task = await todo.task.create({ data: { title, listId: list.id, createdById: id, subtasks: { create: { title: "Recovery step" } } } });
      await outline.notesProfile.create({ data: { id } });
      const note = await outline.note.create({ data: { ownerId: id, title: `UI note ${mode}`, body: "Original body" } });

      const login = await context.request.post(urls.account + "/api/auth/sign-in/email", { data: { email, password }, headers: { origin: urls.account } });
      assert.equal(login.status(), 200, await login.text());
      await page.goto(urls.account + "/apps");
      assert.equal(await page.getByRole("link", { name: "OpenTodo", exact: true }).getAttribute("href"), urls.todo);
      await page.getByRole("link", { name: "OpenTodo", exact: true }).click();
      await page.waitForURL(urls.todo + "/");
      await page.goto(urls.todo + "/lists/" + list.id);
      await page.getByRole("button", { name: `Open ${title}`, exact: true }).click();
      await page.getByRole("button", { name: "Delete task", exact: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
      await eventually(async () => Boolean(await todo.taskTrash.findUnique({ where: { taskId: task.id } })), "Task was not placed in recovery");
      if (mode === "mobile") await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).filter({ visible: true }).first().click();
      await page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).click();
      await page.getByRole("button", { name: /^Deleted tasks/ }).click();
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await eventually(async () => Boolean(await todo.task.findUnique({ where: { id: task.id } })), "Task was not restored");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: `Open ${title}`, exact: true }).waitFor();
      assert.equal(await todo.subtask.count({ where: { taskId: task.id } }), 1);
      console.log(`${mode}: custom Account launcher, shared cookie and task recovery passed.`);

      await page.goto(urls.outline);
      const editor = page.getByRole("textbox", { name: "Note text", exact: true });
      await editor.fill(`Latest unsaved recovery text ${mode}`);
      await page.getByRole("button", { name: "Delete note", exact: true }).filter({ visible: true }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
      await eventually(async () => Boolean(await outline.noteTrash.findUnique({ where: { noteId: note.id } })), "Note was not placed in recovery");
      if (mode === "mobile") await page.getByRole("button", { name: "Open OpenOutline navigation", exact: true }).click();
      await page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).click();
      const downloadEvent = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export notes as JSON", exact: true }).click();
      const exported = JSON.parse(await readFile(await (await downloadEvent).path(), "utf8"));
      assert.equal(exported.format, "openoutline");
      assert.match(exported.deletedNotes.find((item) => item.noteId === note.id).body, /Latest unsaved recovery text/);
      await page.getByRole("button", { name: /^Deleted notes/ }).click();
      await eventually(async () => page.getByRole("button", { name: "Refresh", exact: true }).isEnabled(), "Recovery did not finish loading");
      await page.evaluate(async () => { await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))); });
      const audit = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      assert.deepEqual(audit.violations.map((item) => ({ id: item.id, nodes: item.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })) })), []);
      await page.screenshot({ path: `/tmp/openoak-recovery-${mode}.png`, fullPage: true });
      await page.getByRole("button", { name: "Restore", exact: true }).click();
      await eventually(async () => Boolean(await outline.note.findUnique({ where: { id: note.id } })), "Note was not restored");
      assert.match((await outline.note.findUniqueOrThrow({ where: { id: note.id } })).body, /Latest unsaved recovery text/);
      await page.keyboard.press("Escape");
      console.log(`${mode}: note recovery preserves unsaved text; export and recovery accessibility passed.`);

      await page.goto(urls.account + "/settings");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByLabel(/^Type your account email/).fill(email);
      await page.getByLabel("Current password", { exact: true }).fill("wrong-password");
      await page.getByRole("button", { name: "Permanently delete my account and data", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "The password is incorrect." }).waitFor();
      assert.equal(await account.user.count({ where: { id } }), 1);
      await page.getByLabel("Current password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Permanently delete my account and data", exact: true }).click();
      await page.waitForURL(urls.account + "/login?deleted=1");
      assert.equal(await account.user.count({ where: { id } }), 0);
      assert.equal(await todo.todoProfile.count({ where: { id } }), 0);
      assert.equal(await outline.notesProfile.count({ where: { id } }), 0);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`${mode}: verified self-service deletion and session logout passed.`);
    }
  } catch (error) {
    if (page) { console.error((await page.locator("body").innerText()).slice(0, 5000)); await page.screenshot({ path: "/tmp/openoak-recovery-ui-failure.png", fullPage: true }); }
    console.error(logs.map((read) => read().slice(-5000)).join("\n")); throw error;
  } finally { await browser?.close(); for (const server of servers) server.kill("SIGTERM"); }
}
