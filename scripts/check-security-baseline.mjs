import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sites = [
  { directory: "websites/openoak", config: "websites/openoak/vercel.json" },
  { directory: "websites/opentodo", config: "websites/opentodo/vercel.json" },
  { directory: "websites/openkanbanboard", config: "websites/openkanbanboard/vercel.json" },
  { directory: "websites/openoutline", config: "websites/openoutline/vercel.json" },
];
const requiredHeaders = [
  "Content-Security-Policy",
  "Permissions-Policy",
  "Referrer-Policy",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
];
const printOnly = process.argv.includes("--print-hashes");

function filesBelow(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file, extension) : file.endsWith(extension) ? [file] : [];
  });
}

function visibleText(markup) {
  return markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function jsonScriptHashes(html) {
  const hashes = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1];
    if (/\bsrc\s*=/.test(attributes)) continue;
    assert.match(attributes, /type=["']application\/ld\+json["']/, "Executable inline scripts are forbidden");
    hashes.push(`'sha256-${crypto.createHash("sha256").update(match[2]).digest("base64")}'`);
  }
  return hashes;
}

const printed = [];
for (const site of sites) {
  const htmlFiles = filesBelow(path.join(root, site.directory), ".html");
  const hashes = [...new Set(htmlFiles.flatMap((file) => jsonScriptHashes(fs.readFileSync(file, "utf8"))))];
  printed.push(`${site.directory}: ${hashes.join(" ")}`);
  if (printOnly) continue;

  const config = JSON.parse(fs.readFileSync(path.join(root, site.config), "utf8"));
  assert.equal(
    config.redirects?.length || 0,
    0,
    `${site.config} must use rewrite-backed redirect handlers so security headers are retained`,
  );
  const baseline = config.headers?.find((entry) => entry.source === "/(.*)");
  assert.ok(baseline, `${site.config} must define headers for every route`);
  const configured = new Map(baseline.headers.map((entry) => [entry.key, entry.value]));
  for (const header of requiredHeaders) assert.ok(configured.has(header), `${site.config} is missing ${header}`);
  const csp = configured.get("Content-Security-Policy");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  for (const hash of hashes) assert.match(csp, new RegExp(hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, "utf8");
    for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const label = match[1].match(/aria-label=["']([^"']+)["']/i)?.[1];
      const text = visibleText(match[2]);
      if (label && text) {
        assert.ok(label.toLocaleLowerCase().includes(text.toLocaleLowerCase()), `${file}: accessible name must contain “${text}”`);
      }
    }

    let previous = 0;
    for (const match of html.matchAll(/<h([1-6])\b/gi)) {
      const level = Number(match[1]);
      if (previous) assert.ok(level <= previous + 1, `${file}: heading level skips from h${previous} to h${level}`);
      previous = level;
    }
  }
}

if (printOnly) {
  console.log(printed.join("\n"));
  process.exit(0);
}

for (const proxy of ["account", "todo", "kanban", "outline"]) {
  const source = fs.readFileSync(path.join(root, `apps/${proxy}/lib/secure-request.ts`), "utf8");
  assert.match(source, /'nonce-\$\{nonce\}'/);
  assert.match(source, /script-src-attr 'none'/);
  assert.doesNotMatch(source, /unsafe-inline.*script|script.*unsafe-inline/);
}

const todoPackage = fs.readFileSync(path.join(root, "apps/todo/package.json"), "utf8");
const todoLayout = fs.readFileSync(path.join(root, "apps/todo/app/layout.tsx"), "utf8");
assert.doesNotMatch(todoPackage, /@vercel\/analytics/);
assert.doesNotMatch(todoLayout, /@vercel\/analytics|<Analytics/);
assert.equal(
  fs.existsSync(path.join(root, "websites/opentodo/legal.html")),
  false,
  "OpenTodo legal.html must not shadow its header-preserving redirect handler",
);
const openTodoVercel = JSON.parse(
  fs.readFileSync(path.join(root, "websites/opentodo/vercel.json"), "utf8"),
);
assert.notEqual(
  openTodoVercel.cleanUrls,
  true,
  "OpenTodo cleanUrls must not intercept /legal.html before its header-preserving redirect handler",
);

console.log("Security, CSP, and static accessibility baseline checks passed.");
