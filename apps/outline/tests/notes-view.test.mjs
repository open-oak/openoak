import assert from "node:assert/strict";
import test from "node:test";
import {
  displayTitle,
  dropEdgeFor,
  filterNotes,
  isTempNote,
  mergeServerNote,
  moveNoteAmongVisible,
  moveNoteByOffset,
  moveNoteToTarget,
  noteExcerpt,
  sortNotes,
  withSequentialOrder,
  wordCount,
} from "../lib/notes-view.ts";

function note(id, overrides = {}) {
  return {
    id,
    title: id.toUpperCase(),
    body: "",
    excerpt: "",
    color: "green",
    sortOrder: 0,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

function notes() {
  return [
    note("a", { sortOrder: 0 }),
    note("b", { sortOrder: 1 }),
    note("c", { sortOrder: 2 }),
  ];
}

const ids = (list) => list.map((item) => item.id);

test("sortNotes orders by sortOrder and breaks ties by creation time", () => {
  const sorted = sortNotes([
    note("late", { sortOrder: 1, createdAt: "2026-07-02T10:00:00.000Z" }),
    note("early", { sortOrder: 1, createdAt: "2026-07-01T10:00:00.000Z" }),
    note("first", { sortOrder: 0 }),
  ]);

  assert.deepEqual(ids(sorted), ["first", "early", "late"]);
});

test("displayTitle falls back for blank titles", () => {
  assert.equal(displayTitle({ title: "  Plans " }), "Plans");
  assert.equal(displayTitle({ title: "   " }), "Untitled note");
});

test("noteExcerpt collapses whitespace and truncates long bodies", () => {
  assert.equal(noteExcerpt(note("a", { body: "  one\n\n two  " })), "one two");
  assert.equal(noteExcerpt(note("a", { body: "" })), "No note text yet");
  const long = noteExcerpt(note("a", { body: "x".repeat(200) }));
  assert.equal(long.length, 91);
  assert.ok(long.endsWith("..."));
});

test("noteExcerpt does not require an unloaded metadata body", () => {
  assert.equal(noteExcerpt(note("a", { body: null, excerpt: "First few words" })), "First few words");
  assert.equal(noteExcerpt(note("a", { body: null, excerpt: "" })), "No note text yet");
});

test("wordCount ignores surrounding and repeated whitespace", () => {
  assert.equal(wordCount("  two  words \n"), 2);
  assert.equal(wordCount("   "), 0);
});

test("isTempNote recognises optimistic ids", () => {
  assert.equal(isTempNote("temp-123"), true);
  assert.equal(isTempNote("clx123"), false);
});

test("filterNotes matches title and body, and returns everything for a blank query", () => {
  const list = [note("a", { title: "Groceries" }), note("b", { title: "Trip", body: "buy milk" })];
  assert.deepEqual(ids(filterNotes(list, "milk")), ["b"]);
  assert.deepEqual(ids(filterNotes(list, "GROC")), ["a"]);
  assert.equal(filterNotes(list, "   "), list);
});

test("moveNoteByOffset moves one slot and renumbers", () => {
  const moved = moveNoteByOffset(notes(), "c", -1);
  assert.deepEqual(ids(moved), ["a", "c", "b"]);
  assert.deepEqual(
    moved.map((item) => item.sortOrder),
    [0, 1, 2]
  );
});

test("moveNoteByOffset returns the same array at the ends", () => {
  const start = notes();
  assert.equal(moveNoteByOffset(start, "a", -1), start);
  assert.equal(moveNoteByOffset(start, "c", 1), start);
  assert.equal(moveNoteByOffset(start, "missing", 1), start);
});

test("moveNoteAmongVisible moves past the neighbour the user can see", () => {
  const all = [note("a", { sortOrder: 0 }), note("hidden", { sortOrder: 1 }), note("c", { sortOrder: 2 })];
  const visible = [all[0], all[2]];

  // Without the visible list this would swap a and hidden, leaving the
  // filtered view looking unchanged.
  assert.deepEqual(ids(moveNoteAmongVisible(all, visible, "a", 1)), ["hidden", "c", "a"]);
  assert.deepEqual(ids(moveNoteAmongVisible(all, visible, "c", -1)), ["c", "a", "hidden"]);
});

test("moveNoteAmongVisible stops at the ends of the visible list", () => {
  const all = [note("a"), note("hidden"), note("c")];
  const visible = [all[0], all[2]];

  assert.equal(moveNoteAmongVisible(all, visible, "a", -1), all);
  assert.equal(moveNoteAmongVisible(all, visible, "c", 1), all);
  assert.equal(moveNoteAmongVisible(all, visible, "hidden", 1), all, "a filtered-out note has no visible neighbour");
});

test("moveNoteAmongVisible matches a plain move when nothing is filtered", () => {
  const all = notes();
  assert.deepEqual(ids(moveNoteAmongVisible(all, all, "a", 1)), ids(moveNoteByOffset(all, "a", 1)));
});

test("moveNoteToTarget places the dragged note at the target position", () => {
  assert.deepEqual(ids(moveNoteToTarget(notes(), "a", "c")), ["b", "c", "a"]);
  assert.deepEqual(ids(moveNoteToTarget(notes(), "c", "a")), ["c", "a", "b"]);
});

test("dropEdgeFor marks the edge the dragged note will land on", () => {
  const list = notes();
  // Dragging downwards lands after the target; upwards lands before it.
  assert.equal(dropEdgeFor(list, "a", "c"), "after");
  assert.equal(dropEdgeFor(list, "c", "a"), "before");
});

test("dropEdgeFor reports no edge for itself or an unknown note", () => {
  const list = notes();
  assert.equal(dropEdgeFor(list, "a", "a"), null);
  assert.equal(dropEdgeFor(list, "a", "missing"), null);
  assert.equal(dropEdgeFor(list, "missing", "a"), null);
});

test("the drop edge agrees with where the note actually lands", () => {
  const list = notes();
  // "after c" means a sits directly after c once the move is applied.
  assert.equal(dropEdgeFor(list, "a", "c"), "after");
  const moved = moveNoteToTarget(list, "a", "c");
  assert.deepEqual(ids(moved), ["b", "c", "a"]);
});

test("moveNoteToTarget ignores a drop on itself or an unknown note", () => {
  const start = notes();
  assert.equal(moveNoteToTarget(start, "a", "a"), start);
  assert.equal(moveNoteToTarget(start, "a", "missing"), start);
});

test("withSequentialOrder only rewrites notes whose position changed", () => {
  const start = notes();
  const result = withSequentialOrder([start[1], start[0], start[2]]);
  assert.deepEqual(
    result.map((item) => [item.id, item.sortOrder]),
    [
      ["b", 0],
      ["a", 1],
      ["c", 2],
    ]
  );
  assert.equal(result[2], start[2]);
});

test("mergeServerNote keeps edits made while the save was in flight", () => {
  const local = note("a", { title: "Typed later", body: "kept", sortOrder: 3 });
  const server = note("a", { title: "Sent earlier", body: "server body", sortOrder: 5, updatedAt: "2026-07-02T09:00:00.000Z" });

  const merged = mergeServerNote(local, server, { title: "Sent earlier", body: "kept" });

  assert.equal(merged.title, "Typed later", "a title edited after the save must survive");
  assert.equal(merged.body, "server body", "an unedited field takes the server value");
  assert.equal(merged.sortOrder, 5);
  assert.equal(merged.updatedAt, "2026-07-02T09:00:00.000Z");
});

test("mergeServerNote leaves fields the save never touched alone", () => {
  const local = note("a", { color: "coral" });
  const server = note("a", { color: "green" });
  assert.equal(mergeServerNote(local, server, { title: "x" }).color, "coral");
});
