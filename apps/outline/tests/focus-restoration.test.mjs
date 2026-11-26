import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../components/notes-app.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/notes/editor.tsx", import.meta.url), "utf8");
const desktopActions = readFileSync(new URL("../components/notes/desktop-note-actions.tsx", import.meta.url), "utf8");

test("desktop note actions hand off together when the floating controls reach the editor", () => {
  assert.match(app, /floatingActionsRef/);
  assert.match(app, /floatingRect\.left < panelRect\.right \+ 8/);
  assert.match(app, /desktopActionsInside=\{actionsInside\}/);
  assert.match(editor, /desktopActionsInside\s*&&\s*\(\s*<DesktopNoteActions/);
});

test("desktop save status and note menu use the same corner radius", () => {
  assert.match(desktopActions, /notes-action-surface inline-flex h-10 min-w-\[5\.625rem\][^\n]+rounded-xl/);
  assert.match(desktopActions, /triggerClassName="notes-action-surface h-10 w-10 shrink-0 rounded-xl/);
});

test("Outline remembers the trigger before every menu, dialog, and mobile overlay", () => {
  assert.match(app, /overlayReturnFocusRef\.current = document\.activeElement/);
  assert.match(app, /onOpenSidebar=\{\(\) => \{ rememberOverlayTrigger\(\)/);
  assert.match(app, /const handleOpenAppearance = useCallback\(\(anchor[^]*?rememberOverlayTrigger\(\)/);
  assert.match(app, /onOpenAppearance=\{handleOpenAppearance\}/);
  assert.match(app, /onOpenSettings=\{\(\) => \{ rememberOverlayTrigger\(\)/);
  assert.match(app, /onDeleteRequest=\{\(note\) => \{ rememberOverlayTrigger\(\)/);
});

test("Outline restores focus for every close path with a mobile-navigation fallback", () => {
  assert.match(app, /if \(target\?\.isConnected\) target\.focus\(\)/);
  assert.match(app, /\[aria-label="Open OpenOutline navigation"\]/);
  assert.match(app, /onClose=\{\(\) => \{ setSettingsOpen\(false\); restoreOverlayTrigger\(\); \}\}/);
  assert.match(app, /if \(!open\) restoreOverlayTrigger\(\)/);
  assert.match(app, /onCancel=\{\(\) => \{ setDeleteTarget\(null\); restoreOverlayTrigger\(\); \}\}/);
  assert.match(app, /onConfirm=\{\(\) => \{ handleDelete\(deleteTarget\); restoreOverlayTrigger\(\); \}\}/);
});
