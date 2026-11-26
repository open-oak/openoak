import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createManifest } from "../shared/pwa/metadata.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apps = JSON.parse(await readFile(path.join(root, "shared/pwa/apps.json"), "utf8"));
const contentTypes = { ".html": "text/html", ".css": "text/css", ".png": "image/png", ".js": "application/javascript" };
const policy = "default-src 'self'; script-src 'self' 'nonce-pwa-test' 'strict-dynamic'; style-src-elem 'self'; img-src 'self'; worker-src 'self'; manifest-src 'self'; connect-src 'self'";

test("generated PWA resources are current and manifests reference correctly sized icons", async () => {
  execFileSync(process.execPath, [path.join(root, "scripts/generate-pwa.mjs"), "--check"]);
  for (const app of Object.keys(apps)) {
    const manifest = createManifest(app);
    assert.equal(manifest.id, "/");
    assert.equal(manifest.scope, "/");
    assert.equal(manifest.start_url, "/");
    assert.equal(manifest.display, "standalone");
    for (const icon of [...manifest.icons, { src: "/apple-touch-icon.png", sizes: "180x180" }]) {
      const bytes = await readFile(path.join(root, "apps", app, "public", icon.src));
      const [width, height] = icon.sizes.split("x").map(Number);
      assert.equal(bytes.toString("hex", 0, 8), "89504e470d0a1a0a");
      assert.equal(bytes.readUInt32BE(16), width);
      assert.equal(bytes.readUInt32BE(20), height);
    }
    assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  }
});

async function fixture(app) {
  const config = apps[app];
  const directory = path.join(root, "apps", app, "public");
  let revision = 1;
  const server = http.createServer(async (request, response) => {
    try {
      const { pathname } = new URL(request.url, "http://localhost");
      response.setHeader("Content-Security-Policy", policy);
      response.setHeader("Cache-Control", "no-store");
      if (pathname === "/manifest.webmanifest") {
        response.writeHead(200, { "Content-Type": "application/manifest+json" }).end(JSON.stringify(createManifest(app)));
      } else if (pathname === "/" || pathname === "/private-page") {
        response.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><html lang="en"><head><title>PWA test</title><link rel="manifest" href="/manifest.webmanifest"></head><body><h1>Private online page</h1><textarea aria-label="Draft"></textarea><script nonce="pwa-test">navigator.serviceWorker.register(${JSON.stringify(config.worker)}, {updateViaCache:'none'});</script></body></html>`);
      } else if (pathname === "/offline" && app === "kanban") {
        response.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><html lang="en"><head><title>Saved boards</title></head><body><h1>Saved board shell</h1><script nonce="pwa-test" src="/_next/static/board.js?dpl=release"></script></body></html>');
      } else if (pathname.startsWith("/api/")) {
        response.writeHead(200, { "Content-Type": "application/json" }).end('{"private":"account-data"}');
      } else if (pathname.startsWith("/_next/static/")) {
        response.writeHead(200, { "Content-Type": "application/javascript" }).end("/* immutable asset */");
      } else if (pathname === config.worker) {
        let worker = await readFile(path.join(directory, config.worker), "utf8");
        if (revision > 1) worker = worker.replace(/"version":"[^"]+"/, '"version":"test-update"');
        response.writeHead(200, { "Content-Type": "application/javascript" }).end(worker);
      } else if (/^\/(offline\.(html|css)|icon-[a-z0-9-]+\.png|apple-touch-icon\.png)$/.test(pathname)) {
        const content = await readFile(path.join(directory, pathname));
        response.writeHead(200, { "Content-Type": contentTypes[path.extname(pathname)] }).end(content);
      } else response.writeHead(404).end();
    } catch (error) { response.writeHead(500).end(String(error)); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    update: () => { revision++; },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

test("all app workers support installation, safe offline navigation and waiting updates", { timeout: 120000 }, async (t) => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const app of Object.keys(apps)) await t.test(app, async () => {
      const server = await fixture(app);
      const context = await browser.newContext();
      try {
        let page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(server.origin);
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        const cdp = await context.newCDPSession(page);
        const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
        assert.deepEqual(installabilityErrors, [], app + " meets Chromium installability criteria");
        const maskableSafe = await page.evaluate(async () => {
          const image = new Image(); image.src = "/icon-maskable-512.png"; await image.decode();
          const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
          const drawing = canvas.getContext("2d"); drawing.drawImage(image, 0, 0);
          const pixels = drawing.getImageData(0, 0, 512, 512).data;
          for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
            if (Math.hypot(x - 256, y - 256) <= 512 * .4) continue;
            const index = (y * 512 + x) * 4;
            if (pixels[index] !== 245 || pixels[index + 1] !== 245 || pixels[index + 2] !== 245 || pixels[index + 3] !== 255) return false;
          }
          return true;
        });
        assert.equal(maskableSafe, true, "Maskable emoji fits inside the central safe circle");
        if (app === "todo") {
          await page.evaluate(async () => {
            for (let index = 0; index < 105; index++) await fetch(`/_next/static/asset-${index}.js`);
          });
          const count = await page.evaluate(async () => {
            const name = (await caches.keys()).find((key) => key.endsWith("-assets"));
            return (await (await caches.open(name)).keys()).length;
          });
          assert.ok(count <= 96, "Runtime assets stay bounded");
          const worker = context.serviceWorkers()[0];
          await worker.evaluate(() => {
            self.originalCacheOpen = caches.open.bind(caches);
            caches.open = async () => { throw new Error("Device storage unavailable"); };
          });
          try {
            assert.equal(await page.evaluate(async () => (await fetch("/_next/static/storage-failure.js")).status), 200);
          } finally {
            await worker.evaluate(() => { caches.open = self.originalCacheOpen; });
          }
        }
        await page.evaluate(async () => {
          await fetch("/api/private");
          await fetch("/api/save", { method: "POST", body: "private mutation" });
        });
        await page.goto(server.origin + "/private-page");
        const cachePaths = await page.evaluate(async () => {
          const paths = [];
          for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) paths.push(new URL(request.url).pathname);
          return paths;
        });
        assert.ok(!cachePaths.includes("/private-page"));
        assert.ok(!cachePaths.includes("/"));
        assert.ok(!cachePaths.some((pathname) => pathname.startsWith("/api/")));

        await context.setOffline(true);
        const offline = await page.reload();
        assert.equal(offline.status(), 200);
        assert.equal(offline.fromServiceWorker(), true);
        assert.match(await page.locator("h1").innerText(), /is offline/);
        assert.equal(await page.locator("body").evaluate((element) => getComputedStyle(element).display), "grid");
        if (app === "kanban") {
          await page.goto(server.origin + "/?board=saved");
          assert.equal(await page.locator("h1").innerText(), "Saved board shell");
          assert.equal(await page.evaluate(async () => (await fetch("/_next/static/board.js?dpl=release")).status), 200);
        }

        await context.setOffline(false);
        await page.goto(server.origin);
        await page.getByRole("textbox", { name: "Draft" }).fill("Keep this unsaved draft");
        await page.evaluate(async () => {
          await caches.open("unrelated-cache");
          await caches.open("open-todo-legacy-private-html");
        });
        server.update();
        await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
        await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
        assert.equal(await page.getByRole("textbox", { name: "Draft" }).inputValue(), "Keep this unsaved draft");
        assert.ok((await page.evaluate(() => caches.keys())).some((key) => key.startsWith(`openoak-${app}-pwa-`) && !key.includes("test-update")));
        await page.close();
        page = await context.newPage();
        await page.goto(server.origin);
        await page.waitForFunction(async () => {
          const keys = await caches.keys();
          return keys.some((key) => key.endsWith("test-update")) && keys.filter((key) => key.startsWith("openoak-")).every((key) => key.includes("test-update"));
        });
        const keys = await page.evaluate(() => caches.keys());
        assert.ok(keys.includes("unrelated-cache"), "Other caches remain intact");
        if (app === "todo") assert.ok(!keys.includes("open-todo-legacy-private-html"));
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
        await server.close();
      }
    });
  } finally { await browser.close(); }
});
