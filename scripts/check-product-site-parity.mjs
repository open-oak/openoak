import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pairs = [
  {
    name: "OpenTodo",
    standalone: "websites/opentodo",
    embedded: "websites/openoak/todo",
    route: "todo",
  },
  {
    name: "OpenKanban",
    standalone: "websites/openkanbanboard",
    embedded: "websites/openoak/kanban",
    route: "kanban",
  },
  {
    name: "OpenOutline",
    standalone: "websites/openoutline",
    embedded: "websites/openoak/outline",
    route: "outline",
  },
];

const read = (directory, file) => fs.readFileSync(path.join(root, directory, file), "utf8");

const productUrls = [
  {
    placeholder: "{{TODO_URL}}/",
    urls: [
      "https://opentodo.org/",
      "https://www.opentodo.org/",
      "https://openoak.org/todo/",
      "https://www.openoak.org/todo/",
    ],
  },
  {
    placeholder: "{{KANBAN_URL}}/",
    urls: [
      "https://openkanbanboard.org/",
      "https://www.openkanbanboard.org/",
      "https://openoak.org/kanban/",
      "https://www.openoak.org/kanban/",
    ],
  },
  {
    placeholder: "{{OUTLINE_URL}}/",
    urls: [
      "https://openoutline.org/",
      "https://www.openoutline.org/",
      "https://openoak.org/outline/",
      "https://www.openoak.org/outline/",
    ],
  },
];

function normalize(text, pair) {
  let normalized = text;
  for (const product of productUrls) {
    for (const url of product.urls) normalized = normalized.replaceAll(url, product.placeholder);
  }

  return normalized
    .replaceAll(`/${pair.route}/`, "/")
    .replace(/([="'(])\/(?=(?:public\/|style\.css|main\.js|site\.webmanifest|favicon|apple-touch-icon))/g, "$1")
    .replace(/(,\s+)\/(?=public\/)/g, "$1")
    .replace(/`\/(?=public\/)/g, "`")
    .replace(/\s+/g, " ")
    .trim();
}

for (const pair of pairs) {
  for (const file of ["index.html", "main.js", "style.css", "site.webmanifest"]) {
    assert.equal(
      normalize(read(pair.standalone, file), pair),
      normalize(read(pair.embedded, file), pair),
      `${pair.name} ${file} differs between its standalone and OpenOak-hosted versions`,
    );
  }

  const standaloneHtml = read(pair.standalone, "index.html");
  const embeddedHtml = read(pair.embedded, "index.html");
  for (const html of [standaloneHtml, embeddedHtml]) {
    assert.doesNotMatch(html, />View source</, `${pair.name} still exposes a View source footer button`);
    assert.equal((html.match(/class="footer-action"/g) || []).length, 2, `${pair.name} must have two footer buttons`);

    if (pair.name === "OpenOutline") {
      assert.doesNotMatch(
        html,
        /class="[^"]*feature-summary[^"]*\breveal\b[^"]*"/,
        "OpenOutline feature summary must not animate into view",
      );
    }
  }
  for (const css of [read(pair.standalone, "style.css"), read(pair.embedded, "style.css")]) {
    assert.match(css, /\.footer-action\s*\{[^}]*color:\s*#fff;/s, `${pair.name} footer button text must be white`);
    assert.match(css, /\.footer-action:focus-visible\s*\{[^}]*color:\s*#fff;/s, `${pair.name} footer focus text must stay white`);
    assert.match(
      css,
      /@media \(max-width: 860px\)[\s\S]*?\.footer-actions\s*\{[^}]*backdrop-filter:\s*none;/,
      `${pair.name} mobile footer buttons must not use backdrop blur`,
    );

    if (pair.name === "OpenOutline") {
      assert.doesNotMatch(
        css,
        /\.nav-brand span\s*\{[^}]*text-overflow:\s*ellipsis;/,
        "OpenOutline must not truncate its mobile header brand",
      );
    }
  }
}

const openOakHtml = read("websites/openoak", "index.html");
const openOakCss = read("websites/openoak", "styles.css");
const legalHtml = read("websites/openoak/legal", "index.html");
const openOakVercel = JSON.parse(read("websites/openoak", "vercel.json"));
const outlineNextConfig = read("apps/outline", "next.config.ts");

for (const site of ["websites/openoak", ...pairs.map(({ standalone }) => standalone)]) {
  const html = read(site, "index.html");
  const sitemap = read(site, "sitemap.xml");
  const canonical = html.match(/<link rel="canonical" href="([^"]+)">/)?.[1];
  assert.ok(canonical, `${site} homepage must declare a canonical URL`);
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => new URL(url));
  assert.ok(locations.some(({ href }) => href === canonical), `${site} sitemap must list its canonical homepage`);
  for (const location of locations) {
    assert.equal(location.origin, new URL(canonical).origin, `${site} sitemap must use its canonical host`);
    if (site === "websites/openoak") {
      const isMcpRedirect = openOakVercel.rewrites.some(({ source, destination }) =>
        source === location.pathname && destination === "/api/mcp-redirect");
      assert.ok(!isMcpRedirect, `OpenOak sitemap must omit the MCP redirect ${location.pathname}`);
    }
  }
  assert.ok(read(site, "robots.txt").includes(`Sitemap: ${new URL("sitemap.xml", canonical)}`));
}

assert.doesNotMatch(openOakHtml, />View source</, "OpenOak still exposes a View source footer button");
assert.equal((openOakHtml.match(/class="footer-action"/g) || []).length, 2, "OpenOak must have two footer buttons");
assert.match(openOakCss, /\.footer-action\s*\{[^}]*color:\s*#fff;/s, "OpenOak footer button text must be white");
assert.match(openOakCss, /\.footer-action:focus-visible\s*\{[^}]*color:\s*#fff;/s, "OpenOak footer focus text must stay white");
assert.match(
  openOakCss,
  /\.app-grid\s*\{[^}]*overflow:\s*hidden;[^}]*border-radius:\s*20px;/s,
  "OpenOak product cards must share one rounded outer frame",
);
assert.match(openOakCss, /\.app-card\s*\{[^}]*border-radius:\s*0;/s, "OpenOak cards must keep their inner corners square");
assert.match(
  openOakCss,
  /@media \(max-width: 820px\)[\s\S]*?\.footer-actions\s*\{[^}]*backdrop-filter:\s*none;/,
  "OpenOak mobile footer buttons must not use backdrop blur",
);
assert.doesNotMatch(legalHtml, /id="(?:privacy|terms)"/, "Top-level legal hashes must not trigger native scrolling");
assert.doesNotMatch(openOakHtml, /(?:openoak\.org\/notes|href="notes\/)/, "OpenOak must use Outline as the public product route");
assert.deepEqual(
  openOakVercel.rewrites.filter(({ source }) => source.startsWith("/notes")),
  [
    { source: "/notes", destination: "/api/notes-redirect" },
    { source: "/notes/", destination: "/api/notes-redirect" },
    { source: "/notes/:path*", destination: "/api/notes-redirect?redirectPath=:path*" },
  ],
  "The legacy Notes marketing route must use the header-preserving Outline redirect handler",
);
assert.match(
  outlineNextConfig,
  /value:\s*"notes\.openoak\.org"[\s\S]*?destination:\s*"https:\/\/outline\.openoak\.org\/:path\*"/,
  "The legacy Notes app domain must permanently redirect to Outline",
);
assert.match(legalHtml, /Last updated November 20, 2026/, "OpenOak legal copy must show its current revision date");
assert.match(legalHtml, /OpenOutline stores the outlines/, "Privacy Policy must cover live OpenOutline data");
assert.match(legalHtml, /OpenKanban stores the boards/, "Privacy Policy must cover live OpenKanban data");
assert.doesNotMatch(legalHtml, /Open(?:Outline|Kanban)[\s\S]{0,80}\bplanned\b/i, "Live apps must not be described as planned");
for (const infrastructureTerm of ["Vercel", "Neon", "Resend", "Proton", "Google Fonts", "Frankfurt", "fra1", "eu-central-1"]) {
  assert.match(legalHtml, new RegExp(infrastructureTerm), `Legal copy must identify ${infrastructureTerm}`);
}

for (const configPath of [
  "apps/account/vercel.json",
  "apps/todo/vercel.json",
  "apps/kanban/vercel.json",
  "apps/outline/vercel.json",
]) {
  const config = JSON.parse(read(".", configPath));
  assert.deepEqual(config.regions, ["fra1"], `${configPath} must keep server compute in Frankfurt`);
}

console.log("Product website parity checks passed.");
