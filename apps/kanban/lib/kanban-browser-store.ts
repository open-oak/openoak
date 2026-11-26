import type { Board } from "./kanban-data.ts";
import type { BoardAction, BoardState } from "./kanban-reducer.ts";
import { BrowserSyncError, KanbanBrowserApi, visibleBoard, type BoardSummary, type LoadedBoard, type Profile } from "./kanban-browser-api.ts";
import { captureIntent, prepareIntent, projectIntents, type EditIntent } from "./kanban-browser-intent.ts";
import type { QueueStorage } from "./kanban-offline-queue.ts";

type ArchivedDeletion = { boardId: string; boardKey: string; cardId: string; contentVersion: number; placementVersion: number };
type Cache = { version: 2; accountId: string; selected: string; profile?: Profile; summaries: BoardSummary[]; loaded: Record<string, LoadedBoard>; queue: EditIntent[]; recovery?: EditIntent[]; lastDeletion?: ArchivedDeletion; lastDeletions?: ArchivedDeletion[] };
export type BrowserView = { state: BoardState; counts: Record<string, number>; summaries?: BoardSummary[]; recovered?: number; status: "loading" | "saving" | "synced" | "offline" | "conflict"; message?: string; reloadRequired?: boolean; canDiscard?: boolean; ready: boolean; pending: number };
export class KanbanBrowserStore {
  private cache: Cache;
  private busy = false;
  private idleWaiters: Array<() => void> = [];
  private stopped = false;
  private ready = false;
  private status: BrowserView["status"] = "loading";
  private message?: string;
  private reloadRequired = false;
  private key: string;
  private raw: string | null;
  private storage: QueueStorage;
  private api: KanbanBrowserApi;
  private notify: (view: BrowserView) => void;
  private uuid: () => string;
  constructor(storage: QueueStorage, accountId: string, api: KanbanBrowserApi, notify: (view: BrowserView) => void, uuid = () => crypto.randomUUID()) {
    this.storage = storage; this.api = api; this.notify = notify; this.uuid = uuid;
    this.key = "open-kanban-modular:" + accountId;
    this.raw = storage.getItem(this.key);
    this.cache = this.raw ? JSON.parse(this.raw) : { version: 2, accountId, selected: "", summaries: [], loaded: {}, queue: [] };
    if (this.cache.version !== 2 || this.cache.accountId !== accountId || !Array.isArray(this.cache.queue) || !Array.isArray(this.cache.summaries) || !this.cache.loaded) throw new Error("Saved edits could not be read. Keep the recovery data before resetting this device.");
    this.ready = !!this.cache.loaded[this.cache.selected];
  }
  private save() {
    // The browser hook holds an exclusive account Web Lock. Also detect a stale
    // writer so a restored/older client cannot silently replace this queue.
    if (this.storage.getItem(this.key) !== this.raw) throw new BrowserSyncError("storage", "Another tab changed this device's saved edits. Reload before editing.");
    const raw = JSON.stringify(this.cache);
    this.storage.setItem(this.key, raw);
    this.raw = raw;
  }
  private view(): BrowserView {
    const boards = this.cache.summaries.map((summary) => {
      const loaded = this.cache.loaded[summary.id];
      return loaded ? visibleBoard(loaded) : { ...summary, lists: [], tasks: [] } as unknown as Board;
    });
    const state = projectIntents(boards, this.cache.selected, this.cache.queue);
    const counts = Object.fromEntries(state.boards.map((board) => [board.id, this.cache.loaded[board.id] || this.cache.queue.some((item) => item.boardId === board.id) ? board.tasks.length : this.cache.summaries.find((summary) => summary.id === board.id)?.cardCount ?? 0]));
    return { state, counts, status: this.status, reloadRequired: this.reloadRequired, canDiscard: !!this.cache.queue[0]?.blocked, summaries: this.cache.summaries, recovered: this.cache.recovery?.length ?? 0, message: this.message ?? (this.cache.recovery?.length ? "A board is no longer available. Your unsent edits are saved separately for download." : undefined), ready: this.ready, pending: this.cache.queue.length };
  }
  private emit() { if (!this.stopped) this.notify(this.view()); }
  async stop() {
    this.stopped = true;
    if (this.busy) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }
  private finish() {
    this.busy = false;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
  async start(initialBoardId?: string) {
    if (initialBoardId && this.cache.loaded[initialBoardId]) this.cache.selected = initialBoardId;
    this.emit();
    await this.sync(initialBoardId);
  }
  private fail(error: unknown) {
    const code = error instanceof BrowserSyncError ? error.code : "unexpected";
    this.status = code === "offline" ? "offline" : "conflict";
    this.reloadRequired = code === "invalid_response";
    this.message = error instanceof BrowserSyncError ? error.message : "Sync paused unexpectedly. Your unsent edits remain saved on this device. Try again or reload OpenKanban.";
    this.emit();
  }
  async refresh(selected?: string) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { profile, boards } = await this.api.catalog();
        if (this.cache.profile && profile.accountKey !== this.cache.profile.accountKey) throw new BrowserSyncError("account_changed", "Sign in with the original account to sync these edits.");
        const active = selected ?? this.cache.selected;
        const chosen = boards.find((board) => (board.id === active || board.boardKey === active)) ?? boards.find((board) => board.boardKey === profile.activeBoardKey) ?? boards[0];
        if (!chosen) throw new BrowserSyncError("not_found", "No board is available.");
        // An authoritative catalogue removes revoked boards from navigation and
        // normal cache. Preserve only local unsent intents in a separate archive.
        const missing = new Set(this.cache.summaries.filter((previous) => !boards.some((board) => board.id === previous.id)).map((board) => board.id));
        const recovery = this.cache.queue.filter((item) => missing.has(item.boardId) && !item.acknowledged && !["board.create", "board.import"].includes(String(item.fields.type)));
        const queue = this.cache.queue.filter((item) => !missing.has(item.boardId) || item.acknowledged || ["board.create", "board.import"].includes(String(item.fields.type)));
        const needed = new Set([chosen.id, ...queue.map((item) => item.boardId)]);
        const loaded = Object.fromEntries(Object.entries(this.cache.loaded).filter(([id]) => !missing.has(id)));
        for (const summary of boards) if (needed.has(summary.id)) {
          loaded[summary.id] = loaded[summary.id]
            ? await this.api.refreshBoard(loaded[summary.id], summary, profile.epoch)
            : await this.api.board(summary, profile.epoch);
        }
        // Publish the cache only after every required page has passed validation.
        this.cache.queue = queue; this.cache.recovery = [...(this.cache.recovery ?? []), ...recovery];
        this.cache.profile = profile; this.cache.summaries = boards; this.cache.loaded = loaded;
        if (!this.cache.queue.some((item) => item.action.type === "createBoard" && item.boardId === active)) this.cache.selected = chosen.id;
        this.ready = true; this.save(); return;
      } catch (error) {
        if (!(error instanceof BrowserSyncError) || error.code !== "restart_read" || attempt === 2) throw error;
      }
    }
  }
  dispatch(action: BoardAction) {
    if (this.stopped) return false;
    if (!this.ready) { this.message = "Load this board before editing it."; this.emit(); return false; }
    if (action.type === "selectBoard") {
      const selectedId = action.boardId;
      const summary = this.cache.summaries.find((item) => item.id === selectedId);
      if (!summary) return false;
      if (!this.cache.loaded[action.boardId]) { void this.select(action.boardId); return false; }
    }
    const state = this.view().state;
    if (action.type === "deleteActiveBoard" && this.cache.summaries.find((board) => board.id === state.activeBoardId)?.accessLevel === "editor") {
      this.message = "Only the owner can delete this board. Use Share board to leave it."; this.emit(); return false;
    }
    if (action.type === "deleteActiveBoard" && this.cache.summaries.filter((board) => board.accessLevel !== "editor").length === 1) action = { ...action, resetOwned: true };
    const targetId = action.type === "selectBoard" ? action.boardId : state.activeBoardId;
    const key = action.type === "createBoard" ? action.id : this.cache.summaries.find((board) => board.id === targetId)?.boardKey
      ?? this.cache.queue.find((item) => item.boardId === targetId)?.boardKey ?? targetId;
    try {
      const intent = captureIntent(state, action, key, this.uuid());
      if (!intent) return false;
      const before = structuredClone(this.cache);
      // Keystroke edits can coalesce only before any request binds their ID.
      const last = this.cache.queue.at(-1);
      if (last && !last.prepared && !last.blocked && !last.acknowledged && intent.fields.type === "card.update" && last.fields.type === "card.update" && last.boardKey === intent.boardKey && last.fields.cardId === intent.fields.cardId && last.action.type === "updateTask" && intent.action.type === "updateTask") {
        last.before = { ...intent.before, ...last.before };
        last.fields.changes = { ...last.fields.changes as object, ...intent.fields.changes as object };
        last.action.updates = { ...last.action.updates, ...intent.action.updates };
        last.draft = intent.draft;
      } else this.cache.queue.push(intent);
      if (action.type === "createBoard" || action.type === "selectBoard") this.cache.selected = action.type === "createBoard" ? action.id : action.boardId;
      try { this.save(); } catch (error) { this.cache = before; throw new BrowserSyncError("storage", error instanceof Error ? error.message : "Unable to save on this device."); }
      this.status = this.cache.queue[0]?.blocked ? "conflict" : "saving"; this.emit();
      return true;
    } catch (error) { this.fail(error); return false; }
  }
  private async select(id: string) {
    if (this.busy) { this.message = "Finishing the current save. Select the board again in a moment."; this.emit(); return; }
    this.busy = true;
    this.status = "loading"; this.emit();
    const previous = this.cache.selected;
    try {
      await this.refresh(id);
      // Capture selection against the previous local preference.
      this.cache.selected = previous;
      this.dispatch({ type: "selectBoard", boardId: id });
    } catch (error) { this.fail(error); }
    finally { this.finish(); }
    void this.sync();
  }
  async sync(selected?: string) {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      this.message = undefined; this.reloadRequired = false;
      // An uncertain response must replay its exact saved request before rebasing.
      if (!this.cache.queue[0]?.prepared || this.cache.queue[0]?.blocked) await this.refresh(selected);
      while (this.cache.queue.length && !this.stopped) {
        const item = this.cache.queue[0];
        if (item.blocked) throw new BrowserSyncError("conflict", item.blocked);
        if (!item.acknowledged) {
          if (!item.prepared) {
            try {
              if (!["board.create", "board.import"].includes(String(item.fields.type)) && !this.cache.summaries.some((board) => board.id === item.boardId)) throw new BrowserSyncError("not_found", "This board is no longer available. Export your unsent edits.");
              item.prepared = prepareIntent(item, this.cache.loaded[item.boardId], this.cache.profile!);
            } catch (error) {
              item.blocked = error instanceof Error ? error.message : "This edit needs review.";
              this.save(); throw error;
            }
            this.save();
          }
          this.status = "saving"; this.emit();
          try { item.acknowledged = await this.api.send(item.prepared); this.save(); }
          catch (error) {
            if (error instanceof BrowserSyncError && error.code === "not_found") {
              await this.refresh();
              if (!this.cache.queue.includes(item)) { this.emit(); continue; }
            }
            if (error instanceof BrowserSyncError && ["conflict", "not_found", "invalid", "too_large", "operation_id_reused", "upgrade_required"].includes(error.code)) {
              item.blocked = error.message; this.save();
            }
            throw error;
          }
        }
        await this.refresh();
        // Removing the receipt and adopting the refreshed rows is one durable write.
        if (item.prepared?.type === "card.delete" || item.prepared?.type === "card.archive") {
          this.cache.lastDeletion = { boardId: item.boardId, boardKey: item.boardKey, cardId: item.prepared.cardId, contentVersion: item.prepared.expectedContentVersion, placementVersion: item.prepared.expectedPlacementVersion };
          this.cache.lastDeletions = [...(this.cache.lastDeletions ?? []).filter((entry) => entry.boardKey !== item.boardKey || entry.cardId !== this.cache.lastDeletion!.cardId), this.cache.lastDeletion].slice(-50);
        }
        this.cache.queue = this.cache.queue.filter((queued) => queued.id !== item.id);
        if (item.action.type === "createBoard" && this.cache.selected === item.boardId) {
          const selection: EditIntent = { id: this.uuid(), boardId: item.boardId, boardKey: item.boardKey, action: { type: "selectBoard", boardId: item.boardId }, fields: { type: "profile.selectBoard" }, before: {} };
          this.cache.queue.push(selection);
        }
        this.save(); this.emit();
      }
      this.status = this.cache.queue.length ? "saving" : "synced"; this.message = undefined; this.emit();
    } catch (error) { this.fail(error); }
    finally { this.finish(); }
  }
  async retry() {
    const head = this.cache.queue[0];
    if (head?.blocked && !this.busy) {
      // Only a definite server rejection may release a prepared request. Use a
      // fresh ID, reread current versions, and retain the original field guards.
      head.blocked = undefined; head.prepared = undefined; head.id = this.uuid(); this.save();
    }
    await this.sync();
  }
  async discardFirst() {
    if (this.busy || !this.cache.queue[0]?.blocked) return;
    this.cache.queue.shift(); this.save(); await this.sync();
  }
  recoverCard(boardId: string, cardId: string, deletionId: string, permanent = false, destinationListId?: string) {
    if (!this.ready || this.stopped) throw new Error("Load this board before changing the archive.");
    const board = this.cache.summaries.find((item) => item.id === boardId);
    if (!board) throw new Error("This board is no longer available.");
    if (permanent && board.accessLevel === "editor") throw new Error("Only the owner can permanently delete cards.");
    const queued = this.cache.queue.find((item) => item.boardId === boardId && item.fields.cardId === cardId && item.fields.deletionId === deletionId);
    if (queued) {
      const type = permanent ? "card.purge" : "card.restore";
      if (queued.fields.type !== type || queued.fields.destinationListId !== destinationListId) throw new Error("A different change for this card is waiting to sync. Finish or discard it before continuing.");
      return queued.id;
    }
    const operationId = this.uuid();
    const previous = structuredClone(this.cache);
    this.cache.queue.push({ id: operationId, boardId, boardKey: board.boardKey, before: {}, action: { type: "recoverTask", taskId: cardId },
      fields: { type: permanent ? "card.purge" : "card.restore", cardId, deletionId, ...(permanent ? { confirmPermanent: true } : destinationListId ? { destinationListId } : {}) } });
    try { this.save(); } catch (error) { this.cache = previous; throw error; }
    this.status = "saving"; this.emit(); void this.sync();
    return operationId;
  }
  purgeArchive(boardId: string, expectedRevision: number) {
    if (!this.ready || this.stopped) throw new Error("Load this board before changing the archive.");
    const board = this.cache.summaries.find((item) => item.id === boardId);
    if (!board || board.accessLevel === "editor") throw new Error("Only the owner can delete the archive.");
    const queued = this.cache.queue.find((item) => item.boardId === boardId && item.fields.type === "archive.purge");
    if (queued) {
      if (queued.fields.expectedRevision !== expectedRevision) throw new Error("An archive deletion is waiting to sync. Finish or discard it before continuing.");
      return queued.id;
    }
    const id = this.uuid(), previous = structuredClone(this.cache);
    this.cache.queue.push({ id, boardId, boardKey: board.boardKey, before: {}, action: { type: "recoverTask", taskId: "" }, fields: { type: "archive.purge", expectedRevision, confirmPermanent: true } });
    try { this.save(); } catch (error) { this.cache = previous; throw error; }
    this.status = "saving"; this.emit(); void this.sync();
    return id;
  }
  async waitForOperation(id: string) {
    if (this.busy) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
    if (this.cache.queue.some((item) => item.id === id)) await this.sync();
    if (this.cache.queue.some((item) => item.id === id)) throw new Error(this.message ?? "Saved on this device. Reconnect to finish this action.");
  }
  async undoDelete(boardId: string, cardId: string) {
    const pending = this.cache.queue.find((item) => item.boardId === boardId && ["card.delete", "card.archive"].includes(String(item.fields.type)) && item.fields.cardId === cardId);
    if (pending && !pending.prepared && !pending.acknowledged) {
      const previous = structuredClone(this.cache);
      this.cache.queue = this.cache.queue.filter((item) => item.id !== pending.id);
      try { this.save(); } catch (error) { this.cache = previous; throw error; }
      this.emit(); void this.sync(); return;
    }
    if (this.busy) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
    if (this.cache.queue.some((item) => item === pending)) await this.sync();
    if (this.cache.queue.some((item) => item === pending)) throw new Error("Reconnect to finish undoing this archive. The saved request can be retried safely.");
    const deleted = this.cache.lastDeletions?.findLast((entry) => entry.boardId === boardId && entry.cardId === cardId) ?? this.cache.lastDeletion;
    if (!deleted || deleted.boardId !== boardId || deleted.cardId !== cardId) throw new Error("Open Archive to restore this card.");
    const page = await this.api.read("trash", { boardKey: deleted.boardKey, id: cardId });
    const card = page.items[0];
    if (!card || card.contentVersion !== deleted.contentVersion || card.placementVersion !== deleted.placementVersion) throw new Error("This card changed since deletion. Review its current entry in Archive.");
    this.recoverCard(boardId, cardId, card.deletionId);
  }
  recovery() { return this.raw ?? JSON.stringify(this.cache); }
  importBoards(boards: Board[]) {
    if (!this.ready) throw new Error("Load your account before importing.");
    const previous = structuredClone(this.cache);
    for (const board of boards) {
      const id = this.uuid();
      this.cache.queue.push({ id: this.uuid(), boardId: id, boardKey: id, before: {},
        fields: { type: "board.import", board: { ...board, id } },
        action: { type: "createBoard", id, name: board.name },
      });
      this.cache.selected = id;
    }
    try { this.save(); } catch (error) { this.cache = previous; throw error; }
    this.status = "saving"; this.emit();
    void this.sync();
  }
  async exportBoards(boardId?: string) {
    if (this.busy) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
    if (this.cache.queue.length) await this.sync();
    if (this.cache.queue.length) throw new Error("Finish syncing before exporting a complete backup. Your unsent edits can be downloaded separately.");
    this.busy = true;
    try {
      const { profile, boards } = await this.api.catalog();
      const all: Board[] = [];
      const selected = boards.filter((board) => boardId ? board.id === boardId : board.accessLevel !== "editor");
      if (boardId && !selected.length) throw new Error("This board is no longer available.");
      for (const summary of selected) all.push(await this.api.backupBoard(summary, profile.epoch));
      if (this.cache.queue.length) throw new Error("The board changed during export. Finish syncing and export again.");
      return { boards: all, activeBoardId: all.some((board) => board.id === this.cache.selected) ? this.cache.selected : all[0]?.id ?? "" };
    } finally { this.finish(); }
  }
}
