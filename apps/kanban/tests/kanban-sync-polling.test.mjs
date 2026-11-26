import assert from "node:assert/strict";
import test from "node:test";
import { startKanbanSyncPolling } from "../lib/kanban-sync-polling.ts";

function setup(t, visibility = "visible") {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
  const pageWindow = Object.assign(new EventTarget(), {
    setInterval: (callback, delay) => setInterval(callback, delay),
    clearInterval: (id) => clearInterval(id),
  });
  const pageDocument = Object.assign(new EventTarget(), { visibilityState: visibility });
  let refreshes = 0;
  const stop = startKanbanSyncPolling(async () => { refreshes++; }, pageWindow, pageDocument);
  t.after(stop);
  return {
    refreshes: () => refreshes,
    tick: (ms) => {
      // Advance Date alongside interval callbacks, including across long idle periods.
      while (ms > 0) { const step = Math.min(ms, 1_000); t.mock.timers.tick(step); ms -= step; }
    },
    activity: (type = "pointerdown") => pageDocument.dispatchEvent(new Event(type)),
    focus: () => pageWindow.dispatchEvent(new Event("focus")),
    visibility: (value) => { pageDocument.visibilityState = value; pageDocument.dispatchEvent(new Event("visibilitychange")); },
    stop,
  };
}

test("active use polls every thirty seconds and input keeps the session active", (t) => {
  const page = setup(t);
  page.tick(29_999); assert.equal(page.refreshes(), 0);
  page.tick(1); assert.equal(page.refreshes(), 1);
  for (const input of ["pointerdown", "keydown", "scroll"]) {
    page.activity(input);
    page.tick(60_000);
  }
  assert.equal(page.refreshes(), 7);
});

test("two minutes of inactivity stops network refresh until input resumes", (t) => {
  const page = setup(t);
  page.tick(120_000);
  assert.equal(page.refreshes(), 3);
  page.tick(600_000);
  assert.equal(page.refreshes(), 3);
  page.activity("keydown");
  assert.equal(page.refreshes(), 4);
  page.tick(30_000);
  assert.equal(page.refreshes(), 5);
});

test("hidden tabs pause polling and returning refreshes once across visibility and focus", (t) => {
  const page = setup(t);
  page.visibility("hidden");
  page.tick(600_000);
  assert.equal(page.refreshes(), 0);
  page.visibility("visible");
  page.focus();
  assert.equal(page.refreshes(), 1);
  page.tick(30_000);
  assert.equal(page.refreshes(), 2);
});

test("a tab opened in the background waits until it becomes visible", (t) => {
  const page = setup(t, "hidden");
  page.tick(60_000);
  page.focus();
  assert.equal(page.refreshes(), 0);
  page.visibility("visible");
  assert.equal(page.refreshes(), 1);
});

test("cleanup removes scheduled polling and activity listeners", (t) => {
  const page = setup(t);
  page.stop();
  page.tick(600_000);
  page.activity(); page.focus(); page.visibility("visible");
  assert.equal(page.refreshes(), 0);
});
