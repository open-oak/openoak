import { randomUUID } from "node:crypto";
import { readLegacyKanbanDocument, mutateLegacyKanbanDocument } from "./kanban-legacy-bridge.ts";
import { searchModularKanban } from "./kanban-v2-reads.ts";
import { Prisma } from "../generated/kanban/client";
import { cleanBoards, starterBoards, type Board, type BoardAppearance, type KanbanList, type Task } from "./kanban-data";
import { boardReducer, type BoardAction, type BoardState } from "./kanban-reducer";
import { kanbanPrisma } from "./kanban-prisma";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const LIST_COLORS = new Set(["default", "blue", "purple", "coral", "green", "gold"]);
const LIST_ICONS = new Set(["circle", "clock", "check", "flag", "briefcase", "star", "calendar", "todo"]);
const TASK_COLORS = new Set(["green", "yellow", "red"]);
const WALLPAPERS = new Set(["none", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);

export type KanbanMcpErrorCode = "invalid" | "not_found" | "conflict" | "invariant";

export class KanbanMcpError extends Error {
  constructor(
    public readonly code: KanbanMcpErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "KanbanMcpError";
  }
}

type StoredDocument = {
  boards: unknown;
  activeBoardId: string;
  revision: number;
  updatedAt: Date;
};

function pageSize(limit?: number) {
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)));
}

function parseCursor(cursor?: string) {
  if (!cursor) return 0;
  try {
    const value = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error();
    return value;
  } catch {
    throw new KanbanMcpError("invalid", "Invalid pagination cursor.");
  }
}

function nextCursor(offset: number, hasMore: boolean, limit: number) {
  return hasMore ? Buffer.from(String(offset + limit)).toString("base64url") : undefined;
}

function cleanName(value: string, kind: "board" | "list") {
  const name = value.trim().slice(0, 160);
  if (!name) throw new KanbanMcpError("invalid", `${kind === "board" ? "Board" : "List"} name cannot be empty.`);
  return name;
}

function cleanTaskTitle(value: string) {
  const title = value.trim().slice(0, 500);
  if (!title) throw new KanbanMcpError("invalid", "Card title cannot be empty.");
  return title;
}

function boardUrl(boardId: string, cardId?: string) {
  const base = (process.env.KANBAN_PUBLIC_URL || "https://kanban.openoak.org").replace(/\/$/, "");
  return `${base}/?board=${encodeURIComponent(boardId)}${cardId ? `&card=${encodeURIComponent(cardId)}` : ""}`;
}

function initialState(): BoardState {
  return {
    boards: starterBoards.map((board) => ({
      ...board,
      lists: board.lists.map((list) => ({ ...list })),
      tasks: board.tasks.map((task) => ({ ...task })),
    })),
    activeBoardId: starterBoards[0].id,
  };
}

function stateOf(document: StoredDocument | null): BoardState {
  if (!document) return initialState();
  const boards = cleanBoards(document.boards);
  if (!boards.length) return initialState();
  return {
    boards,
    activeBoardId: boards.some((board) => board.id === document.activeBoardId) ? document.activeBoardId : boards[0].id,
  };
}

function serializeTask(task: Task, boardId: string) {
  return { ...task, url: boardUrl(boardId, task.id) };
}

function serializeBoardSummary(board: Board) {
  return {
    id: board.id,
    name: board.name,
    theme: board.theme,
    wallpaper: board.wallpaper,
    wallpaperBlur: board.wallpaperBlur,
    cardCount: board.tasks.length,
    lists: board.lists.map((list) => ({
      ...list,
      cardCount: board.tasks.filter((task) => task.listId === list.id).length,
    })),
    url: boardUrl(board.id),
  };
}

function selectBoard(state: BoardState, boardId: string): BoardState {
  return boardReducer(state, { type: "selectBoard", boardId });
}

function applyToBoard(state: BoardState, boardId: string, action: BoardAction) {
  return boardReducer(selectBoard(state, boardId), action);
}

async function saveDocument(userId: string, current: StoredDocument | null, state: BoardState) {
  const bytes = new TextEncoder().encode(JSON.stringify({ boards: state.boards, activeBoardId: state.activeBoardId })).byteLength;
  if (bytes > MAX_DOCUMENT_BYTES) throw new KanbanMcpError("invalid", "The Kanban document would exceed the 2 MB limit.");
  const boards = JSON.parse(JSON.stringify(state.boards)) as Prisma.InputJsonValue;

  if (!current) {
    try {
      return await kanbanPrisma.kanbanDocument.create({
        data: { userId, boards, activeBoardId: state.activeBoardId },
      });
    } catch (error) {
      const concurrent = await kanbanPrisma.kanbanDocument.findUnique({ where: { userId } });
      if (concurrent) {
        throw new KanbanMcpError("conflict", "The Kanban document was created concurrently.", { currentRevision: concurrent.revision });
      }
      throw error;
    }
  }

  const result = await kanbanPrisma.kanbanDocument.updateMany({
    where: { userId, revision: current.revision },
    data: { boards, activeBoardId: state.activeBoardId, revision: { increment: 1 } },
  });
  if (!result.count) {
    const concurrent = await kanbanPrisma.kanbanDocument.findUnique({ where: { userId } });
    throw new KanbanMcpError("conflict", "The Kanban document changed while it was being saved.", {
      currentRevision: concurrent?.revision ?? 0,
    });
  }
  return kanbanPrisma.kanbanDocument.findUniqueOrThrow({ where: { userId } });
}

async function mutateDocument(
  userId: string,
  expectedRevision: number,
  mutate: (state: BoardState) => { state: BoardState; result: Record<string, unknown>; write?: boolean },
) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new KanbanMcpError("invalid", "expectedRevision must be a non-negative integer.");
  }
  const bridged = await mutateLegacyKanbanDocument(userId, expectedRevision, mutate);
  if (bridged) return { ...bridged.result, revision: bridged.document.revision, updatedAt: bridged.document.updatedAt.toISOString() };
  const current = await kanbanPrisma.kanbanDocument.findUnique({ where: { userId } });
  const currentRevision = current?.revision ?? 0;
  if (currentRevision !== expectedRevision) {
    throw new KanbanMcpError("conflict", "The Kanban document changed after it was read.", { currentRevision });
  }
  const mutation = mutate(stateOf(current));
  if (mutation.write === false) {
    return {
      ...mutation.result,
      revision: currentRevision,
      updatedAt: current?.updatedAt.toISOString() ?? null,
    };
  }
  const saved = await saveDocument(userId, current, mutation.state);
  return {
    ...mutation.result,
    revision: saved.revision,
    updatedAt: saved.updatedAt.toISOString(),
  };
}

export async function kanbanListBoards(userId: string, input: { limit?: number; cursor?: string } = {}) {
  const limit = pageSize(input.limit);
  const offset = parseCursor(input.cursor);
  const document = await readLegacyKanbanDocument(userId);
  const state = stateOf(document);
  const candidates = state.boards.slice(offset, offset + limit + 1);
  const boards = candidates.slice(0, limit).map((board) => ({
    id: board.id,
    name: board.name,
    listCount: board.lists.length,
    cardCount: board.tasks.length,
    theme: board.theme,
    updatedAt: document?.updatedAt.toISOString() ?? null,
    revision: document?.revision ?? 0,
    url: boardUrl(board.id),
  }));
  return { items: boards, revision: document?.revision ?? 0, nextCursor: nextCursor(offset, candidates.length > limit, limit) };
}

export async function kanbanGetBoard(userId: string, id: string) {
  const document = await readLegacyKanbanDocument(userId);
  const board = stateOf(document).boards.find((candidate) => candidate.id === id);
  if (!board) throw new KanbanMcpError("not_found", "Board not found.");
  return { board: serializeBoardSummary(board), revision: document?.revision ?? 0, updatedAt: document?.updatedAt.toISOString() ?? null };
}

export async function kanbanListCards(
  userId: string,
  input: { boardId?: string; listId?: string; query?: string; limit?: number; cursor?: string } = {},
) {
  const limit = pageSize(input.limit);
  const offset = parseCursor(input.cursor);
  const query = input.query?.trim().toLocaleLowerCase();
  const document = await readLegacyKanbanDocument(userId);
  const state = stateOf(document);
  if (input.boardId && !state.boards.some((board) => board.id === input.boardId)) {
    throw new KanbanMcpError("not_found", "Board not found.");
  }
  if (input.listId && !state.boards.some((board) => board.lists.some((list) => list.id === input.listId))) {
    throw new KanbanMcpError("not_found", "List not found.");
  }
  const cards = state.boards.flatMap((board) => {
    if (input.boardId && board.id !== input.boardId) return [];
    return board.tasks
      .filter((task) => !input.listId || task.listId === input.listId)
      .filter((task) => !query || `${task.title}\n${task.description}`.toLocaleLowerCase().includes(query))
      .map((task) => ({
        id: task.id,
        title: task.title,
        descriptionExcerpt: task.description.slice(0, 240),
        dueDate: task.dueDate,
        color: task.color,
        listId: task.listId,
        boardId: board.id,
        order: task.order,
        url: boardUrl(board.id, task.id),
      }));
  });
  const candidates = cards.slice(offset, offset + limit + 1);
  return {
    items: candidates.slice(0, limit),
    revision: document?.revision ?? 0,
    updatedAt: document?.updatedAt.toISOString() ?? null,
    nextCursor: nextCursor(offset, candidates.length > limit, limit),
  };
}

export async function kanbanGetCard(userId: string, boardId: string, id: string) {
  const document = await readLegacyKanbanDocument(userId);
  const board = stateOf(document).boards.find((candidate) => candidate.id === boardId);
  const card = board?.tasks.find((candidate) => candidate.id === id);
  if (!card) throw new KanbanMcpError("not_found", "Card not found.");
  return {
    card: { ...serializeTask(card, boardId), boardId },
    revision: document?.revision ?? 0,
    updatedAt: document?.updatedAt.toISOString() ?? null,
  };
}

export async function kanbanSearch(userId: string, query: string, limit = DEFAULT_LIMIT) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const modular = await searchModularKanban(userId, query, limit);
  if (modular) return modular;
  const document = await readLegacyKanbanDocument(userId);
  const results: Array<Record<string, unknown>> = [];
  for (const board of stateOf(document).boards) {
    if (board.name.toLocaleLowerCase().includes(normalized)) {
      results.push({ type: "board", id: board.id, title: board.name, boardId: board.id, url: boardUrl(board.id) });
    }
    for (const list of board.lists) {
      if (list.name.toLocaleLowerCase().includes(normalized)) {
        results.push({ type: "list", id: list.id, title: list.name, boardId: board.id, url: boardUrl(board.id) });
      }
    }
    for (const task of board.tasks) {
      if (`${task.title}\n${task.description}`.toLocaleLowerCase().includes(normalized)) {
        results.push({ type: "card", id: task.id, title: task.title, description: task.description, boardId: board.id, url: boardUrl(board.id, task.id) });
      }
    }
    if (results.length >= Math.min(MAX_LIMIT, Math.max(1, limit))) break;
  }
  return results.slice(0, Math.min(MAX_LIMIT, Math.max(1, limit)));
}

export async function kanbanCreateBoard(userId: string, input: { name: string; expectedRevision: number }) {
  const id = randomUUID();
  const name = cleanName(input.name, "board");
  return mutateDocument(userId, input.expectedRevision, (state) => ({
    state: boardReducer(state, { type: "createBoard", id, name }),
    result: { id, created: true, url: boardUrl(id) },
  }));
}

export async function kanbanUpdateBoard(
  userId: string,
  input: { id: string; expectedRevision: number; name?: string; theme?: string; wallpaper?: string; wallpaperBlur?: boolean },
) {
  return mutateDocument(userId, input.expectedRevision, (state) => {
    const board = state.boards.find((candidate) => candidate.id === input.id);
    if (!board) throw new KanbanMcpError("not_found", "Board not found.");
    let next = selectBoard(state, board.id);
    let changed = false;
    if (typeof input.name === "string") {
      next = boardReducer(next, { type: "renameActiveBoard", name: cleanName(input.name, "board") });
      changed = true;
    }
    const appearance: Partial<BoardAppearance> = {};
    if (typeof input.theme === "string") {
      if (!LIST_COLORS.has(input.theme)) throw new KanbanMcpError("invalid", "Invalid board theme.");
      appearance.theme = input.theme as BoardAppearance["theme"];
    }
    if (typeof input.wallpaper === "string") {
      if (!WALLPAPERS.has(input.wallpaper)) throw new KanbanMcpError("invalid", "Invalid board wallpaper.");
      appearance.wallpaper = input.wallpaper as BoardAppearance["wallpaper"];
    }
    if (typeof input.wallpaperBlur === "boolean") appearance.wallpaperBlur = input.wallpaperBlur;
    if (Object.keys(appearance).length) {
      next = boardReducer(next, { type: "updateBoardAppearance", updates: appearance });
      changed = true;
    }
    if (!changed) throw new KanbanMcpError("invalid", "Provide at least one board field to update.");
    return { state: next, result: { id: board.id, updated: true, url: boardUrl(board.id) } };
  });
}

export async function kanbanDeleteBoard(userId: string, input: { id: string; expectedRevision: number }) {
  return mutateDocument(userId, input.expectedRevision, (state) => {
    const board = state.boards.find((candidate) => candidate.id === input.id);
    if (!board) return { state, result: { id: input.id, deleted: false, alreadyAbsent: true }, write: false };
    const next = boardReducer(selectBoard(state, board.id), { type: "deleteActiveBoard", replacementId: randomUUID() });
    return { state: next, result: { id: input.id, deleted: true, alreadyAbsent: false, resetToMain: state.boards.length === 1 } };
  });
}

export async function kanbanCreateList(
  userId: string,
  input: { boardId: string; expectedRevision: number; name: string; color?: string; icon?: string },
) {
  const id = randomUUID();
  const name = cleanName(input.name, "list");
  const color = input.color ?? "blue";
  const icon = input.icon ?? "todo";
  if (!LIST_COLORS.has(color)) throw new KanbanMcpError("invalid", "Invalid list color.");
  if (!LIST_ICONS.has(icon)) throw new KanbanMcpError("invalid", "Invalid list icon.");
  return mutateDocument(userId, input.expectedRevision, (state) => {
    if (!state.boards.some((board) => board.id === input.boardId)) throw new KanbanMcpError("not_found", "Board not found.");
    return {
      state: applyToBoard(state, input.boardId, { type: "createList", id, name, color: color as KanbanList["color"], icon: icon as KanbanList["icon"] }),
      result: { id, boardId: input.boardId, created: true, url: boardUrl(input.boardId) },
    };
  });
}

export async function kanbanUpdateList(
  userId: string,
  input: { boardId: string; id: string; expectedRevision: number; name?: string; color?: string; icon?: string },
) {
  return mutateDocument(userId, input.expectedRevision, (state) => {
    const board = state.boards.find((candidate) => candidate.id === input.boardId);
    if (!board?.lists.some((list) => list.id === input.id)) throw new KanbanMcpError("not_found", "List not found.");
    const updates: Partial<KanbanList> = {};
    if (typeof input.name === "string") updates.name = cleanName(input.name, "list");
    if (typeof input.color === "string") {
      if (!LIST_COLORS.has(input.color)) throw new KanbanMcpError("invalid", "Invalid list color.");
      updates.color = input.color as KanbanList["color"];
    }
    if (typeof input.icon === "string") {
      if (!LIST_ICONS.has(input.icon)) throw new KanbanMcpError("invalid", "Invalid list icon.");
      updates.icon = input.icon as KanbanList["icon"];
    }
    if (!Object.keys(updates).length) throw new KanbanMcpError("invalid", "Provide at least one list field to update.");
    return { state: applyToBoard(state, input.boardId, { type: "updateList", listId: input.id, updates }), result: { id: input.id, boardId: input.boardId, updated: true, url: boardUrl(input.boardId) } };
  });
}

export async function kanbanDeleteList(userId: string, input: { boardId: string; id: string; expectedRevision: number }) {
  return mutateDocument(userId, input.expectedRevision, (state) => {
    const board = state.boards.find((candidate) => candidate.id === input.boardId);
    const list = board?.lists.find((candidate) => candidate.id === input.id);
    if (!list) return { state, result: { id: input.id, boardId: input.boardId, deleted: false, alreadyAbsent: true }, write: false };
    if (board!.lists.length <= 1) throw new KanbanMcpError("invariant", "The last list cannot be deleted.");
    const movedCardCount = board!.tasks.filter((task) => task.listId === input.id).length;
    return {
      state: applyToBoard(state, input.boardId, { type: "deleteList", listId: input.id }),
      result: { id: input.id, boardId: input.boardId, deleted: true, alreadyAbsent: false, movedCardCount },
    };
  });
}

export async function kanbanCreateCard(
  userId: string,
  input: { boardId: string; listId: string; expectedRevision: number; title: string; description?: string; dueDate?: string; color?: string | null },
) {
  const id = randomUUID();
  const title = cleanTaskTitle(input.title);
  if (input.color !== null && input.color !== undefined && !TASK_COLORS.has(input.color)) throw new KanbanMcpError("invalid", "Invalid card color.");
  return mutateDocument(userId, input.expectedRevision, (state) => {
    const board = state.boards.find((candidate) => candidate.id === input.boardId);
    if (!board?.lists.some((list) => list.id === input.listId)) throw new KanbanMcpError("not_found", "Board or list not found.");
    let next = applyToBoard(state, input.boardId, { type: "addTask", listId: input.listId, id, title });
    const updates: Partial<Task> = {};
    if (typeof input.description === "string") updates.description = input.description.slice(0, 20_000);
    if (typeof input.dueDate === "string") updates.dueDate = input.dueDate.slice(0, 100);
    if (input.color !== undefined) updates.color = input.color as Task["color"];
    if (Object.keys(updates).length) next = applyToBoard(next, input.boardId, { type: "updateTask", taskId: id, updates });
    return { state: next, result: { id, boardId: input.boardId, listId: input.listId, created: true, url: boardUrl(input.boardId, id) } };
  });
}

export async function kanbanUpdateCard(
  userId: string,
  input: { boardId: string; id: string; expectedRevision: number; title?: string; description?: string; dueDate?: string; color?: string | null },
) {
  return mutateDocument(userId, input.expectedRevision, (state) => {
    const board = state.boards.find((candidate) => candidate.id === input.boardId);
    if (!board?.tasks.some((task) => task.id === input.id)) throw new KanbanMcpError("not_found", "Card not found.");
    const updates: Partial<Task> = {};
    if (typeof input.title === "string") updates.title = cleanTaskTitle(input.title);
    if (typeof input.description === "string") updates.description = input.description.slice(0, 20_000);
    if (typeof input.dueDate === "string") updates.dueDate = input.dueDate.slice(0, 100);
    if (input.color === null || typeof input.color === "string") {
      if (input.color !== null && !TASK_COLORS.has(input.color)) throw new KanbanMcpError("invalid", "Invalid card color.");
      updates.color = input.color as Task["color"];
    }
    if (!Object.keys(updates).length) throw new KanbanMcpError("invalid", "Provide at least one card field to update.");
    return { state: applyToBoard(state, input.boardId, { type: "updateTask", taskId: input.id, updates }), result: { id: input.id, boardId: input.boardId, updated: true, url: boardUrl(input.boardId, input.id) } };
  });
}

export async function kanbanMoveCard(
  userId: string,
  input: { boardId: string; id: string; listId: string; index?: number; expectedRevision: number },
) {
  return mutateDocument(userId, input.expectedRevision, (state) => {
    const board = state.boards.find((candidate) => candidate.id === input.boardId);
    if (!board?.tasks.some((task) => task.id === input.id) || !board.lists.some((list) => list.id === input.listId)) {
      throw new KanbanMcpError("not_found", "Card or target list not found.");
    }
    const action: BoardAction = typeof input.index === "number"
      ? { type: "moveTaskToIndex", taskId: input.id, listId: input.listId, index: input.index }
      : { type: "moveTaskToList", taskId: input.id, listId: input.listId };
    return { state: applyToBoard(state, input.boardId, action), result: { id: input.id, boardId: input.boardId, listId: input.listId, moved: true, url: boardUrl(input.boardId, input.id) } };
  });
}

export async function kanbanDeleteCard(userId: string, input: { boardId: string; id: string; expectedRevision: number }) {
  return mutateDocument(userId, input.expectedRevision, (state) => {
    const board = state.boards.find((candidate) => candidate.id === input.boardId);
    if (!board?.tasks.some((task) => task.id === input.id)) {
      return { state, result: { id: input.id, boardId: input.boardId, deleted: false, alreadyAbsent: true }, write: false };
    }
    return {
      state: applyToBoard(state, input.boardId, { type: "deleteTask", taskId: input.id }),
      result: { id: input.id, boardId: input.boardId, deleted: true, alreadyAbsent: false },
    };
  });
}
