"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, useRef, useCallback, useEffect } from "react";
import { addTask, createBlankTask } from "@/app/actions";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Task } from "@/lib/types";
import { toast } from "sonner";
import { addTaskInlineBarClass, addTaskMobileButtonClass } from "@/components/task-card-style";

interface AddTaskBarProps {
  listId: string;
  isMyDay?: boolean;
  isImportant?: boolean;
  isPlanned?: boolean;
}

export default function AddTaskBar({ listId, isMyDay, isImportant, isPlanned }: AddTaskBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const createInFlightRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const glassEnabled = useAppStore((s) => s.glassEnabled);
  const addTaskOptimistic = useAppStore((s) => s.addTaskOptimistic);
  const commitTask = useAppStore((s) => s.commitTask);
  const rollbackTask = useAppStore((s) => s.rollbackTask);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);

  const handleQuickAddAction = useCallback(async (formData: FormData) => {
    const title = (formData.get("title") as string)?.trim() || "";
    if (!title) return;

    formData.set("title", title.slice(0, 255));

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let optimisticDueDate: Date | null = null;

    if (isPlanned) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(13, 0, 0, 0);
      formData.set("dueDate", tomorrow.toISOString());
      optimisticDueDate = tomorrow;
    }

    const optimisticTask: Task = {
      id: tempId,
      title,
      notes: null,
      isCompleted: false,
      isImportant: Boolean(isImportant),
      isMyDay: Boolean(isMyDay),
      listId,
      dueDate: optimisticDueDate,
      sortOrder: 2147483647,
      subtasks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    addTaskOptimistic(optimisticTask);
    formRef.current?.reset();

    try {
      const created = await addTask(formData);
      if (created && "error" in created) {
        toast.error(created.error);
        rollbackTask(tempId);
      } else if (created?.id) {
        commitTask(tempId, {
          ...optimisticTask,
          id: created.id,
          createdAt: new Date(created.createdAt),
          updatedAt: new Date(created.updatedAt),
          sortOrder: created.sortOrder,
        });
      } else {
        rollbackTask(tempId);
      }
      router.refresh();
    } catch {
      rollbackTask(tempId);
    }
  }, [isPlanned, isImportant, isMyDay, listId, router, addTaskOptimistic, commitTask, rollbackTask]);

  const handlePlusClick = useCallback(() => {
    if (createInFlightRef.current) return;
    createInFlightRef.current = true;

    let optimisticDueDate: Date | null = null;
    if (isPlanned) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(13, 0, 0, 0);
      optimisticDueDate = tomorrow;
    }

    startTransition(async () => {
      try {
        const taskId = await createBlankTask(listId, isMyDay, isImportant, isPlanned);
        if (!taskId) {
          toast.error("Failed to create task");
          return;
        }

        const now = new Date();
        addTaskOptimistic({
          id: taskId,
          title: "",
          notes: null,
          isCompleted: false,
          isImportant: Boolean(isImportant),
          isMyDay: Boolean(isMyDay),
          listId,
          dueDate: optimisticDueDate,
          sortOrder: 2147483647,
          subtasks: [],
          createdAt: now,
          updatedAt: now,
        });
        setSelectedTaskId(taskId);
      } catch {
        toast.error("Failed to create task");
      } finally {
        createInFlightRef.current = false;
      }
    });
  }, [listId, isMyDay, isImportant, isPlanned, startTransition, addTaskOptimistic, setSelectedTaskId]);

  useEffect(() => {
    const handler = () => handlePlusClick();
    window.addEventListener("create-new-task", handler);
    return () => window.removeEventListener("create-new-task", handler);
  }, [handlePlusClick]);

  return (
    <div className="w-full flex items-center gap-3">
        {/* Mobile: floating round button */}
        <Button
          type="button"
          onClick={handlePlusClick}
          disabled={isPending}
          size="lg"
          aria-label="Create new task"
          className={addTaskMobileButtonClass(glassEnabled)}
        >
          <Plus className="w-10 h-10" strokeWidth={3} />
        </Button>

        {/* Desktop: inline bar */}
        <div className={addTaskInlineBarClass(glassEnabled)}>
          <Button
            type="button"
            onClick={handlePlusClick}
            disabled={isPending}
            variant="ghost"
            size="icon"
            className="mr-2 h-8 w-8 hover:bg-muted/80"
            title="Create detailed task"
          >
            <Plus className="w-4.5 h-4.5 text-black dark:text-white" strokeWidth={2.5} />
          </Button>
          <form ref={formRef} action={handleQuickAddAction} className="flex-1">
            {isMyDay && <input type="hidden" name="isMyDay" value="true" />}
            {isImportant && <input type="hidden" name="isImportant" value="true" />}
            <input type="hidden" name="listId" value={listId} />
            <Input
              type="text"
              name="title"
              placeholder="Add a task"
              autoComplete="off"
              maxLength={255}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
              className="border-0 bg-transparent dark:bg-transparent shadow-none focus-visible:ring-0 text-[14.5px] h-8 placeholder:text-muted-foreground"
            />
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        </div>
    </div>
  );
}
