import assert from "node:assert/strict";
import test from "node:test";
import { prepareLegacyDocument, migrationDigest } from "../lib/kanban-migration.ts";
import { cleanBoards, starterBoards } from "../lib/kanban-data.ts";

test("canonical records preserve blank drafts, long text, Unicode, appearance and selection", () => {
  const boards = structuredClone(starterBoards);
  boards[0].tasks[0].title = "";
  boards[0].tasks[0].description = "🌳\n".repeat(20000);
  boards[0].theme = "green";
  boards[0].wallpaper = "10";
  boards[0].wallpaperBlur = true;
  const result = prepareLegacyDocument({ boards, activeBoardId: "main", revision: 3 });
  assert.deepEqual(result.document, { boards, activeBoardId: "main" });
  assert.deepEqual(result.repairs, []);
});

test("legacy normalization records repairs and dropped fields, retaining source unmodified", () => {
  const source = { boards: [{ id: "main", name: " Old ", cards: [{ id: "1", title: " Title ", column: "doing" }, null], extension: "keep in raw snapshot" }], activeBoardId: "missing", revision: 1 };
  const before = structuredClone(source);
  const result = prepareLegacyDocument(source);
  assert.deepEqual(result.document.boards, cleanBoards(source.boards));
  assert.equal(result.document.activeBoardId, "main");
  assert.ok(result.repairs.some((repair) => repair.path.includes("cards") && repair.kind === "removed"));
  assert.ok(result.repairs.some((repair) => repair.path.includes("extension")));
  assert.deepEqual(source, before);
});

test("duplicates fail within identity scope; repeated list/card IDs across boards are valid", () => {
  for (const scope of ["board", "list", "task", "legacy card"]) {
    const boards = structuredClone(starterBoards);
    if (scope === "board") boards.push(structuredClone(boards[0]));
    if (scope === "list") boards[0].lists.push(structuredClone(boards[0].lists[0]));
    if (scope === "task") boards[0].tasks.push(structuredClone(boards[0].tasks[0]));
    if (scope === "legacy card") boards[0].cards = [{ id: "x" }, { id: "x" }];
    assert.throws(() => prepareLegacyDocument({ boards, activeBoardId: "main", revision: 1 }), /Ambiguous duplicate/, scope);
  }
  const boards = structuredClone(starterBoards);
  boards.push({ ...structuredClone(boards[0]), id: "second" });
  assert.equal(prepareLegacyDocument({ boards, activeBoardId: "second", revision: 1 }).document.boards.length, 2);
});

test("missing/empty accounts preserve starter behavior and digest ignores JSON object key order", () => {
  assert.deepEqual(prepareLegacyDocument(null).document.boards, starterBoards);
  assert.deepEqual(prepareLegacyDocument({ boards: [], activeBoardId: "", revision: 1 }).document.boards, starterBoards);
  assert.equal(migrationDigest({ a: 1, b: 2 }), migrationDigest({ b: 2, a: 1 }));
  assert.notEqual(migrationDigest({ a: [1, 2] }), migrationDigest({ a: [2, 1] }));
});
