import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../components/kanban-app.tsx", import.meta.url), "utf8");
const background = readFileSync(
  new URL("../components/kanban/board-background.tsx", import.meta.url),
  "utf8",
);
const layout = readFileSync(new URL("../app/styles/layout.css", import.meta.url), "utf8");

test("board changes preserve the old wallpaper until the replacement is decoded", () => {
  assert.match(app, /<BoardBackground/);
  assert.doesNotMatch(app, /key=\{activeBoard\.wallpaper\}/);
  assert.match(background, /const \[committedUrl, setCommittedUrl\]/);
  assert.match(background, /image\.decode\(\)/);
  assert.match(background, /desiredUrlRef\.current !== desiredUrl/);
  assert.match(background, /const \[incomingUrl, setIncomingUrl\]/);
  assert.match(background, /onTransitionEnd=\{commitIncoming\}/);
});

test("wallpapers crossfade with opacity instead of replaying a transparent entry animation", () => {
  assert.match(layout, /\.wallpaper-layer-transition \{[^}]*transition: opacity 220ms ease;/s);
  assert.doesNotMatch(layout, /\.wallpaper-layer \{[^}]*animation:/s);
});
