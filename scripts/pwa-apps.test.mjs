import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { chromium, devices } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apps = JSON.parse(await readFile(path.join(root, "shared/pwa/apps.json"), "utf8"));
const next = path.join(root, "node_modules/next/dist/bin/next");

test("built apps expose PWA metadata, register workers and offer accessible installation", { timeout: 180000 }, async (t) => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [index, [app, config]] of Object.entries(apps).entries()) await t.test(app, async () => {
      const port = 3490 + index;
      const origin = `http://localhost:${port}`;
      // Account login initializes OAuth resources. Recovery uses the same root
      // PWA controls without needing a database or a signed-in session.
      const entry = app === "account" ? "/forgot-password" : "/login";
      let logs = "";
      const server = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: path.join(root, "apps", app),
        env: { ...process.env, NODE_ENV: "production", BETTER_AUTH_URL: origin,
          BETTER_AUTH_SECRET: "pwa-browser-test-only-secret-never-production", ACCOUNT_DATABASE_URL: "",
          NEXT_PUBLIC_ACCOUNT_URL: "", AUTH_COOKIE_DOMAIN: "", DATABASE_URL: "postgresql://pwa:pwa@127.0.0.1:9/pwa" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      server.stdout.on("data", (data) => { logs += data; });
      server.stderr.on("data", (data) => { logs += data; });
      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          try { if ((await fetch(origin + "/manifest.webmanifest")).ok) break; } catch {}
          if (attempt === 99 || server.exitCode !== null) throw new Error("PWA app did not start: " + logs);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const worker = await fetch(origin + config.worker);
        assert.equal(worker.status, 200);
        assert.match(worker.headers.get("cache-control"), /no-store/);
        assert.equal(worker.headers.get("service-worker-allowed"), "/");
        const manifest = await (await fetch(origin + "/manifest.webmanifest")).json();
        assert.equal(manifest.name, config.name);

        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(origin + entry);
          assert.equal(new URL(page.url()).origin, origin);
          assert.equal(await page.locator('link[rel="manifest"]').getAttribute("href"), "/manifest.webmanifest");
          const favicon = page.locator('link[rel="icon"]');
          assert.equal(await favicon.count(), 1, `${config.name} exposes its emoji browser favicon`);
          assert.equal(await favicon.getAttribute("type"), "image/svg+xml");
          const icon = await context.request.get(new URL(await favicon.getAttribute("href"), origin).href);
          assert.equal(icon.status(), 200);
          assert.match(icon.headers()["content-type"], /image\/svg\+xml/);
          assert.ok((await icon.text()).includes(config.emoji), `${config.name} serves its expected emoji`);
          assert.equal(await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"), "/apple-touch-icon.png");
          assert.equal(await page.locator('meta[name="mobile-web-app-capable"]').getAttribute("content"), "yes");
          await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 20000 });
          const cdp = await context.newCDPSession(page);
          await cdp.send("Page.getAppManifest");
          assert.deepEqual((await cdp.send("Page.getInstallabilityErrors")).installabilityErrors, []);
          const installPromptPrevented = await page.evaluate(() => {
            window.installPromptCalled = false;
            const event = new Event("beforeinstallprompt", { cancelable: true });
            event.prompt = async () => { window.installPromptCalled = true; };
            event.userChoice = Promise.resolve({ outcome: "accepted" });
            window.dispatchEvent(event);
            return event.defaultPrevented;
          });
          assert.equal(installPromptPrevented, true);
          if (app === "account") {
            assert.equal(await page.getByRole("button", { name: `Install ${config.name}`, exact: true }).count(), 0);
            assert.equal(await page.evaluate(() => window.installPromptCalled), false);
          } else {
            await page.getByRole("button", { name: `Install ${config.name}`, exact: true }).waitFor();
            assert.deepEqual((await new AxeBuilder({ page }).include(".pwa-notices").analyze()).violations, []);
            await page.getByRole("button", { name: `Install ${config.name}`, exact: true }).click();
            assert.equal(await page.evaluate(() => window.installPromptCalled), true);
          }
          await context.setOffline(true);
          await page.getByRole("status").filter({ hasText: "You are offline" }).waitFor();
          await page.reload();
          assert.equal(await page.locator("h1").innerText(), `${config.name} is offline`);
          assert.deepEqual((await new AxeBuilder({ page }).analyze()).violations, []);
          if (app === "kanban") {
            await page.goto(origin);
            await page.getByText("Connect and open a board once to make it available offline.").waitFor();
          }
          assert.deepEqual(errors, []);
        } finally { await context.close(); }

        const ios = await browser.newContext({ ...devices["iPhone 13"] });
        try {
          const page = await ios.newPage();
          await page.goto(origin + entry);
          await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: 20000 });
          if (app !== "account") {
            await page.getByRole("button", { name: `Install ${config.name}`, exact: true }).click();
            await page.getByText(`Open the Share menu and choose Add to Home Screen to install ${config.name}.`, { exact: true }).waitFor();
            await page.getByRole("button", { name: "Dismiss app installation", exact: true }).click();
          } else {
            assert.equal(await page.getByRole("button", { name: `Install ${config.name}`, exact: true }).count(), 0);
          }
          await page.reload();
          assert.equal(await page.getByRole("button", { name: `Install ${config.name}`, exact: true }).count(), 0);
        } finally { await ios.close(); }
      } catch (error) {
        error.message += "\nServer output:\n" + logs;
        throw error;
      } finally {
        if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); }
      }
    });
  } finally { await browser.close(); }
});
