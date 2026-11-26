import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const primitives = readFileSync(new URL("../components/kanban/primitives.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../components/kanban-app.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../app/styles/workspace.css", import.meta.url), "utf8");

test("Kanban sync and menu controls follow the Todo action-surface sizing", () => {
  assert.match(workspace, /\.sync-badge \{[^}]*height: 2\.5rem;[^}]*min-width: 5\.625rem;/s);
  assert.match(workspace, /\.sync-badge \{[^}]*border-radius: var\(--radius-xl\);/s);
  assert.match(workspace, /\.icon-button\.toolbar-icon-button \{[^}]*width: 2\.5rem;[^}]*height: 2\.5rem;[^}]*border-radius: var\(--radius-xl\);/s);
  assert.match(workspace, /\.sync-badge \{[^}]*border: 0;[^}]*background: var\(--card\);/s);
  assert.match(workspace, /\.icon-button\.toolbar-icon-button \{[^}]*background: var\(--card\);[^}]*box-shadow: none;/s);
  assert.match(primitives, /className="size-3\.5(?: sync-spinner)?"/);
  assert.doesNotMatch(app, /boardToolbar\("size-5"/);
  assert.match(app, /boardToolbar\("size-4", "desktop"\)/);
});

test("Kanban title stays centered and no taller than the header actions", () => {
  assert.match(workspace, /\.board-header \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(8\.625rem, 1fr\) minmax\(0, auto\) minmax\(8\.625rem, 1fr\);/s);
  assert.match(workspace, /\.board-title \{[^}]*height: 2\.5rem;[^}]*justify-content: center;/s);
  assert.match(workspace, /\.board-title-row \{[^}]*grid-column: 2;[^}]*justify-self: center;/s);
  assert.match(workspace, /\.board-title-row h1 \{[^}]*text-align: center;/s);
  assert.match(workspace, /\.board-title-input \{[^}]*height: 2\.25rem;[^}]*font-size: 1rem;[^}]*text-align: center;/s);
  assert.match(workspace, /\.board-actions \{[^}]*grid-column: 3;[^}]*justify-self: end;/s);
  assert.match(app, /className="board-title board-title-editing"/);
});
