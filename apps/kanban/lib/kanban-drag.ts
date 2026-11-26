import type { DropPosition } from "./kanban-board.ts";

/**
 * Geometry for card drops, kept out of the components so both drag paths
 * (HTML5 drag events on desktop, pointer events for pen and touch) resolve a
 * drop the same way and can be tested without a DOM.
 */

export type DropRect = { top: number; height: number };

export type DropTarget = {
  listId: string;
  /** null means "the end of the list": released over list background. */
  taskId: string | null;
  position: DropPosition;
};

/** Above a card's midpoint inserts before it, below inserts after. */
export function dropPositionFromRect(rect: DropRect, clientY: number): DropPosition {
  return clientY < rect.top + rect.height / 2 ? "before" : "after";
}

/**
 * Resolves what a release at this point means. Hovering the dragged card
 * itself is not a target, and a point outside any list is not a drop at all.
 */
export function resolveDropTarget(input: {
  draggedTaskId: string;
  overTaskId?: string | null;
  overListId?: string | null;
  rect?: DropRect | null;
  clientY?: number;
}): DropTarget | null {
  const { draggedTaskId, overTaskId, overListId, rect, clientY } = input;

  if (overTaskId && overTaskId !== draggedTaskId && rect && typeof clientY === "number") {
    return {
      listId: overListId || "",
      taskId: overTaskId,
      position: dropPositionFromRect(rect, clientY),
    };
  }

  if (overListId) return { listId: overListId, taskId: null, position: "after" };
  return null;
}
