import assert from "node:assert/strict";
import test from "node:test";
import { createSaveQueue } from "../lib/note-save-queue.ts";

/** Minimal controllable clock: timers only fire when the test advances them. */
function fakeTimers() {
  let nextId = 1;
  const scheduled = new Map();

  return {
    timers: {
      set(callback, delayMs) {
        const id = nextId++;
        scheduled.set(id, { callback, at: delayMs });
        return id;
      },
      clear(id) {
        scheduled.delete(id);
      },
    },
    pending: () => scheduled.size,
    runAll() {
      const due = [...scheduled.entries()];
      scheduled.clear();
      for (const [, entry] of due) entry.callback();
    },
  };
}

function setup({ save } = {}) {
  const clock = fakeTimers();
  const saved = [];
  const queue = createSaveQueue({
    delayMs: 650,
    timers: clock.timers,
    save:
      save ??
      ((id, patch) => {
        saved.push({ id, patch });
      }),
  });
  return { clock, saved, queue };
}

test("a patch is held until the debounce fires, then sent once", () => {
  const { clock, saved, queue } = setup();

  queue.queue("a", { title: "One" });
  assert.deepEqual(saved, []);

  clock.runAll();
  assert.deepEqual(saved, [{ id: "a", patch: { title: "One" } }]);

  clock.runAll();
  assert.equal(saved.length, 1, "an empty queue must not send again");
});

test("patches for the same note merge into a single save", () => {
  const { clock, saved, queue } = setup();

  queue.queue("a", { title: "One" });
  queue.queue("a", { body: "Body" });
  queue.queue("a", { title: "Two" });
  clock.runAll();

  assert.deepEqual(saved, [{ id: "a", patch: { title: "Two", body: "Body" } }]);
});

test("each note keeps its own timer", () => {
  const { clock, saved, queue } = setup();

  queue.queue("a", { title: "A" });
  queue.queue("b", { title: "B" });
  assert.equal(clock.pending(), 2);

  clock.runAll();
  assert.deepEqual(
    saved.map((entry) => entry.id).sort(),
    ["a", "b"]
  );
});

test("cancel drops one note's pending text and leaves the others queued", () => {
  const { clock, saved, queue } = setup();

  queue.queue("a", { title: "Keep typing" });
  queue.queue("b", { title: "About to be deleted" });

  assert.equal(queue.cancel("b"), true);
  assert.equal(queue.cancel("b"), false, "cancelling twice reports nothing dropped");
  assert.equal(queue.isPending("a"), true);

  clock.runAll();
  assert.deepEqual(saved, [{ id: "a", patch: { title: "Keep typing" } }]);
});

test("flush sends one note immediately and cancels its timer", () => {
  const { clock, saved, queue } = setup();

  queue.queue("a", { body: "Now" });
  queue.flush("a");

  assert.deepEqual(saved, [{ id: "a", patch: { body: "Now" } }]);
  assert.equal(clock.pending(), 0, "the debounce timer must not fire a second save");

  clock.runAll();
  assert.equal(saved.length, 1);
});

test("flushing a note with nothing pending does nothing", () => {
  const { saved, queue } = setup();
  queue.flush("a");
  assert.deepEqual(saved, []);
});

test("flushAll sends every note that still has unsaved text", () => {
  const { saved, queue } = setup();

  queue.queue("a", { title: "A" });
  queue.queue("b", { title: "B" });
  queue.queue("c", { title: "C" });
  queue.cancel("b");
  queue.flushAll();

  assert.deepEqual(
    saved.map((entry) => entry.id).sort(),
    ["a", "c"]
  );
  assert.deepEqual(queue.pendingIds(), []);
});

test("isBusy covers both queued and in-flight saves", async () => {
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const { queue } = setup({ save: () => blocked });

  assert.equal(queue.isBusy(), false);

  queue.queue("a", { title: "A" });
  assert.equal(queue.isBusy(), true, "queued but not sent");

  queue.flush("a");
  assert.equal(queue.isBusy(), true, "sent but not acknowledged");

  release();
  await blocked;
  await Promise.resolve();
  assert.equal(queue.isBusy(), false);
});

test("a failing save does not stall the queue", async () => {
  const { queue } = setup({ save: () => Promise.reject(new Error("offline")) });

  queue.queue("a", { title: "A" });
  queue.flush("a");
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(queue.isBusy(), false);
});

test("cancelAll clears everything without sending", () => {
  const { clock, saved, queue } = setup();

  queue.queue("a", { title: "A" });
  queue.queue("b", { title: "B" });
  queue.cancelAll();

  assert.deepEqual(queue.pendingIds(), []);
  clock.runAll();
  assert.deepEqual(saved, []);
});
