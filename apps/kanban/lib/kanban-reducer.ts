import {
  addList,
  addTask,
  createBoard,
  createList,
  deleteList,
  deleteTask,
  moveTaskRelativeToTask,
  moveTaskToIndex,
  moveTaskToList,
  renameBoard,
  reorderLists,
  shiftTaskAcrossLists,
  shiftTaskWithinList,
  updateList,
  updateTask,
  type DropPosition,
} from "./kanban-board.ts";
import { starterBoards, type Board, type BoardAppearance, type KanbanList, type ListColorId, type ListIconId, type Task } from "./kanban-data.ts";

/**
 * One reducer owns every board mutation. Before this, board state was edited
 * from a dozen component callbacks, so a rule such as "deleting a list moves
 * its tasks" existed only inside a handler and could not be tested. Board-scoped
 * actions here apply to the active board; the rest replace or select boards.
 */

export type BoardState = {
  boards: Board[];
  activeBoardId: string;
};

export type BoardAction =
  | { type: "replaceState"; boards: Board[]; activeBoardId: string }
  | { type: "selectBoard"; boardId: string }
  | { type: "createBoard"; id: string; name: string }
  | { type: "renameActiveBoard"; name: string }
  | { type: "updateBoardAppearance"; updates: Partial<BoardAppearance> }
  | { type: "deleteActiveBoard"; replacementId: string; resetOwned?: boolean }
  | { type: "createList"; id: string; name: string; color: ListColorId; icon?: ListIconId }
  | { type: "updateList"; listId: string; updates: Partial<KanbanList> }
  | { type: "deleteList"; listId: string }
  | { type: "reorderLists"; draggedId: string; targetId: string }
  | { type: "addTask"; listId: string; id: string; title: string }
  | { type: "updateTask"; taskId: string; updates: Partial<Task> }
  | { type: "deleteTask"; taskId: string }
  | { type: "moveTaskToList"; taskId: string; listId: string }
  | { type: "moveTaskToIndex"; taskId: string; listId: string; index: number }
  | { type: "moveTaskRelativeToTask"; taskId: string; targetTaskId: string; position: DropPosition }
  | { type: "shiftTaskWithinList"; taskId: string; offset: number }
  | { type: "shiftTaskAcrossLists"; taskId: string; offset: number };

export function activeBoardOf(state: BoardState): Board {
  return state.boards.find((board) => board.id === state.activeBoardId) || state.boards[0] || starterBoards[0];
}

function withActiveBoard(state: BoardState, updater: (board: Board) => Board): BoardState {
  const active = activeBoardOf(state);
  const next = updater(active);
  if (next === active) return state;
  return { ...state, boards: state.boards.map((board) => (board.id === active.id ? next : board)) };
}

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "replaceState": {
      const boards = action.boards.length ? action.boards : starterBoards.map((board) => ({ ...board }));
      const activeBoardId = boards.some((board) => board.id === action.activeBoardId) ? action.activeBoardId : boards[0].id;
      return { boards, activeBoardId };
    }

    case "selectBoard":
      if (!state.boards.some((board) => board.id === action.boardId)) return state;
      return { ...state, activeBoardId: action.boardId };

    case "createBoard": {
      const board = createBoard(action.id, action.name);
      return { boards: [...state.boards, board], activeBoardId: board.id };
    }

    case "renameActiveBoard":
      return withActiveBoard(state, (board) => renameBoard(board, action.name));

    case "updateBoardAppearance":
      return withActiveBoard(state, (board) => ({ ...board, ...action.updates }));

    case "deleteActiveBoard": {
      // The last board is reset rather than removed: the app always has a board.
      if (state.boards.length <= 1 || action.resetOwned) {
        const replacement = createBoard(action.replacementId, "Main board");
        return { boards: [...state.boards.filter((board) => board.id !== state.activeBoardId), replacement], activeBoardId: replacement.id };
      }
      const activeIndex = state.boards.findIndex((board) => board.id === state.activeBoardId);
      const boards = state.boards.filter((board) => board.id !== state.activeBoardId);
      return { boards, activeBoardId: boards[Math.max(0, activeIndex - 1)]?.id || boards[0].id };
    }

    case "createList":
      return withActiveBoard(state, (board) => addList(board, createList(action.id, action.name, action.color, action.icon)));

    case "updateList":
      return withActiveBoard(state, (board) => updateList(board, action.listId, action.updates));

    case "deleteList":
      return withActiveBoard(state, (board) => deleteList(board, action.listId));

    case "reorderLists":
      return withActiveBoard(state, (board) => reorderLists(board, action.draggedId, action.targetId));

    case "addTask":
      return withActiveBoard(state, (board) => addTask(board, action.listId, action.id, action.title));

    case "updateTask":
      return withActiveBoard(state, (board) => updateTask(board, action.taskId, action.updates));

    case "deleteTask":
      return withActiveBoard(state, (board) => deleteTask(board, action.taskId));

    case "moveTaskToList":
      return withActiveBoard(state, (board) => moveTaskToList(board, action.taskId, action.listId));

    case "moveTaskToIndex":
      return withActiveBoard(state, (board) => moveTaskToIndex(board, action.taskId, action.listId, action.index));

    case "moveTaskRelativeToTask":
      return withActiveBoard(state, (board) => moveTaskRelativeToTask(board, action.taskId, action.targetTaskId, action.position));

    case "shiftTaskWithinList":
      return withActiveBoard(state, (board) => shiftTaskWithinList(board, action.taskId, action.offset));

    case "shiftTaskAcrossLists":
      return withActiveBoard(state, (board) => shiftTaskAcrossLists(board, action.taskId, action.offset));

    default:
      return state;
  }
}
