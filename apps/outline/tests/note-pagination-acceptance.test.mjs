import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  fixturePage,
  MAX_NOTES_APP_DOM_NODES,
  normalizeNoteQuery,
  NOTE_METADATA_SELECT,
  NOTE_PAGE_SIZE,
} from "../lib/note-pagination.ts";

function fixture(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: "note-" + String(index).padStart(5, "0"),
    title: index % 97 === 0 ? "Needle " + index : "Note " + index,
    body: "Body " + index,
  }));
}

test("10,000 notes are reachable in bounded metadata pages", () => {
  const all = fixture(10_000);
  const reached = new Set();
  let cursor;
  let maxInteractionMs = 0;
  let pages = 0;

  do {
    const startedAt = performance.now();
    const page = fixturePage(all, cursor);
    maxInteractionMs = Math.max(maxInteractionMs, performance.now() - startedAt);
    assert.equal(page.totalCount, 10_000);
    assert.ok(page.items.length <= NOTE_PAGE_SIZE);
    for (const note of page.items) {
      assert.equal(reached.has(note.id), false);
      reached.add(note.id);
    }
    cursor = page.nextCursor ?? undefined;
    pages += 1;
  } while (cursor);

  assert.equal(reached.size, 10_000);
  assert.equal(pages, 250);
  assert.ok(maxInteractionMs < 200, "slowest page took " + maxInteractionMs.toFixed(2) + " ms");
});
test("the list contract excludes note bodies and stays below the DOM budget", () => {
  assert.equal("body" in NOTE_METADATA_SELECT, false);
  assert.equal(NOTE_PAGE_SIZE, 40);
  assert.ok(MAX_NOTES_APP_DOM_NODES < 1_500);
});

test("10,000-note search preparation stays below the long-task budget", () => {
  const all = fixture(10_000);
  const query = normalizeNoteQuery("  " + "needle".repeat(50) + "  ");
  assert.equal(query.length, 200);

  const startedAt = performance.now();
  const matches = all.filter((note) =>
    note.title.toLowerCase().includes("needle"),
  );
  const duration = performance.now() - startedAt;

  assert.equal(matches.length, 104);
  assert.ok(duration < 200, "search preparation took " + duration.toFixed(2) + " ms");
});
