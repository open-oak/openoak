"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ChevronDown, ChevronUp, Trash2, X } from "lucide-react";
import type { KanbanList, Task, TaskColorId } from "@/lib/kanban-data";
import type { TaskPosition } from "@/lib/kanban-board";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "./confirm-dialog";

const taskPriorities: { id: TaskColorId | null; label: string }[] = [
  { id: null, label: "No priority" },
  { id: "green", label: "Low" },
  { id: "yellow", label: "Medium" },
  { id: "red", label: "High" },
];

export function TaskDetailDialog({
  task,
  lists,
  position,
  onClose,
  onUpdate,
  onDelete,
  onMoveWithinList,
  recoverable = false,
  archived,
}: {
  recoverable?: boolean;
  archived?: { at: string; busy: boolean; onRestore: () => void; onDelete?: () => void; returnFocus: () => void };
  task: Task | null;
  lists: KanbanList[];
  position: TaskPosition | null;
  onClose: () => void;
  onUpdate: (taskId: string, updates: Partial<Task>) => void;
  onDelete: (taskId: string) => void;
  onMoveWithinList: (taskId: string, offset: number) => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!task || task.title.trim()) return;
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [task]);

  if (!task) return null;

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open && !deleteOpen) onClose(); }}>
        <DialogContent
          showCloseButton={false}
          onCloseAutoFocus={(event) => { event.preventDefault(); archived?.returnFocus(); }}
          className="kanban-mobile-viewport-dialog inset-0 m-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-[var(--solid-card)] p-0 ring-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:m-auto sm:h-auto sm:min-h-[480px] sm:max-h-[85vh] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:ring-1 sm:ring-foreground/10"
        >
          <DialogHeader className="kanban-mobile-dialog-header flex-row items-center justify-between gap-3 border-b bg-card p-4 text-left">
            <DialogTitle className="text-base font-semibold">{archived ? "Archived card" : "Edit task details"}</DialogTitle>
            <DialogDescription className="sr-only">{archived ? "View this archived card, restore it, or delete it permanently." : "Edit the title, notes, due date, list, and priority."}</DialogDescription>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close task details" className="kanban-mobile-icon-target shrink-0">
              <X className="size-5 text-muted-foreground" aria-hidden="true" />
            </Button>
          </DialogHeader>

          <div className="kanban-mobile-dialog-body min-h-0 flex-1 space-y-5 overflow-y-auto bg-card p-4">
            {archived && <p className="text-xs text-muted-foreground">Archived <time dateTime={archived.at}>{new Date(archived.at).toLocaleString()}</time></p>}
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Title
              <Input
                ref={titleRef}
                readOnly={Boolean(archived)}
                value={task.title}
                onChange={(event) => onUpdate(task.id, { title: event.target.value })}
                className="h-11 text-base font-semibold normal-case tracking-normal sm:text-sm"
                placeholder="Task title"
                maxLength={255}
              />
            </label>

            <label className="grid gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notes
              <Textarea
                readOnly={Boolean(archived)}
                value={task.description}
                onChange={(event) => onUpdate(task.id, { description: event.target.value })}
                className="min-h-36 text-base font-normal normal-case tracking-normal sm:text-sm"
                placeholder="Add notes, links, or context"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Due date
                <Input
                  type="date"
                  readOnly={Boolean(archived)}
                  value={task.dueDate}
                  onChange={(event) => onUpdate(task.id, { dueDate: event.target.value })}
                  className="h-11 text-base font-normal normal-case tracking-normal sm:text-sm"
                />
              </label>
              <div className="grid gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                List
                {archived ? <p className="py-3 text-sm font-normal normal-case tracking-normal">{lists.find((list) => list.id === task.listId)?.name ?? "Original list removed"}</p> : <Select value={task.listId} onValueChange={(listId) => onUpdate(task.id, { listId })}>
                  <SelectTrigger className="task-list-select h-11 w-full text-base font-normal normal-case tracking-normal sm:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map((list) => (
                      <SelectItem value={list.id} key={list.id}>{list.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>}
              </div>
            </div>

            {!archived && position && (
              <div className="task-position-control grid gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Position
                <div className="flex items-center gap-2 rounded-lg border p-2 normal-case tracking-normal">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className="kanban-mobile-icon-target"
                    onClick={() => onMoveWithinList(task.id, -1)}
                    disabled={position.index === 0}
                    aria-label={`Move ${task.title.trim() || "Untitled task"} up in ${position.listName}`}
                  >
                    <ChevronUp className="size-4" aria-hidden="true" />
                  </Button>
                  <span className="min-w-0 flex-1 text-center text-sm font-medium text-muted-foreground" aria-live="polite">
                    {position.index + 1} of {position.total} in {position.listName}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-lg"
                    className="kanban-mobile-icon-target"
                    onClick={() => onMoveWithinList(task.id, 1)}
                    disabled={position.index >= position.total - 1}
                    aria-label={`Move ${task.title.trim() || "Untitled task"} down in ${position.listName}`}
                  >
                    <ChevronDown className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )}

            <div className="grid gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Priority
              {archived ? <p className="text-sm font-normal normal-case tracking-normal">{taskPriorities.find((priority) => priority.id === task.color)?.label}</p> : <div className="task-color-picker" role="group" aria-label="Task priority">
                {taskPriorities.map((priority) => (
                  <button
                    key={priority.id || "none"}
                    type="button"
                    className={cn("task-color-option", task.color === priority.id && "selected")}
                    data-task-color={priority.id || "none"}
                    onClick={() => onUpdate(task.id, { color: priority.id })}
                    aria-pressed={task.color === priority.id}
                  >
                    <span className="task-color-dot" aria-hidden="true" />
                    {priority.label}
                  </button>
                ))}
              </div>}
            </div>

            {archived ? <div className="flex flex-wrap gap-2"><Button disabled={archived.busy} onClick={archived.onRestore}>Restore to board</Button>{archived.onDelete && <Button variant="ghost" disabled={archived.busy} onClick={archived.onDelete}>Delete</Button>}</div> : <Button type="button" variant={recoverable ? "outline" : "destructive"} className="h-11 w-full" onClick={() => { if (recoverable) { onDelete(task.id); onClose(); } else setDeleteOpen(true); }}>
              {recoverable ? <Archive className="size-4" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
              {recoverable ? "Archive" : "Delete task"}
            </Button>}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete task?"
        message={`Delete “${task.title.trim() || "Untitled task"}”. This cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          onDelete(task.id);
          setDeleteOpen(false);
          onClose();
        }}
      />
    </>
  );
}
