import { z } from "zod";
import { kanbanV2ReadSchemas } from "./kanban-v2-schemas.ts";
import { kanbanOperationResultSchema, type KanbanOperation } from "./kanban-operations-schema.ts";
import type { Board, KanbanList, Task } from "./kanban-data.ts";

export type BoardSummary = z.infer<typeof kanbanV2ReadSchemas.boards.output>["items"][number];
export type Profile = z.infer<typeof kanbanV2ReadSchemas.profile.output>;
export type StoredList = z.infer<typeof kanbanV2ReadSchemas.lists.output>["items"][number];
export type StoredCard = Task & { contentVersion: number; placementVersion: number };
export type LoadedBoard = { summary: BoardSummary; lists: StoredList[]; cards: StoredCard[]; epoch: number };
export class BrowserSyncError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

function parseResponse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BrowserSyncError("invalid_response", "OpenKanban needs to reload before it can sync. Your unsent edits remain saved on this device.");
  return parsed.data;
}

export function visibleBoard(board: LoadedBoard): Board {
  const { id, name, theme, wallpaper, wallpaperBlur } = board.summary;
  return { id, name, theme: theme as Board["theme"], wallpaper: wallpaper as Board["wallpaper"], wallpaperBlur,
    lists: board.lists.map(({ id, name, color, icon }) => ({ id, name, color, icon } as KanbanList)),
    tasks: board.cards.map(({ id, title, description, dueDate, color, listId, order }) => ({ id, title, description, dueDate, color, listId, order })),
  };
}

export class KanbanBrowserApi {
  private request: typeof fetch;
  private accountId?: string;
  constructor(request: typeof fetch = fetch, accountId?: string) { this.request = request; this.accountId = accountId; }
  private async json(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    if (this.accountId) headers.set("x-openkanban-account", this.accountId);
    headers.set("x-openkanban-capabilities", "sharing");
    const request = this.request;
    let response: Response;
    try { response = await request("/api/kanban/v2/" + path, { cache: "no-store", ...init, headers }); }
    catch { throw new BrowserSyncError("offline", "Cannot reach OpenKanban. Your edits are saved on this device and will sync when the connection returns."); }
    let body;
    try { body = await response.json(); }
    catch {
      throw new BrowserSyncError(response.ok ? "invalid_response" : "unavailable", response.ok
        ? "OpenKanban needs to reload before it can sync. Your unsent edits remain saved on this device."
        : "OpenKanban is temporarily unavailable. Your unsent edits remain saved on this device.");
    }
    if (!response.ok) throw new BrowserSyncError(body?.error?.code ?? "unavailable", body?.error?.message ?? "OpenKanban is temporarily unavailable. Your unsent edits remain saved on this device.");
    return body;
  }
  async read<K extends keyof typeof kanbanV2ReadSchemas>(resource: K, params: Record<string, string | number | boolean> = {}) {
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]));
    return parseResponse(kanbanV2ReadSchemas[resource].output, await this.json(resource + "?" + query)) as z.infer<(typeof kanbanV2ReadSchemas)[K]["output"]>;
  }
  async catalog() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const profile = await this.read("profile");
        const boards: BoardSummary[] = [];
        let cursor: string | undefined;
        do {
          const page = await this.read("boards", { limit: 50, ...(cursor ? { cursor } : {}) });
          if (page.epoch !== profile.epoch) throw new BrowserSyncError("restart_read", "Storage changed. Refreshing.");
          boards.push(...page.items); cursor = page.nextCursor;
        } while (cursor);
        return { profile, boards };
      } catch (error) { if (!(error instanceof BrowserSyncError) || error.code !== "restart_read" || attempt === 2) throw error; }
    }
    throw new BrowserSyncError("unavailable", "Boards are changing too quickly. Try again.");
  }
  async board(summary: BoardSummary, epoch: number): Promise<LoadedBoard> {
    const lists: StoredList[] = [];
    const cards: StoredCard[] = [];
    let cursor: string | undefined;
    const check = (page: { revision: number; epoch: number }) => {
      if (page.revision !== summary.revision || page.epoch !== epoch) throw new BrowserSyncError("restart_read", "Board changed while loading.");
    };
    do {
      const page = await this.read("lists", { boardKey: summary.boardKey, limit: 50, ...(cursor ? { cursor } : {}) });
      check(page); lists.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    do {
      const page = await this.read("card-details", { boardKey: summary.boardKey, limit: 50, ...(cursor ? { cursor } : {}) });
      check(page);
      for (const item of page.items) {
        if (item.kind === "card") cards.push(item.card);
        else {
          let next: string | undefined = item.cursor, json = "";
          do {
            const chunk: z.infer<typeof kanbanV2ReadSchemas["detail-chunks"]["output"]> = await this.read("detail-chunks", { boardKey: summary.boardKey, id: item.id, cursor: next });
            if (chunk.epoch !== epoch) throw new BrowserSyncError("restart_read", "Storage changed.");
            json += chunk.jsonFragment; next = chunk.nextCursor;
          } while (next);
          const parsed = parseResponse(kanbanV2ReadSchemas.card.output, { epoch, result: { kind: "card", card: JSON.parse(json) } });
          if (parsed.result.kind === "card") cards.push(parsed.result.card);
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    check(await this.read("lists", { boardKey: summary.boardKey, limit: 1 }));
    return { summary, epoch, lists, cards };
  }
  async completeCard(boardKey: string, id: string, archived = false) {
    const page = await this.read("card", { boardKey, id, ...(archived ? { archived: true } : {}) });
    if (page.result.kind === "card") return page.result.card;
    let cursor: string | undefined = page.result.cursor, json = "";
    do {
      const chunk: z.infer<typeof kanbanV2ReadSchemas["detail-chunks"]["output"]> = await this.read("detail-chunks", { boardKey, id, cursor, ...(archived ? { archived: true } : {}) });
      if (chunk.epoch !== page.epoch) throw new BrowserSyncError("restart_read", "The card changed. Try again.");
      json += chunk.jsonFragment; cursor = chunk.nextCursor;
    } while (cursor);
    const result = parseResponse(kanbanV2ReadSchemas.card.output, { epoch: page.epoch, result: { kind: "card", card: JSON.parse(json) } });
    if (result.result.kind !== "card") throw new BrowserSyncError("invalid_response", "Unable to read the card.");
    return result.result.card;
  }
  async backupBoard(summary: BoardSummary, epoch: number): Promise<Board> {
    const board = visibleBoard(await this.board(summary, epoch));
    board.archivedTasks = [];
    let cursor: string | undefined;
    do {
      const page = await this.read("archive", { boardKey: summary.boardKey, limit: 50, ...(cursor ? { cursor } : {}) });
      if (page.epoch !== epoch || page.revision !== summary.revision) throw new BrowserSyncError("restart_read", "The board changed during export. Try again.");
      for (const entry of page.items) {
        const card = await this.completeCard(summary.boardKey, entry.id, true);
        if (card.deletionId !== entry.deletionId || !card.archivedAt) throw new BrowserSyncError("restart_read", "The archive changed during export. Try again.");
        const { id, title, description, dueDate, color, listId, order, archivedAt } = card;
        board.archivedTasks.push({ id, title, description, dueDate, color, listId, order, archivedAt });
      }
      cursor = page.nextCursor;
    } while (cursor);
    const latest = await this.read("lists", { boardKey: summary.boardKey, limit: 1 });
    if (latest.epoch !== epoch || latest.revision !== summary.revision) throw new BrowserSyncError("restart_read", "The board changed during export. Try again.");
    return board;
  }
  async send(operation: KanbanOperation) {
    return parseResponse(kanbanOperationResultSchema, await this.json(operation.type === "board.import" ? "imports" : "operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(operation) }));
  }
  async refreshBoard(previous: LoadedBoard, summary: BoardSummary, epoch: number): Promise<LoadedBoard> {
    if (previous.epoch !== epoch) return this.board(summary, epoch);
    if (previous.summary.revision === summary.revision) return { ...previous, summary };
    const changed = new Map<string, boolean>();
    let cursor: string | undefined;
    const check = (page: { epoch: number; revision: number }) => {
      if (page.epoch !== epoch || page.revision !== summary.revision) throw new BrowserSyncError("restart_read", "Board changed while refreshing.");
    };
    do {
      const page = await this.read("changes", { boardKey: summary.boardKey, sinceRevision: previous.summary.revision, limit: 50, ...(cursor ? { cursor } : {}) });
      check(page);
      for (const item of page.items) if (item.kind === "card") changed.set(item.id, item.deleted);
      cursor = page.nextCursor;
    } while (cursor);
    const lists: StoredList[] = [];
    do {
      const page = await this.read("lists", { boardKey: summary.boardKey, limit: 50, ...(cursor ? { cursor } : {}) });
      check(page); lists.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    const cards = previous.cards.filter((card) => !changed.has(card.id));
    for (const [id, deleted] of changed) {
      if (deleted) continue;
      const page = await this.read("card", { boardKey: summary.boardKey, id });
      if (page.epoch !== epoch) throw new BrowserSyncError("restart_read", "Storage changed.");
      if (page.result.kind === "card") cards.push(page.result.card);
      else {
        let next: string | undefined = page.result.cursor, json = "";
        do {
          const chunk: z.infer<typeof kanbanV2ReadSchemas["detail-chunks"]["output"]> = await this.read("detail-chunks", { boardKey: summary.boardKey, id, cursor: next });
          if (chunk.epoch !== epoch) throw new BrowserSyncError("restart_read", "Storage changed.");
          json += chunk.jsonFragment; next = chunk.nextCursor;
        } while (next);
        const parsed = parseResponse(kanbanV2ReadSchemas.card.output, { epoch, result: { kind: "card", card: JSON.parse(json) } });
        if (parsed.result.kind === "card") cards.push(parsed.result.card);
      }
    }
    const latest = await this.read("lists", { boardKey: summary.boardKey, limit: 1 });
    check(latest);
    cards.sort((a, b) => lists.findIndex((list) => list.id === a.listId) - lists.findIndex((list) => list.id === b.listId) || a.order - b.order);
    return { summary, epoch, lists, cards };
  }
}
