import {
  defaultBoardAppearance,
  defaultLists,
  normalizeTaskOrder,
  tasksForList,
  type Board,
  type KanbanList,
  type ListColorId,
  type ListIconId,
  type Task,
} from "./kanban-data.ts";

/**
 * Pure board mutations. Every function takes a board and returns a board;
 * nothing here touches React, storage, or the network, so the rules that decide
 * where a task ends up are testable on their own.
 *
 * Returning the same board reference when nothing changed lets callers skip
 * renders and keeps sync from marking a no-op as a pending change.
 */

export type DropPosition = "before" | "after";

export type TaskPosition = {
  listId: string;
  listName: string;
  index: number;
  total: number;
};

/** Rebuilds a board's task array from per-list buckets, renumbering order. */
function withTaskGroups(board: Board, groups: Map<string, Task[]>): Board {
  const tasks: Task[] = [];
  for (const list of board.lists) {
    const bucket = groups.get(list.id) || [];
    bucket.forEach((task, index) => {
      tasks.push(task.order === index && task.listId === list.id ? task : { ...task, listId: list.id, order: index });
    });
  }
  return { ...board, tasks };
}

/** Current display order of every list, keyed by list id. */
function taskGroups(board: Board): Map<string, Task[]> {
  const groups = new Map<string, Task[]>(board.lists.map((list) => [list.id, []]));
  for (const task of board.tasks) {
    const bucket = groups.get(task.listId) || groups.get(board.lists[0]?.id || "");
    if (bucket) bucket.push(task);
  }
  for (const bucket of groups.values()) bucket.sort((left, right) => left.order - right.order);
  return groups;
}

export function createBoard(id: string, name: string): Board {
  return { id, name, ...defaultBoardAppearance, lists: defaultLists.map((list) => ({ ...list })), tasks: [] };
}

export function renameBoard(board: Board, name: string): Board {
  return { ...board, name };
}

export function addList(board: Board, list: KanbanList): Board {
  return { ...board, lists: [...board.lists, list] };
}

export function createList(id: string, name: string, color: ListColorId, icon: ListIconId = "todo"): KanbanList {
  return { id, name, color, icon };
}

export function updateList(board: Board, listId: string, updates: Partial<KanbanList>): Board {
  if (!board.lists.some((list) => list.id === listId)) return board;
  return {
    ...board,
    lists: board.lists.map((list) => (list.id === listId ? { ...list, ...updates, name: updates.name ?? list.name } : list)),
  };
}

/**
 * Deletes a list and appends its tasks to the end of the fallback list rather
 * than interleaving them, so the surviving list keeps its own order intact.
 * The last remaining list is never deleted.
 */
export function deleteList(board: Board, listId: string): Board {
  if (board.lists.length <= 1) return board;
  const fallbackList = board.lists.find((list) => list.id !== listId);
  if (!fallbackList || !board.lists.some((list) => list.id === listId)) return board;

  const groups = taskGroups(board);
  const moved = groups.get(listId) || [];
  groups.set(fallbackList.id, [...(groups.get(fallbackList.id) || []), ...moved]);
  groups.delete(listId);

  const next = withTaskGroups({ ...board, lists: board.lists.filter((list) => list.id !== listId) }, groups);
  return next;
}

export function reorderLists(board: Board, draggedId: string, targetId: string): Board {
  if (draggedId === targetId) return board;
  const fromIndex = board.lists.findIndex((list) => list.id === draggedId);
  const toIndex = board.lists.findIndex((list) => list.id === targetId);
  if (fromIndex < 0 || toIndex < 0) return board;

  const lists = [...board.lists];
  const [moved] = lists.splice(fromIndex, 1);
  lists.splice(toIndex, 0, moved);
  // Task order is per list, so moving lists cannot change any task's position.
  return { ...board, lists };
}

export function addTask(board: Board, listId: string, id: string, title: string): Board {
  if (!board.lists.some((list) => list.id === listId)) return board;
  const order = tasksForList(board.tasks, listId).length;
  const task: Task = { id, title, description: "", dueDate: "", color: null, listId, order };
  return { ...board, tasks: [...board.tasks, task] };
}

/**
 * Applies field updates. A list change through this path appends the task to
 * the end of its new list; use `moveTaskToIndex` for a specific slot.
 */
export function updateTask(board: Board, taskId: string, updates: Partial<Task>): Board {
  const current = board.tasks.find((task) => task.id === taskId);
  if (!current) return board;

  const fields: Partial<Task> = { ...updates };
  delete fields.listId;
  delete fields.order;

  const nextListId = updates.listId ?? current.listId;
  if (nextListId !== current.listId) {
    return applyTaskFields(moveTaskToList(board, taskId, nextListId), taskId, fields);
  }

  return applyTaskFields(board, taskId, fields);
}

function applyTaskFields(board: Board, taskId: string, updates: Partial<Task>): Board {
  if (Object.keys(updates).length === 0) return board;
  return {
    ...board,
    tasks: board.tasks.map((task) => (task.id === taskId ? { ...task, ...updates, title: updates.title ?? task.title } : task)),
  };
}

export function deleteTask(board: Board, taskId: string): Board {
  if (!board.tasks.some((task) => task.id === taskId)) return board;
  const groups = taskGroups(board);
  for (const [listId, bucket] of groups) {
    groups.set(
      listId,
      bucket.filter((task) => task.id !== taskId)
    );
  }
  return withTaskGroups(board, groups);
}

/**
 * Moves a task into `listId` at `index`. The index is interpreted against the
 * target list *after* the task is removed from its current position, which is
 * what makes dropping a card one slot down inside its own list behave the way
 * the pointer suggests. Out-of-range indexes clamp to the ends.
 */
export function moveTaskToIndex(board: Board, taskId: string, listId: string, index: number): Board {
  const task = board.tasks.find((entry) => entry.id === taskId);
  if (!task || !board.lists.some((list) => list.id === listId)) return board;

  const groups = taskGroups(board);
  for (const [bucketListId, bucket] of groups) {
    groups.set(
      bucketListId,
      bucket.filter((entry) => entry.id !== taskId)
    );
  }

  const target = groups.get(listId) || [];
  const safeIndex = Math.max(0, Math.min(Math.trunc(index), target.length));
  if (task.listId === listId && task.order === safeIndex) return board;

  target.splice(safeIndex, 0, task);
  groups.set(listId, target);
  return withTaskGroups(board, groups);
}

/** Appends a task to the end of a list — the plain "drop on the list" case. */
export function moveTaskToList(board: Board, taskId: string, listId: string): Board {
  const target = board.lists.some((list) => list.id === listId) ? listId : null;
  if (!target) return board;
  return moveTaskToIndex(board, taskId, target, tasksForList(board.tasks, target).length);
}

/**
 * Drops a task before or after another card. `targetTaskId` decides both the
 * list and the slot, so a cross-list drop lands exactly where it was released
 * instead of at the end of the list.
 */
export function moveTaskRelativeToTask(board: Board, taskId: string, targetTaskId: string, position: DropPosition): Board {
  if (taskId === targetTaskId) return board;
  const target = board.tasks.find((task) => task.id === targetTaskId);
  if (!target) return board;

  const source = board.tasks.find((task) => task.id === taskId);
  if (!source) return board;

  const siblings = tasksForList(board.tasks, target.listId).filter((task) => task.id !== taskId);
  const targetIndex = siblings.findIndex((task) => task.id === targetTaskId);
  if (targetIndex < 0) return board;

  return moveTaskToIndex(board, taskId, target.listId, position === "before" ? targetIndex : targetIndex + 1);
}

/** Keyboard move up (-1) or down (+1) inside the task's own list. */
export function shiftTaskWithinList(board: Board, taskId: string, offset: number): Board {
  const task = board.tasks.find((entry) => entry.id === taskId);
  if (!task || offset === 0) return board;

  const siblings = tasksForList(board.tasks, task.listId);
  const index = siblings.findIndex((entry) => entry.id === taskId);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) return board;

  return moveTaskToIndex(board, taskId, task.listId, nextIndex);
}

/**
 * Keyboard move to the previous (-1) or next (+1) list, keeping the task at the
 * same depth where possible so a card does not jump to the bottom of the board.
 */
export function shiftTaskAcrossLists(board: Board, taskId: string, offset: number): Board {
  const task = board.tasks.find((entry) => entry.id === taskId);
  if (!task || offset === 0) return board;

  const listIndex = board.lists.findIndex((list) => list.id === task.listId);
  const nextList = board.lists[listIndex + offset];
  if (listIndex < 0 || !nextList) return board;

  const currentIndex = tasksForList(board.tasks, task.listId).findIndex((entry) => entry.id === taskId);
  const targetLength = tasksForList(board.tasks, nextList.id).length;
  return moveTaskToIndex(board, taskId, nextList.id, Math.min(Math.max(currentIndex, 0), targetLength));
}

/** Where a task currently sits, for status text and screen reader messages. */
export function taskPosition(board: Board, taskId: string): TaskPosition | null {
  const task = board.tasks.find((entry) => entry.id === taskId);
  if (!task) return null;
  const list = board.lists.find((entry) => entry.id === task.listId);
  const siblings = tasksForList(board.tasks, task.listId);
  const index = siblings.findIndex((entry) => entry.id === taskId);
  if (!list || index < 0) return null;
  return { listId: list.id, listName: list.name, index, total: siblings.length };
}

export function describeTaskPosition(board: Board, taskId: string): string {
  const position = taskPosition(board, taskId);
  const task = board.tasks.find((entry) => entry.id === taskId);
  if (!position || !task) return "";
  return `${task.title}, ${position.index + 1} of ${position.total} in ${position.listName}`;
}

/** Repairs any board whose tasks came from an untrusted source. */
export function normalizeBoard(board: Board): Board {
  return { ...board, tasks: normalizeTaskOrder(board.tasks, board.lists) };
}
