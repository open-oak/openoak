import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../components/kanban-app.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../app/styles/workspace.css", import.meta.url), "utf8");

test("the desktop board title owns the rename action without sizing the card around the edit icon", () => {
  assert.match(
    app,
    /<h1>[\s\S]*?className="board-title board-title-button"[\s\S]*?onClick=\{beginBoardTitleEdit\}[\s\S]*?\{activeBoard\.name\}[\s\S]*?<\/h1>[\s\S]*?className="icon-button board-title-edit-button"/,
  );
  assert.match(workspace, /\.board-title \{[^}]*width: fit-content;[^}]*min-width: 0;/s);
  assert.match(workspace, /\.board-title-button \{[^}]*cursor: pointer;/s);
});
