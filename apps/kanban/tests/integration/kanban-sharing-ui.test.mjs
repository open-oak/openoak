import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium, devices } from "playwright";
import { createKanbanTestDatabase } from "../helpers/database.mjs";

// Each device gets its own server and auth rate-limit state.
if (!process.env.KANBAN_SHARING_UI_DEVICE) {
  for (const device of ["desktop", "mobile", "hosted"]) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, KANBAN_SHARING_UI_DEVICE: device }, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}
const database = await createKanbanTestDatabase();
const port = Number(process.env.KANBAN_SHARING_UI_TEST_PORT || 3418);
const origin = "http://localhost:" + port;
let logs = "", browser, currentPage;
const serverOptions = {
  cwd: fileURLToPath(new URL("../../", import.meta.url)),
  env: { ...process.env, DATABASE_URL: database.url, KANBAN_DATABASE_URL: database.url, KANBAN_DIRECT_URL: database.url, DATABASE_SCHEMA: database.schema, KANBAN_DATABASE_SCHEMA: database.schema, ACCOUNT_DATABASE_URL: "", ACCOUNT_DATABASE_SCHEMA: "", NEXT_PUBLIC_ACCOUNT_URL: "", AUTH_COOKIE_DOMAIN: "", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: "kanban-browser-test-only-secret-never-production", NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
};
function startServer(hosted = false) {
const child = spawn(process.execPath, [createRequire(import.meta.url).resolve("next/dist/bin/next"), "start", "-p", String(port)], { ...serverOptions, env: { ...serverOptions.env, ...(hosted ? { ACCOUNT_DATABASE_URL: database.url, ACCOUNT_DATABASE_SCHEMA: database.schema } : {}) } });
child.stdout.on("data", data => { logs += data; }); child.stderr.on("data", data => { logs += data; }); return child;
}
let server = startServer();

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + "/login")).ok) break; } catch {}
    if (i === 99) throw new Error("Test server failed to start: " + logs);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  for (const device of [process.env.KANBAN_SHARING_UI_DEVICE]) {
    const owner = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const editor = await browser.newContext(device === "mobile" ? { ...devices["Pixel 7"] } : { viewport: { width: 1440, height: 1000 } });
    const guest = await browser.newContext();
    async function register(context, name) {
      const email = randomUUID() + "@example.test";
      const response = await context.request.post(origin + "/api/auth/sign-up/email", { headers: { origin }, data: { email, password: "test-password-only", name } });
      assert.equal(response.status(), 200, await response.text());
      return (await response.json()).user;
    }
    const ownUser = await register(owner, "Board Owner"), member = await register(editor, "Board Editor");
    const hosted = device === "hosted";
    if (hosted) {
      server.kill("SIGTERM"); await new Promise(resolve => server.once("exit", resolve)); server = startServer(true);
      for (let i=0;i<100;i++) { try { if((await fetch(origin+"/health")).ok)break; }catch{} if(i===99)throw new Error("Hosted server unavailable");await new Promise(resolve=>setTimeout(resolve,100)); }
      // Use real stored sessions with the suite cookie prefix and shared identity DB.
      for (const context of [owner,editor]) { const cookies=await context.cookies();await context.clearCookies();await context.addCookies(cookies.map(cookie=>({...cookie,name:cookie.name.replace("open-kanban.","openoak.")}))); }
    }
    const ownerPage = await owner.newPage(), page = await editor.newPage(); currentPage = page;
    for (const surface of [ownerPage,page]) surface.setDefaultTimeout(15000);
    const errors = []; const calls = [];
    for (const surface of [ownerPage,page]) { surface.on("pageerror", error => errors.push(error.message)); surface.on("request", request => { if(request.url().includes("/api/")) calls.push(request.url()); }); }
    await ownerPage.goto(origin);
    await ownerPage.waitForFunction(() => document.body.textContent.includes("Synced"));
    const board = (await database.pool.query('SELECT * FROM "KanbanBoard" WHERE "ownerId"=$1',[ownUser.id])).rows[0];
    const write = async (context, actor, operation) => {
      const response = await context.request.post(origin + "/api/kanban/v2/operations", { headers: { origin, "x-openkanban-account": actor.id }, data: { contractVersion: 2, epoch: 1, operationId: randomUUID(), boardKey: board.boardKey, ...operation } });
      assert.equal(response.status(),200,await response.text()); return response.json();
    };
    await write(owner,ownUser,{type:"card.create",cardId:"shared-test",listId:"todo",expectedOrderVersion:1,title:"Shared test card"});
    await write(owner,ownUser,{type:"card.create",cardId:"other-test",listId:"todo",expectedOrderVersion:2,title:"Another card"});
    await ownerPage.getByRole("button",{name:"Board actions",exact:true}).filter({visible:true}).click();
    await ownerPage.getByRole("menuitem",{name:"Share board",exact:true}).click();
    await ownerPage.getByRole("button",{name:"Create invite link",exact:true}).click();
    const invite = await ownerPage.getByRole("textbox",{name:"Invite link",exact:true}).inputValue();
    const token = new URL(invite).pathname.split("/").at(-1);
    const guestPage = await guest.newPage(); await guestPage.goto(invite);
    await guestPage.getByRole("link",{name:"Sign in to join"}).waitFor();
    assert.ok((await guestPage.getByRole("link",{name:"Sign in to join"}).getAttribute("href")).includes(encodeURIComponent("/i/" + token)));
    if (!hosted) await editor.clearCookies();
    await page.goto(invite);
    if (!hosted) {
      await page.getByRole("link",{name:"Sign in to join"}).click();await page.getByLabel("Email",{exact:true}).fill(member.email);await page.getByLabel("Password",{exact:true}).fill("test-password-only");await page.getByRole("button",{name:"Sign in",exact:true}).click();
      await guestPage.getByRole("link",{name:"Sign in to join"}).click();await guestPage.getByRole("button",{name:"Need an account? Sign up"}).click();await guestPage.getByLabel("Name",{exact:true}).fill("Signup Invitee");await guestPage.getByLabel("Email",{exact:true}).fill(randomUUID()+"@example.test");await guestPage.getByLabel("Password",{exact:true}).fill("test-password-only");await guestPage.getByRole("button",{name:"Create account",exact:true}).click();await guestPage.getByRole("button",{name:"Join board",exact:true}).waitFor();
    }
    await page.getByRole("button",{name:"Join board",exact:true}).waitFor();
    assert.equal((await database.pool.query('SELECT count(*)::int n FROM "KanbanBoardMember" WHERE "boardKey"=$1',[board.boardKey])).rows[0].n,0);
    await page.getByRole("button",{name:"Join board",exact:true}).click();
    await page.locator('[data-task-id="shared-test"]').waitFor();
    await page.evaluate(async () => { await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("Offline shell failed to install")), 15000))]); });
    await page.getByRole("button",{name:"Board actions",exact:true}).filter({visible:true}).click();
    assert.equal(await page.getByRole("menuitem",{name:/Delete board|Reset board/}).count(),0);
    await page.getByRole("menuitem",{name:"Share board",exact:true}).click();
    await page.getByRole("button",{name:"Leave board",exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Create invite link",exact:true}).count(),0);
    await page.screenshot({path:"/tmp/openkanban-sharing-"+device+".png",fullPage:true,animations:"disabled"});
    await page.getByRole("button",{name:"Close",exact:true}).click();
    await page.waitForFunction(()=>document.activeElement?.getAttribute("aria-label")==="Board actions");
    await page.locator('[data-task-id="shared-test"]').click();
    const notes=page.getByPlaceholder("Add notes, links, or context");await notes.fill("Editor saved notes");
    await page.waitForFunction(() => Object.keys(localStorage).some(key=>key.startsWith("open-kanban-modular:") && JSON.parse(localStorage.getItem(key)).queue.length===0));
    await write(owner,ownUser,{type:"card.update",cardId:"other-test",expectedContentVersion:1,changes:{title:"Owner parallel edit"}});
    await page.evaluate(()=>window.dispatchEvent(new Event("online")));
    await page.waitForFunction(()=>document.body.textContent.includes("Owner parallel edit"));assert.equal(await notes.inputValue(),"Editor saved notes");
    // Same-field conflict keeps the local draft, with an explicit discard action.
    await editor.setOffline(true);await notes.fill("Offline conflicting draft");
    await write(owner,ownUser,{type:"card.update",cardId:"shared-test",expectedContentVersion:2,changes:{description:"Owner wins current version"}});
    await editor.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event("online")));
    await page.waitForFunction(()=>document.body.textContent.includes("This item changed elsewhere"));assert.equal(await notes.inputValue(),"Offline conflicting draft");
    await page.getByRole("button",{name:"Close task details",exact:true}).click();
    await page.getByRole("button",{name:"Discard this edit",exact:true}).click();
    await page.waitForFunction(()=>!document.body.textContent.includes("This item changed elsewhere"));
    await page.locator('[data-task-id="shared-test"]').click();assert.equal(await notes.inputValue(),"Owner wins current version");
    // Reload offline, remove membership, then reconnect: recover only unsent edits.
    await editor.setOffline(true);await notes.fill("Recover after removal " + device);
    await page.waitForFunction(()=>Object.keys(localStorage).some(key=>key.startsWith("open-kanban-modular:") && localStorage.getItem(key).includes("Recover after removal")));
    await page.reload({waitUntil:"domcontentloaded"});await page.locator('[data-task-id="shared-test"]').waitFor();
    await page.locator('[data-task-id="shared-test"]').click();assert.equal(await notes.inputValue(),"Recover after removal " + device);
    await ownerPage.getByRole("button",{name:"Close",exact:true}).click();
    await ownerPage.getByRole("button",{name:"Board actions",exact:true}).filter({visible:true}).click();await ownerPage.getByRole("menuitem",{name:"Share board",exact:true}).click();
    await ownerPage.getByRole("button",{name:"Remove Board Editor",exact:true}).click();
    await ownerPage.getByText("Only you so far.").waitFor();
    await editor.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event("online")));
    await page.getByText("A board is no longer available. Your unsent edits are saved separately for download.").waitFor();
    assert.equal(await page.locator('[data-task-id="shared-test"]').count(),0);
    const cached=await page.evaluate(id=>JSON.parse(localStorage.getItem("open-kanban-modular:"+id)),member.id);
    assert.equal(cached.loaded[board.boardKey],undefined);assert.equal(cached.queue.length,0);assert.match(JSON.stringify(cached.recovery),/Recover after removal/);
    const final=(await database.pool.query('SELECT "description" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=\'shared-test\'',[board.boardKey])).rows[0];assert.equal(final.description,"Owner wins current version");
    await ownerPage.getByRole("button",{name:"Replace link",exact:true}).click();
    await ownerPage.waitForFunction(old => document.querySelector("#board-invite-link")?.value !== old, invite);
    await guestPage.reload();await guestPage.getByRole("heading",{name:"Invite unavailable"}).waitFor();
    await ownerPage.getByRole("button",{name:"Disable link",exact:true}).click();await ownerPage.getByRole("button",{name:"Create invite link",exact:true}).waitFor();
    assert.equal(calls.some(url=>new URL(url).pathname==="/api/boards"),false);assert.deepEqual(errors,[]);
    console.log(device+": two accounts, explicit join, sharing controls, concurrent edits, conflict recovery, offline reload and access removal: PASS");
    await owner.close();await editor.close();await guest.close();
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
