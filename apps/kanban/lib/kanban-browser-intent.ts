import { boardReducer, type BoardAction, type BoardState } from "./kanban-reducer.ts";
import { type Board, type Task } from "./kanban-data.ts";
import { kanbanOperationSchema, type KanbanOperation, type KanbanOperationResult } from "./kanban-operations-schema.ts";
import { BrowserSyncError, type LoadedBoard, type Profile, visibleBoard } from "./kanban-browser-api.ts";

export type EditIntent = {
  id: string; boardId: string; boardKey: string; action: BoardAction | { type: "recoverTask"; taskId: string };
  fields: Record<string, unknown>; before: Record<string, unknown>;
  prepared?: KanbanOperation; acknowledged?: KanbanOperationResult; blocked?: string;
  draft?: Task;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const pick = (value: object, keys: string[]) => Object.fromEntries(keys.map((key) => [key, (value as Record<string, unknown>)[key]]));
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new BrowserSyncError("conflict", "This item is no longer available. Your edit is saved for recovery.");
  return value;
}

export function captureIntent(state: BoardState, action: BoardAction, boardKey: string, id: string): EditIntent | null {
  if (action.type === "replaceState") throw new BrowserSyncError("invalid", "Import boards as new copies.");
  const board = state.boards.find((board) => board.id === state.activeBoardId)!;
  const next = boardReducer(state, action);
  if (same(state, next)) return null;
  const intent: EditIntent = { id, boardId: board.id, boardKey, action, fields: {}, before: {} };
  const changedBoard = next.boards.find((item) => item.id === board.id);
  switch (action.type) {
    case "selectBoard": intent.boardId = action.boardId; intent.fields = { type: "profile.selectBoard" }; break;
    case "createBoard": intent.boardId = action.id; intent.fields = { type: "board.create", id: action.id, name: action.name }; break;
    case "deleteActiveBoard":
      intent.fields = { type: "board.delete", replacement: { id: action.replacementId, boardKey: action.replacementId } };
      intent.before = { board }; break;
    case "renameActiveBoard":
    case "updateBoardAppearance": {
      const keys = action.type === "renameActiveBoard" ? ["name"] : Object.keys(action.updates);
      intent.fields = { type: "board.update", changes: pick(changedBoard!, keys) };
      intent.before = pick(board, keys); break;
    }
    case "createList":
      intent.fields = { type: "list.create", listId: action.id, name: action.name, color: action.color, icon: action.icon ?? "circle" }; break;
    case "updateList": {
      const keys = Object.keys(action.updates).filter((key) => ["name", "color", "icon"].includes(key));
      intent.fields = { type: "list.update", listId: action.listId, changes: pick(must(changedBoard?.lists.find((item) => item.id === action.listId)), keys) };
      intent.before = pick(must(board.lists.find((item) => item.id === action.listId)), keys); break;
    }
    case "deleteList":
      intent.fields = { type: "list.delete", listId: action.listId }; intent.before = { board }; break;
    case "reorderLists":
      intent.fields = { type: "list.move", listId: action.draggedId, index: changedBoard!.lists.findIndex((list) => list.id === action.draggedId) };
      intent.before = { listIds: board.lists.map((list) => list.id) }; break;
    case "addTask":
      intent.fields = { type: "card.create", cardId: action.id, listId: action.listId, title: action.title }; break;
    case "deleteTask":
      intent.fields = { type: "card.archive", cardId: action.taskId };
      intent.before = { card: must(board.tasks.find((task) => task.id === action.taskId)) }; break;
    default: {
      const taskId = action.taskId;
      const previous = must(board.tasks.find((task) => task.id === taskId));
      const task = must(changedBoard?.tasks.find((task) => task.id === taskId));
      intent.draft = task;
      if (action.type === "updateTask" && !("listId" in action.updates) && !("order" in action.updates)) {
        const keys = Object.keys(action.updates).filter((key) => ["title", "description", "dueDate", "color"].includes(key));
        intent.fields = { type: "card.update", cardId: taskId, changes: pick(task, keys) };
        intent.before = pick(previous, keys);
      } else {
        intent.fields = { type: "card.move", cardId: taskId, sourceListId: previous.listId, destinationListId: task.listId, index: task.order };
        intent.before = { listId: previous.listId, order: previous.order };
      }
    }
  }
  return intent;
}

/** Rebase only when the fields affected by this edit still match what the user saw. */
export function prepareIntent(intent: EditIntent, loaded: LoadedBoard | undefined, profile: Profile): KanbanOperation {
  const fields = intent.fields;
  const type = fields.type;
  const board = loaded && visibleBoard(loaded);
  const summary = loaded?.summary;
  const card = loaded?.cards.find((card) => card.id === fields.cardId);
  const list = loaded?.lists.find((list) => list.id === fields.listId);
  let actual: Record<string, unknown> = {}, versions: Record<string, unknown> = {};
  switch (type) {
    case "board.create":
    case "board.import": versions = { expectedBoardOrderVersion: profile.boardOrderVersion }; break;
    case "profile.selectBoard": versions = { expectedProfileVersion: profile.version }; break;
    case "board.update": actual = pick(must(board), Object.keys(intent.before)); versions = { expectedMetadataVersion: must(summary).metadataVersion }; break;
    case "board.delete":
    case "list.delete": actual = { board: must(board) }; versions = { expectedRevision: must(summary).revision }; break;
    case "list.create": versions = { expectedListOrderVersion: must(summary).listOrderVersion }; break;
    case "list.update": actual = pick(must(list), Object.keys(intent.before)); versions = { expectedMetadataVersion: must(list).metadataVersion }; break;
    case "list.move": actual = { listIds: must(board).lists.map((list) => list.id) }; versions = { expectedListOrderVersion: must(summary).listOrderVersion }; break;
    case "card.create": versions = { expectedOrderVersion: must(list).orderVersion }; break;
    case "card.update": actual = pick(must(card), Object.keys(intent.before)); versions = { expectedContentVersion: must(card).contentVersion }; break;
    case "card.archive":
    case "card.delete": actual = { card: must(board).tasks.find((task) => task.id === fields.cardId) }; versions = { expectedContentVersion: must(card).contentVersion, expectedPlacementVersion: must(card).placementVersion }; break;
    case "card.move": {
      actual = pick(must(card), ["listId", "order"]);
      const source = must(loaded?.lists.find((list) => list.id === fields.sourceListId));
      const destination = must(loaded?.lists.find((list) => list.id === fields.destinationListId));
      versions = { expectedPlacementVersion: must(card).placementVersion, expectedOrderVersions: { [source.id]: source.orderVersion, [destination.id]: destination.orderVersion } }; break;
    }
  }
  if (!same(actual, intent.before)) throw new BrowserSyncError("conflict", "This item changed elsewhere. Your edit is kept here; export it or discard this edit to use the current item.");
  const parsed = kanbanOperationSchema.safeParse({ contractVersion: 2, operationId: intent.id, epoch: profile.epoch, boardKey: intent.boardKey, ...fields, ...versions });
  if (!parsed.success) throw new BrowserSyncError("invalid", "This edit exceeds the supported limits. Export the draft or shorten it before retrying.");
  return parsed.data;
}

export function projectIntents(boards: Board[], activeBoardId: string, intents: EditIntent[]): BoardState {
  let state = { boards, activeBoardId };
  for (const intent of intents) {
    if (intent.acknowledged || intent.action.type === "recoverTask") continue;
    if (intent.fields.type === "board.import") {
      const board = intent.fields.board as Board;
      state = { boards: [...state.boards.filter((item) => item.id !== board.id), board], activeBoardId: board.id };
      continue;
    }
    const active = state.activeBoardId;
    if (intent.action.type !== "createBoard" && !state.boards.some((board) => board.id === intent.boardId)) continue;
    if (intent.draft) state.boards = state.boards.map((board) => board.id === intent.boardId && !board.tasks.some((card) => card.id === intent.draft!.id) ? { ...board, tasks: [...board.tasks, intent.draft!] } : board);
    state = boardReducer({ ...state, activeBoardId: intent.boardId }, intent.action);
    if (!["selectBoard", "createBoard", "deleteActiveBoard"].includes(intent.action.type)) state.activeBoardId = active;
  }
  return state;
}
