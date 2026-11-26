import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../components/kanban-app.tsx", import.meta.url), "utf8");
const dialog = readFileSync(
  new URL("../components/kanban/task-detail-dialog.tsx", import.meta.url),
  "utf8",
);

test("Kanban task dialogs retain and restore their opener", () => {
  assert.match(app, /taskReturnFocusRef\.current = document\.activeElement/);
  assert.match(app, /if \(target\?\.isConnected\) target\.focus\(\)/);
  assert.match(app, /\[data-task-id=/);
  assert.match(app, /\[aria-label="Board actions"\]/);
});

test("Kanban prevents the dialog primitive from competing with app focus restoration", () => {
  assert.match(dialog, /onCloseAutoFocus=\{\(event\) => \{ event\.preventDefault\(\);/);
});
