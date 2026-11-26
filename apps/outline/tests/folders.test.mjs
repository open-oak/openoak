import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { cleanFolderName, folderNameKey, MAX_FOLDER_NAME_LENGTH } from "../lib/folder-validation.ts";
import { folderMoveRemainsVisible } from "../lib/folder-view.ts";

const notesApp = readFileSync(new URL("../components/notes-app.tsx", import.meta.url), "utf8");
const notesSidebar = readFileSync(new URL("../components/notes/notes-sidebar.tsx", import.meta.url), "utf8");

test("folder names are trimmed, bounded, and compared case-insensitively", () => {
  assert.equal(cleanFolderName("  Projects  "), "Projects");
  assert.equal(cleanFolderName("x".repeat(200)).length, MAX_FOLDER_NAME_LENGTH);
  assert.equal(folderNameKey("  WORK  "), folderNameKey("work"));
  assert.equal(folderNameKey("ℌome"), folderNameKey("Home"));
});

test("folder moves keep global search and All Notes visible", () => {
  assert.equal(folderMoveRemainsVisible("needle", "source", "target"), true);
  assert.equal(folderMoveRemainsVisible("", undefined, "target"), true);
});

test("folder moves leave a scoped list only when moved into that scope", () => {
  assert.equal(folderMoveRemainsVisible("", "target", "target"), true);
  assert.equal(folderMoveRemainsVisible("", "source", "target"), false);
  assert.equal(folderMoveRemainsVisible("", null, null), true);
  assert.equal(folderMoveRemainsVisible("", null, "target"), false);
});

test("an empty selected folder shows the create prompt on the app background", () => {
  assert.match(notesApp, /const selectedFolderIsEmpty = folders\.some/);
  assert.match(notesApp, /!selectedFolderIsEmpty && "notes-panel notes-editor-panel"/);
});

test("the folder migration expands existing notes without a backfill", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20260824120000_add_note_folders/migration.sql", import.meta.url), "utf8");
  assert.match(sql, /ALTER TABLE "Note" ADD COLUMN "folderId" TEXT;/);
  assert.doesNotMatch(sql, /UPDATE "Note"/);
  assert.doesNotMatch(sql, /"folderId" TEXT NOT NULL/);
  assert.match(sql, /ON DELETE SET NULL/);
});

test("mobile folder selection keeps the sidebar open", () => {
  assert.match(notesApp, /onSelectFolder=\{handleSelectFolder\}/);
  assert.doesNotMatch(notesApp, /onSelectFolder=\{\(folderId\) => \{[^}]*requestClose/);
});

test("the sidebar only shows Unsorted Notes when it has notes and swaps the built-in icons", () => {
  assert.match(notesSidebar, /label: "All Notes"[^\n]+icon: FileText/);
  assert.match(notesSidebar, /unfiledCount > 0 && builtInFolderRow\(\{ label: "Unsorted Notes"[^\n]+icon: Files/);
});

test("custom folder hover covers the full row", () => {
  assert.match(notesSidebar, /"flex items-center rounded-2xl transition",\s*collapsed && "justify-center",\s*!active && "hover:bg-muted\/70"/);
});
