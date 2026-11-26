"use client";

import { Calendar, StickyNote } from "lucide-react";
import type { DropPosition } from "@/lib/kanban-board";
import type { Task } from "@/lib/kanban-data";
import { dropPositionFromRect } from "@/lib/kanban-drag";
import { cn } from "@/lib/utils";

function dueDateMeta(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { label: value, timing: "upcoming" as const };

  const due = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    due.getFullYear() !== Number(match[1]) ||
    due.getMonth() !== Number(match[2]) - 1 ||
    due.getDate() !== Number(match[3])
  ) {
    return { label: value, timing: "upcoming" as const };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (due < today) return { label: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }), timing: "overdue" as const };
  if (due.getTime() === today.getTime()) return { label: "Today", timing: "today" as const };
  if (due.getTime() === tomorrow.getTime()) return { label: "Tomorrow", timing: "upcoming" as const };
  return { label: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }), timing: "upcoming" as const };
}

export type TaskDragHandlers = {
  onDragStart: (event: React.DragEvent<HTMLElement>, taskId: string) => void;
  onDragEnd: () => void;
  onDragOverCard: (event: React.DragEvent<HTMLElement>, taskId: string) => void;
  onDropOnCard: (event: React.DragEvent<HTMLElement>, taskId: string) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>, taskId: string) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
};

/** Drop position of a drag event over the card it is currently on. */
export function dropPositionFor(event: React.DragEvent<HTMLElement>): DropPosition {
  return dropPositionFromRect(event.currentTarget.getBoundingClientRect(), event.clientY);
}

export function TaskCard({
  task,
  index,
  total,
  listName,
  dragging,
  dropIndicator,
  drag,
  onOpen,
  onMove,
}: {
  task: Task;
  index: number;
  total: number;
  listName: string;
  dragging: boolean;
  dropIndicator: DropPosition | null;
  drag: TaskDragHandlers;
  onOpen: (taskId: string) => void;
  /** axis "vertical" reorders inside the list, "horizontal" moves between lists. */
  onMove: (taskId: string, axis: "vertical" | "horizontal", offset: number) => void;
}) {
  const displayTitle = task.title.trim() || "Untitled task";
  const due = task.dueDate ? dueDateMeta(task.dueDate) : null;

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      onOpen(task.id);
      return;
    }

    // Alt keeps plain arrows free for scrolling and browser shortcuts.
    if (!event.altKey) return;
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const horizontal = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!vertical && !horizontal) return;

    event.preventDefault();
    event.stopPropagation();
    onMove(task.id, vertical ? "vertical" : "horizontal", vertical || horizontal);
  }

  return (
    <article
      data-task-id={task.id}
      data-task-color={task.color || undefined}
      role="listitem"
      tabIndex={0}
      aria-label={`${displayTitle}. ${index + 1} of ${total} in ${listName}. Alt with arrow keys moves this task.`}
      className={cn(
        "task-card",
        dragging && "task-card-dragging",
        dropIndicator === "before" && "task-card-drop-before",
        dropIndicator === "after" && "task-card-drop-after"
      )}
      draggable
      onDragStart={(event) => drag.onDragStart(event, task.id)}
      onDragEnd={drag.onDragEnd}
      onDragOver={(event) => drag.onDragOverCard(event, task.id)}
      onDrop={(event) => drag.onDropOnCard(event, task.id)}
      onPointerDown={(event) => drag.onPointerDown(event, task.id)}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      onKeyDown={onKeyDown}
      onClick={() => onOpen(task.id)}
    >
      <div className="task-card-title">
        <p className={cn(!task.title.trim() && "task-card-title-placeholder")}>{displayTitle}</p>
      </div>
      {(task.description || task.dueDate) && (
        <div className="task-meta">
          {due && (
            <span
              className={cn(
                "task-meta-item task-meta-date",
                due.timing === "today" && "task-meta-date-today",
                due.timing === "overdue" && "task-meta-date-overdue"
              )}
              title={`Due ${task.dueDate}`}
            >
              <Calendar className="task-meta-icon" aria-hidden="true" />
              {due.label}
            </span>
          )}
          {task.description && (
            <span className="task-meta-item task-meta-notes" aria-label="Has notes" title="Has notes">
              <StickyNote className="task-meta-icon" aria-hidden="true" />
            </span>
          )}
        </div>
      )}
    </article>
  );
}
