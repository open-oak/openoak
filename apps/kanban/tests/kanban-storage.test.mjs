import assert from "node:assert/strict";
import test from "node:test";
import {
  readJsonStorage,
  readStorageChoice,
  readStorageValue,
  writeStorageValue,
} from "../lib/kanban-storage.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("readJsonStorage returns parsed data", () => {
  const storage = memoryStorage({ boards: '[{"id":"main"}]' });
  assert.deepEqual(readJsonStorage(storage, "boards"), [{ id: "main" }]);
});

test("readJsonStorage recovers from malformed JSON", () => {
  const storage = memoryStorage({ boards: "{broken" });
  assert.equal(readJsonStorage(storage, "boards"), null);
});

test("storage reads recover when browser storage is unavailable", () => {
  const storage = {
    getItem() {
      throw new Error("Storage access denied");
    },
  };
  assert.equal(readStorageValue(storage, "boards"), null);
  assert.equal(readJsonStorage(storage, "boards"), null);
});

test("readStorageChoice rejects unsupported saved values", () => {
  const storage = memoryStorage({ theme: "purple", mode: "dark" });
  assert.equal(readStorageChoice(storage, "theme", ["blue", "green"], "blue"), "blue");
  assert.equal(readStorageChoice(storage, "mode", ["light", "dark"], "light"), "dark");
});

test("storage writes report failures without throwing", () => {
  const storage = {
    setItem() {
      throw new Error("Storage quota exceeded");
    },
  };
  assert.equal(writeStorageValue(storage, "boards", "[]"), false);
  assert.equal(writeStorageValue(null, "boards", "[]"), false);
});
