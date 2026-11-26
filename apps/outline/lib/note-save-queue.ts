/**
 * Debounced per-note save queue.
 *
 * Saves are keyed by note id so work on one note never cancels work on
 * another: deleting a note drops only its own pending patch, and flushing on
 * tab hide sends every note that still has unsaved text. Timers are injected so
 * the scheduling rules can be tested without waiting on real time.
 */

export type TimerHandle = ReturnType<typeof setTimeout>;

export type Timers = {
  set: (callback: () => void, delayMs: number) => TimerHandle;
  clear: (handle: TimerHandle) => void;
};

const realTimers: Timers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle),
};

export type SaveQueue<Patch extends object> = {
  /** Merge a patch for `id` and (re)start its debounce window. */
  queue: (id: string, patch: Patch) => void;
  /** Send `id` now, if it has anything pending. */
  flush: (id: string) => void;
  /** Send every note that has anything pending. */
  flushAll: () => void;
  /** Drop `id`'s pending patch without sending it. Returns true if one existed. */
  cancel: (id: string) => boolean;
  /** Drop everything pending. In-flight saves are already gone and keep running. */
  cancelAll: () => void;
  isPending: (id: string) => boolean;
  pendingIds: () => string[];
  /** True while anything is waiting to be sent or still in flight. */
  isBusy: () => boolean;
};

export function createSaveQueue<Patch extends object>({
  delayMs,
  save,
  timers = realTimers,
}: {
  delayMs: number;
  /** Performs the save. Must handle its own errors; a rejection is ignored. */
  save: (id: string, patch: Patch) => void | Promise<void>;
  timers?: Timers;
}): SaveQueue<Patch> {
  const pending = new Map<string, Patch>();
  const handles = new Map<string, TimerHandle>();
  const inFlight = new Set<string>();

  function clearTimer(id: string) {
    const handle = handles.get(id);
    if (handle === undefined) return;
    timers.clear(handle);
    handles.delete(id);
  }

  function send(id: string) {
    clearTimer(id);
    const patch = pending.get(id);
    if (!patch) return;
    pending.delete(id);

    inFlight.add(id);
    // A later patch for the same note queues a fresh save; it is not merged
    // into this one, so an in-flight request never grows after it is sent.
    void Promise.resolve(save(id, patch)).catch(() => {}).finally(() => {
      inFlight.delete(id);
    });
  }

  return {
    queue(id, patch) {
      pending.set(id, { ...pending.get(id), ...patch });
      clearTimer(id);
      handles.set(
        id,
        timers.set(() => send(id), delayMs)
      );
    },

    flush(id) {
      send(id);
    },

    flushAll() {
      for (const id of [...pending.keys()]) send(id);
    },

    cancel(id) {
      clearTimer(id);
      return pending.delete(id);
    },

    cancelAll() {
      for (const id of [...handles.keys()]) clearTimer(id);
      pending.clear();
    },

    isPending(id) {
      return pending.has(id);
    },

    pendingIds() {
      return [...pending.keys()];
    },

    isBusy() {
      return pending.size > 0 || inFlight.size > 0;
    },
  };
}
