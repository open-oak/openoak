import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apps = JSON.parse(await readFile(path.join(root, "shared/pwa/apps.json"), "utf8"));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [app, { emoji }] of Object.entries(apps)) {
    for (const [name, size, scale, opaque] of [
      ["icon-192.png", 192, .84, false],
      ["icon-512.png", 512, .84, false],
      ["icon-maskable-512.png", 512, .48, true],
      ["apple-touch-icon.png", 180, .80, true],
    ]) {
      const png = await page.evaluate(async ({ emoji, size, scale, opaque }) => {
        await document.fonts.load(`${size}px "Noto Color Emoji"`);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const context = canvas.getContext("2d");
        if (opaque) { context.fillStyle = "#f5f5f5"; context.fillRect(0, 0, size, size); }
        context.font = `${Math.round(size * scale)}px "Noto Color Emoji"`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(emoji, size / 2, size / 2);
        return canvas.toDataURL("image/png").split(",")[1];
      }, { emoji, size, scale, opaque });
      const bytes = Buffer.from(png, "base64");
      await writeFile(path.join(root, "apps", app, "public", name), bytes);
      // Existing Todo installations may still request the previous icon URLs.
      if (app === "todo") {
        const legacy = name === "apple-touch-icon.png" ? ["apple-icon-dark.png", "apple-icon-light.png"] :
          name === "icon-192.png" ? ["icon-dark-192.png", "icon-light-192.png"] :
          name === "icon-512.png" ? ["icon-dark-512.png", "icon-light-512.png"] : [];
        for (const alias of legacy) await writeFile(path.join(root, "apps", app, "public", alias), bytes);
      }
    }
  }
} finally { await browser.close(); }
console.log("Generated emoji launcher, maskable and Apple icons. Rendered with Noto Color Emoji (OFL-1.1).");
