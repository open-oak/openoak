import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const sites = ["websites/openoak", "websites/opentodo", "websites/openkanbanboard", "websites/openoutline"];
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function serve(directory) {
  const siteRoot = path.resolve(directory);
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const requested = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    const file = path.resolve(siteRoot, `.${requested}`);
    if (!file.startsWith(`${siteRoot}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.setHeader("Content-Type", contentTypes.get(path.extname(file)) || "application/octet-stream");
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("canonical marketing pages preserve visible labels and heading order", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const site of sites) {
      const server = await serve(site);
      try {
        const address = server.address();
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded" });
        const results = await new AxeBuilder({ page })
          .withRules(["label-content-name-mismatch", "heading-order"])
          .analyze();
        assert.deepEqual(
          results.violations.map((violation) => violation.id),
          [],
          `${site} has focused accessibility violations`,
        );
        await context.close();
      } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    }
  } finally {
    await browser.close();
  }
});
