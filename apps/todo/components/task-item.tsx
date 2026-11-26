"use client";

import { Star, Circle, CheckCircle2, Calendar, Sun, StickyNote, ListChecks } from "lucide-react";
import { toggleTask, toggleImportant } from "@/app/actions";
import { useOptimistic, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { playTaskCompleteSound } from "@/lib/sounds";
import type { Task } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppStore } from "@/store/app-store";
import { toast } from "sonner";
import { taskItemClass } from "@/components/task-card-style";

interface TaskItemProps {
  task: Task;
  isSelected?: boolean;
  onSelect?: (taskId: string) => void;
  isMultiSelectMode?: boolean;
  isMultiSelected?: boolean;
  onToggleMultiSelect?: (taskId: string, event?: React.MouseEvent<HTMLDivElement>) => void;
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  touchProps?: Pick<React.HTMLAttributes<HTMLDivElement>, "onTouchStart" | "onTouchMove" | "onTouchEnd">;
  isDragging?: boolean;
}

export default function TaskItem({
  task,
  isSelected,
  onSelect,
  isMultiSelectMode = false,
  isMultiSelected = false,
  onToggleMultiSelect,
  dragProps,
  touchProps,
  isDragging = false,
}: TaskItemProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const updateTaskOptimistic = useAppStore((s) => s.updateTaskOptimistic);
  const finishTaskMutation = useAppStore((s) => s.finishTaskMutation);
  const soundEnabled = useAppStore((s) => s.soundEnabled);
  const glassEnabled = useAppStore((s) => s.glassEnabled);

  const [optimisticTask, addOptimistic] = useOptimistic(
    task,
    (currentTask: Task, update: Partial<Task>) => ({ ...currentTask, ...update })
  );

  const toggleCompleted = useCallback(() => {
    const previousCompleted = optimisticTask.isCompleted;
    const newCompleted = !previousCompleted;
    if (newCompleted && soundEnabled) playTaskCompleteSound();
    const mutationVersion = updateTaskOptimistic(task.id, { isCompleted: newCompleted });
    startTransition(async () => {
      addOptimistic({ isCompleted: newCompleted });
      const result = await toggleTask(task.id, newCompleted);
      if (result?.error) {
        addOptimistic({ isCompleted: previousCompleted });
        toast.error(result.error);
      }
      finishTaskMutation(task.id, !result?.error, mutationVersion);
      router.refresh();
    });
  }, [optimisticTask.isCompleted, startTransition, addOptimistic, task.id, updateTaskOptimistic, finishTaskMutation, soundEnabled, router]);

  const handleSelect = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isMultiSelectMode) {
      onToggleMultiSelect?.(task.id, event);
      return;
    }
    onSelect?.(task.id);
  };

  const hasMeta = Boolean(
    task.dueDate ||
    task.isMyDay ||
    (task.subtasks && task.subtasks.length > 0) ||
    task.notes
  );

  const showMeta = !optimisticTask.isCompleted && hasMeta;

  return (
    <div
      onClick={handleSelect}
      {...dragProps}
      {...touchProps}
      className={taskItemClass({ glassEnabled, isSelected, isMultiSelected, isDragging })}
    >
      {isMultiSelectMode ? (
        // Checkbox is itself a <button>; use a <div> wrapper to avoid button-in-button
        <div className="mr-4 flex-shrink-0">
          <Checkbox checked={isMultiSelected} className="h-6 w-6 border-2" />
        </div>
      ) : (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCompleted();
          }}
          aria-label={optimisticTask.isCompleted ? "Mark as incomplete" : "Mark as complete"}
          className="mr-4 flex-shrink-0"
        >
          {optimisticTask.isCompleted ? (
            <CheckCircle2 className="w-6 h-6 text-accent" aria-hidden="true" />
          ) : (
            <Circle className="w-6 h-6 text-muted-foreground/40 hover:text-foreground transition-colors" aria-hidden="true" />
          )}
        </button>
      )}

      <button
        type="button"
        className={cn("flex-1 min-w-0 text-left", !showMeta && "flex items-center")}
        aria-label={isMultiSelectMode ? `${isMultiSelected ? "Deselect" : "Select"} ${task.title}` : `Open ${task.title}`}
        aria-pressed={isMultiSelectMode ? isMultiSelected : undefined}
        onClick={(event) => {
          event.stopPropagation();
          if (isMultiSelectMode) onToggleMultiSelect?.(task.id);
          else onSelect?.(task.id);
        }}
      >
        <span
          className={cn(
            "text-[15px] leading-6 font-medium tracking-[-0.01em] transition-all block whitespace-normal break-words",
            optimisticTask.isCompleted
              ? "text-foreground line-through"
              : "text-foreground"
          )}
        >
          {task.title}
        </span>
        {showMeta && (
          <div className="flex items-center gap-2.5 mt-1.25 flex-wrap">
            {task.isMyDay && (
              <span className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground/80">
                <Sun className="w-3.5 h-3.5" /> My Day
              </span>
            )}
            {task.subtasks && task.subtasks.length > 0 && (
              <span className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground/75">
                <ListChecks className="w-3.5 h-3.5" />
                {task.subtasks.filter((s) => s.isCompleted).length} of {task.subtasks.length}
              </span>
            )}
            {task.dueDate && (() => {
              const due = new Date(task.dueDate);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const tomorrow = new Date(today);
              tomorrow.setDate(tomorrow.getDate() + 1);
              due.setHours(0, 0, 0, 0);
              const isOverdue = due < today;
              const isToday = due.getTime() === today.getTime();
              const isTomorrow = due.getTime() === tomorrow.getTime();
              let label = due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              if (isToday) label = "Today";
              if (isTomorrow) label = "Tomorrow";
              return (
                <span className={cn(
                  "flex items-center gap-1 text-[12px] font-medium",
                  isOverdue ? "text-destructive" : isToday ? "text-primary" : "text-muted-foreground/80"
                )}>
                  <Calendar className="w-3.5 h-3.5" /> {label}
                </span>
              );
            })()}
            {task.notes && (
              <span className="flex items-center text-[12px] text-muted-foreground/65">
                <StickyNote className="w-3.5 h-3.5" />
              </span>
            )}
          </div>
        )}
      </button>

      {!isMultiSelectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            const previousImportant = optimisticTask.isImportant;
            const newImportant = !previousImportant;
            const mutationVersion = updateTaskOptimistic(task.id, { isImportant: newImportant });
            startTransition(async () => {
              addOptimistic({ isImportant: newImportant });
              const result = await toggleImportant(task.id, newImportant);
              if (result?.error) {
                addOptimistic({ isImportant: previousImportant });
                toast.error(result.error);
              }
              finishTaskMutation(task.id, !result?.error, mutationVersion);
              router.refresh();
            });
          }}
          aria-label={optimisticTask.isImportant ? "Remove importance" : "Mark as important"}
          className={cn(
            "ml-4 transition-[transform,color,opacity] duration-200 hover:scale-110",
            optimisticTask.isImportant
              ? "text-foreground"
              : "text-muted-foreground/40 opacity-100 group-hover:opacity-100 hover:text-foreground"
          )}
        >
          <Star aria-hidden="true" className={cn("w-6 h-6", optimisticTask.isImportant && "fill-current")} />
        </button>
      )}
    </div>
  );
}
