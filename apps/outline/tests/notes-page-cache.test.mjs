import assert from "node:assert/strict";
import test from "node:test";
import { NotesPageCache, notesPageKey } from "../lib/notes-page-cache.ts";

const page = { items: [], totalCount: 0, nextCursor: null, folders: [], unfiledCount: 0, allNotesCount: 0 };

test("folder, global, search and paginated views never reuse another view's summaries", () => {
  const keys = [
    notesPageKey(undefined, "", undefined), notesPageKey(undefined, "", null),
    notesPageKey(undefined, "", "all"), notesPageKey(undefined, "", "research"),
    notesPageKey("next", "", "research"), notesPageKey(undefined, "text", "research"),
  ];
  assert.equal(new Set(keys).size, keys.length);
  const cache = new NotesPageCache();
  cache.write(keys[3], page);
  assert.equal(cache.read(keys[3]), page);
  for (const key of keys.filter(k => k !== keys[3])) assert.equal(cache.read(key), undefined);
});

test("summaries expire and the session cache stays bounded", () => {
  const cache = new NotesPageCache();
  cache.write("initial", page, cache.version, 0);
  assert.equal(cache.read("initial", 59_999), page);
  assert.equal(cache.read("initial", 60_000), undefined);
  for (let i = 0; i < 25; i++) cache.write(String(i), page);
  assert.equal(cache.read("0"), undefined);
  assert.equal(cache.read("24"), page);
});

test("local edits invalidate summaries and late pre-edit responses cannot repopulate them", () => {
  const cache = new NotesPageCache(), version = cache.version;
  cache.write("research", page);
  cache.invalidate();
  cache.write("research", page, version);
  assert.equal(cache.read("research"), undefined);
});

test("overlapping writes cannot cache old membership, including when a write fails", async () => {
  const cache = new NotesPageCache();
  let finish;
  const first = cache.mutate(() => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(cache.mutate(async () => { throw Error("move failed"); }));
  cache.write("research", page);
  assert.equal(cache.read("research"), undefined);
  const duringWrite = cache.version;
  finish(); await first;
  cache.write("research", page, duringWrite);
  assert.equal(cache.read("research"), undefined);
  cache.write("research", page);
  assert.equal(cache.read("research"), page);
});
