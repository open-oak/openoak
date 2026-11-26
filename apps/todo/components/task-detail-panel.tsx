"use client";

import { X, Check, Trash2, Plus, Circle, CheckCircle2, Star, Calendar, Sun } from "lucide-react";
import { useTransition, useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import {
  getTask,
  updateTask,
  updateSubtask,
  deleteTask,
  discardBlankTask,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  toggleImportant,
  setDueDate,
  toggleMyDay,
} from "@/app/actions";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { playTaskCompleteSound, playSubtaskCompleteSound } from "@/lib/sounds";
import type { Task } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import ActionRow from "@/components/action-row";

const NOTES_MIN_LINES = 5;
const NOTES_MAX_LINES = 50;
const NOTES_LINE_HEIGHT_PX = 20;
const NOTES_VERTICAL_PADDING_PX = 32;
const NOTES_MIN_HEIGHT_PX = NOTES_MIN_LINES * NOTES_LINE_HEIGHT_PX + NOTES_VERTICAL_PADDING_PX;
const NOTES_MAX_HEIGHT_PX = NOTES_MAX_LINES * NOTES_LINE_HEIGHT_PX + NOTES_VERTICAL_PADDING_PX;

export default function TaskDetailPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);
  const updateTaskInStore = useAppStore((s) => s.updateTaskOptimistic);
  const finishTaskMutation = useAppStore((s) => s.finishTaskMutation);
  const soundEnabled = useAppStore((s) => s.soundEnabled);
  const addTaskOptimistic = useAppStore((s) => s.addTaskOptimistic);
  const removeTask = useAppStore((s) => s.removeTaskOptimistic);

  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [, startTransition] = useTransition();

  // Local editing state
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [optimisticIsCompleted, setOptimisticIsCompleted] = useState(false);
  const [optimisticIsImportant, setOptimisticIsImportant] = useState(false);
  const [optimisticIsMyDay, setOptimisticIsMyDay] = useState(false);
  const [optimisticDueDate, setOptimisticDueDate] = useState<Date | null>(null);
  const [optimisticSubtasks, setOptimisticSubtasks] = useState<Task["subtasks"]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [notesHeight, setNotesHeight] = useState<number | null>(null);

  useEffect(() => {
    const linkedTaskId = searchParams.get("task");
    if (linkedTaskId) setSelectedTaskId(linkedTaskId);
  }, [searchParams, setSelectedTaskId]);

  const notesTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Notes typed but not yet sent, so the page lifecycle can flush them. */
  const pendingNotesRef = useRef<{ taskId: string; notes: string; version: number } | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const notesMeasureRef = useRef<HTMLDivElement>(null);
  const subtaskInputRef = useRef<HTMLTextAreaElement>(null);
  const editingSubtaskRef = useRef<HTMLTextAreaElement>(null);
  const editingSubtaskIdRef = useRef<string | null>(null);
  const subtaskTitleRefs = useRef(new Map<string, HTMLButtonElement>());
  const isDeletingRef = useRef(false);
  const activeFetchIdRef = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const positionTaskDialog = useCallback((dialog: HTMLDivElement | null) => {
    if (!dialog) return;
    const listArea = document.querySelector<HTMLElement>('[data-slot="sidebar-inset"]');
    if (!listArea) return;

    const updateCenter = () => {
      const { left, width } = listArea.getBoundingClientRect();
      dialog.style.setProperty("--task-detail-center", `${left + width / 2}px`);
    };

    updateCenter();
    const observer = new ResizeObserver(updateCenter);
    observer.observe(listArea);
    window.addEventListener("resize", updateCenter);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateCenter);
    };
  }, []);

  useEffect(() => {
    const open = Boolean(selectedTaskId);
    if (open && !wasOpenRef.current && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
    wasOpenRef.current = open;
  }, [selectedTaskId]);

  const hydrateTaskState = useCallback((nextTask: Task) => {
    setTask(nextTask);
    addTaskOptimistic(nextTask);
    setTitle(nextTask.title);
    setNotes(nextTask.notes || "");
    setOptimisticIsCompleted(nextTask.isCompleted);
    setOptimisticIsImportant(nextTask.isImportant);
    setOptimisticIsMyDay(nextTask.isMyDay);
    setOptimisticDueDate(nextTask.dueDate);
    setOptimisticSubtasks(nextTask.subtasks);
    setIsEditingNotes(false);
    setNewSubtask("");
    editingSubtaskIdRef.current = null;
    setEditingSubtaskId(null);
    setEditingSubtaskTitle("");
  }, [addTaskOptimistic]);

  // Fetch task when selectedTaskId changes
  useEffect(() => {
    if (!selectedTaskId) {
      queueMicrotask(() => {
        setTask(null);
        setIsLoading(false);
      });
      return;
    }

    const fetchId = activeFetchIdRef.current + 1;
    activeFetchIdRef.current = fetchId;
    isDeletingRef.current = false;

    const selectedTaskFromStore = useAppStore.getState().tasks.get(selectedTaskId) ?? null;

    if (selectedTaskFromStore) {
      queueMicrotask(() => {
        if (activeFetchIdRef.current !== fetchId) return;
        hydrateTaskState(selectedTaskFromStore);
        setIsLoading(false);
      });
      return;
    } else {
      queueMicrotask(() => {
        setTask(null);
        setIsLoading(true);
      });
    }

    startTransition(async () => {
      const data = await getTask(selectedTaskId);
      if (activeFetchIdRef.current !== fetchId) return;
      if (data) {
        hydrateTaskState(data as Task);
      }
      setIsLoading(false);
    });
  }, [selectedTaskId, startTransition, hydrateTaskState]);

  const adjustTitleHeight = useCallback(() => {
    const textarea = titleRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 24;
    const maxHeight = lineHeight * 4;
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, lineHeight), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    adjustTitleHeight();
  }, [title, adjustTitleHeight]);

  const currentTaskId = task?.id;
  const currentTaskTitle = task?.title ?? "";

  useEffect(() => {
    if (!currentTaskId || currentTaskTitle.trim().length > 0) return;
    const rafId = requestAnimationFrame(() => {
      const textarea = titleRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(0, 0);
    });
    return () => cancelAnimationFrame(rafId);
  }, [currentTaskId, currentTaskTitle]);

  const close = useCallback((forceDiscardBlank = false) => {
    const blankTaskId = !isDeletingRef.current
      && task?.title.trim() === ""
      && (forceDiscardBlank || title.trim() === "")
      ? task.id
      : null;

    if (blankTaskId) {
      isDeletingRef.current = true;
      const mutationVersion = removeTask(blankTaskId);
      startTransition(async () => {
        const result = await discardBlankTask(blankTaskId);
        if (result?.error) toast.error(result.error);
        finishTaskMutation(blankTaskId, !result?.error, mutationVersion);
        router.refresh();
      });
    }

    setSelectedTaskId(null);
    const params = new URLSearchParams(searchParams.toString());
    if (params.has("task")) {
      params.delete("task");
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    }
  }, [task, title, pathname, router, searchParams, setSelectedTaskId, removeTask, startTransition, finishTaskMutation]);

  // Save title on blur
  const saveTitle = useCallback(() => {
    if (isDeletingRef.current || !task) return;
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      const mutationVersion = updateTaskInStore(task.id, { title: trimmed });
      startTransition(async () => {
        const result = await updateTask(task.id, { title: trimmed });
        if (result?.error) {
          setTitle(task.title);
          toast.error(result.error);
        }
        finishTaskMutation(task.id, !result?.error, mutationVersion);
        router.refresh();
      });
    } else if (!trimmed) {
      setTitle(task.title);
    }
  }, [title, task, startTransition, updateTaskInStore, finishTaskMutation, router]);

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveTitle();
      titleRef.current?.blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (task) setTitle(task.title);
      close(task?.title.trim() === "");
    }
  };

  const syncTextareaHeight = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  // Notes with debounce
  const handleNotesChange = (val: string) => {
    if (!task) return;
    setNotes(val);
    const mutationVersion = updateTaskInStore(task.id, { notes: val });
    pendingNotesRef.current = { taskId: task.id, notes: val, version: mutationVersion };
    if (notesTimeoutRef.current) clearTimeout(notesTimeoutRef.current);
    notesTimeoutRef.current = setTimeout(() => {
      if (isDeletingRef.current) return;
      pendingNotesRef.current = null;
      startTransition(async () => {
        const result = await updateTask(task.id, { notes: val });
        if (result?.error) {
          setNotes(task.notes || "");
          toast.error(result.error);
        }
        else setTask((current) => current?.id === task.id ? { ...current, notes: val } : current);
        finishTaskMutation(task.id, !result?.error, mutationVersion);
        router.refresh();
      });
    }, 800);
  };

  const handleNotesBlur = () => {
    setIsEditingNotes(false);
    const pendingVersion = pendingNotesRef.current?.version;
    pendingNotesRef.current = null;
    if (notesTimeoutRef.current) {
      clearTimeout(notesTimeoutRef.current);
      notesTimeoutRef.current = null;
    }
    if (isDeletingRef.current || !task) return;
    if (notes !== (task.notes || "")) {
      startTransition(async () => {
        const result = await updateTask(task.id, { notes });
        if (result?.error) {
          setNotes(task.notes || "");
          toast.error(result.error);
        }
        else setTask((current) => current?.id === task.id ? { ...current, notes } : current);
        finishTaskMutation(task.id, !result?.error, pendingVersion);
        router.refresh();
      });
    }
  };

  useEffect(() => {
    if (!isEditingNotes) return;
    const rafId = requestAnimationFrame(() => {
      const textarea = notesRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    return () => cancelAnimationFrame(rafId);
  }, [isEditingNotes]);

  /**
   * Notes save on an 800 ms debounce and otherwise only flush on blur. Hiding
   * the tab does not blur a focused textarea on mobile, so without this the
   * last few hundred milliseconds of typing are lost when the user switches
   * apps or closes the tab.
   */
  useEffect(() => {
    const flushPendingNotes = () => {
      const pending = pendingNotesRef.current;
      if (!pending || isDeletingRef.current) return;
      pendingNotesRef.current = null;
      if (notesTimeoutRef.current) {
        clearTimeout(notesTimeoutRef.current);
        notesTimeoutRef.current = null;
      }
      void updateTask(pending.taskId, { notes: pending.notes }).then((result) => {
        finishTaskMutation(pending.taskId, !result?.error, pending.version);
      });
    };

    const onHidden = () => {
      if (document.visibilityState === "hidden") flushPendingNotes();
    };

    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", flushPendingNotes);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flushPendingNotes);
      flushPendingNotes();
    };
  }, [finishTaskMutation]);

  useLayoutEffect(() => {
    syncTextareaHeight(subtaskInputRef.current);
  }, [newSubtask, task?.id, syncTextareaHeight]);

  useLayoutEffect(() => {
    if (!editingSubtaskId) return;
    const textarea = editingSubtaskRef.current;
    if (!textarea) return;
    syncTextareaHeight(textarea);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [editingSubtaskId, syncTextareaHeight]);

  useEffect(() => {
    const steps = subtaskInputRef.current?.parentElement?.parentElement;
    if (!steps || typeof ResizeObserver === "undefined") return;
    let previousWidth = 0;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === previousWidth) return;
      previousWidth = entry.contentRect.width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        syncTextareaHeight(subtaskInputRef.current);
        syncTextareaHeight(editingSubtaskRef.current);
      });
    });
    observer.observe(steps);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [task?.id, syncTextareaHeight]);

  const syncNotesHeight = useCallback(() => {
    const measure = notesMeasureRef.current;
    if (!measure) return;
    const nextHeight = Math.min(Math.max(measure.scrollHeight, NOTES_MIN_HEIGHT_PX), NOTES_MAX_HEIGHT_PX);
    setNotesHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);

  useLayoutEffect(() => {
    syncNotesHeight();
  }, [notes, task?.id, syncNotesHeight]);

  useEffect(() => {
    const measure = notesMeasureRef.current;
    if (!measure || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => syncNotesHeight());
    observer.observe(measure);
    return () => observer.disconnect();
  }, [syncNotesHeight]);

  useEffect(() => {
    return () => {
      if (notesTimeoutRef.current) clearTimeout(notesTimeoutRef.current);
    };
  }, []);

  // Subtasks
  const handleAddSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtask.trim() || !task) return;
    const subtaskTitle = newSubtask.trim();
    const tempSubtask = { id: `temp-${Date.now()}`, title: subtaskTitle, isCompleted: false };
    const nextSubtasks = [...optimisticSubtasks, tempSubtask];
    setOptimisticSubtasks(nextSubtasks);
    const mutationVersion = updateTaskInStore(task.id, { subtasks: nextSubtasks });
    setNewSubtask("");
    startTransition(async () => {
      await addSubtask(task.id, subtaskTitle);
      // Refetch to get real IDs
      const updated = await getTask(task.id);
      if (updated) {
        setOptimisticSubtasks((updated as Task).subtasks);
        useAppStore.getState().updateTaskInStore(task.id, { subtasks: (updated as Task).subtasks });
      }
      finishTaskMutation(task.id, Boolean(updated), mutationVersion);
      router.refresh();
    });
  };

  const handleToggleSubtask = (subId: string, completed: boolean) => {
    if (!completed && soundEnabled) playSubtaskCompleteSound();
    const nextSubtasks = optimisticSubtasks.map((s) =>
      s.id === subId ? { ...s, isCompleted: !completed } : s
    );
    setOptimisticSubtasks(nextSubtasks);
    const mutationVersion = task ? updateTaskInStore(task.id, { subtasks: nextSubtasks }) : 0;
    startTransition(async () => {
      const result = await toggleSubtask(subId, !completed);
      if (result?.error) {
        setOptimisticSubtasks(optimisticSubtasks);
        toast.error(result.error);
      }
      if (task && mutationVersion) finishTaskMutation(task.id, !result?.error, mutationVersion);
      router.refresh();
    });
  };

  const handleDeleteSubtask = (subId: string) => {
    const nextSubtasks = optimisticSubtasks.filter((s) => s.id !== subId);
    setOptimisticSubtasks(nextSubtasks);
    const mutationVersion = task ? updateTaskInStore(task.id, { subtasks: nextSubtasks }) : 0;
    startTransition(async () => {
      const result = await deleteSubtask(subId);
      if (result?.error) {
        setOptimisticSubtasks(optimisticSubtasks);
        toast.error(result.error);
      }
      if (task && mutationVersion) finishTaskMutation(task.id, !result?.error, mutationVersion);
      router.refresh();
    });
  };

  const handleSaveSubtaskTitle = (subId: string) => {
    if (editingSubtaskIdRef.current !== subId) return;
    editingSubtaskIdRef.current = null;
    const trimmed = editingSubtaskTitle.trim();
    setEditingSubtaskId(null);
    if (!trimmed) return;
    const original = optimisticSubtasks.find((s) => s.id === subId);
    if (!original || trimmed === original.title) return;
    const nextSubtasks = optimisticSubtasks.map((s) =>
      s.id === subId ? { ...s, title: trimmed } : s
    );
    setOptimisticSubtasks(nextSubtasks);
    const mutationVersion = task ? updateTaskInStore(task.id, { subtasks: nextSubtasks }) : 0;
    startTransition(async () => {
      const result = await updateSubtask(subId, trimmed);
      if (result?.error) {
        setOptimisticSubtasks(optimisticSubtasks);
        toast.error(result.error);
      }
      if (task && mutationVersion) finishTaskMutation(task.id, !result?.error, mutationVersion);
      router.refresh();
    });
  };

  const startEditingSubtask = (subId: string, subtaskTitle: string) => {
    editingSubtaskIdRef.current = subId;
    setEditingSubtaskId(subId);
    setEditingSubtaskTitle(subtaskTitle);
  };

  // Toggle completion
  const handleToggleCompleted = () => {
    if (!task) return;
    const next = !optimisticIsCompleted;
    if (next && soundEnabled) playTaskCompleteSound();
    setOptimisticIsCompleted(next);
    const mutationVersion = updateTaskInStore(task.id, { isCompleted: next });
    startTransition(async () => {
      const result = await updateTask(task.id, { isCompleted: next });
      if (result?.error) {
        setOptimisticIsCompleted(!next);
        toast.error(result.error);
      }
      finishTaskMutation(task.id, !result?.error, mutationVersion);
      router.refresh();
    });
  };

  // Toggle important
  const handleToggleImportant = () => {
    if (!task) return;
    const next = !optimisticIsImportant;
    setOptimisticIsImportant(next);
    const mutationVersion = updateTaskInStore(task.id, { isImportant: next });
    startTransition(async () => {
      const result = await toggleImportant(task.id, next);
      if (result?.error) {
        setOptimisticIsImportant(!next);
        toast.error(result.error);
      }
      finishTaskMutation(task.id, !result?.error, mutationVersion);
      router.refresh();
    });
  };

  // Toggle My Day
  const handleToggleMyDay = () => {
    if (!task) return;
    const next = !optimisticIsMyDay;
    setOptimisticIsMyDay(next);
    const mutationVersion = updateTaskInStore(task.id, { isMyDay: next });
    startTransition(async () => {
      const result = await toggleMyDay(task.id, next);
      if (result?.error) {
        setOptimisticIsMyDay(!next);
        toast.error(result.error);
      }
      finishTaskMutation(task.id, !result?.error, mutationVersion);
      router.refresh();
    });
  };

  // Set due date
  const handleSetDueDate = (date: Date | null) => {
    if (!task) return;
    const previousDate = optimisticDueDate;
    setOptimisticDueDate(date);
    setDatePickerOpen(false);
    const mutationVersion = updateTaskInStore(task.id, { dueDate: date });
    startTransition(async () => {
      const result = await setDueDate(task.id, date);
      if (result?.error) {
        setOptimisticDueDate(previousDate);
        toast.error(result.error);
      }
      finishTaskMutation(task.id, !result?.error, mutationVersion);
      router.refresh();
    });
  };

  // Delete task
  const handleDelete = () => {
    if (!task) return;
    isDeletingRef.current = true;
    setShowDeleteConfirm(false);
    const mutationVersion = removeTask(task.id);
    close();
    startTransition(async () => {
      const result = await deleteTask(task.id);
      if (result?.error) toast.error(result.error);
      finishTaskMutation(task.id, !result?.error, mutationVersion);
      router.refresh();
    });
  };

  // Render linked URLs in notes
  const renderLinkedNotes = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part, i) => {
      if (/^https?:\/\//.test(part)) {
        return (
          <a
            key={`${i}`}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-foreground underline underline-offset-2 break-all"
          >
            {part}
          </a>
        );
      }
      return <span key={`${i}`}>{part}</span>;
    });
  };

  const isOpen = Boolean(selectedTaskId);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent
          ref={positionTaskDialog}
          showCloseButton={false}
          onEscapeKeyDown={(event) => {
            const subId = editingSubtaskIdRef.current;
            if (!subId) return;
            event.preventDefault();
            editingSubtaskIdRef.current = null;
            setEditingSubtaskId(null);
            requestAnimationFrame(() => subtaskTitleRefs.current.get(subId)?.focus());
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusRef.current;
            requestAnimationFrame(() => {
              if (target?.isConnected) target.focus();
              else document.querySelector<HTMLElement>("[data-task-id]")?.focus();
            });
          }}
          className="todo-handset-viewport-overlay inset-0 max-w-none w-full h-dvh m-0 rounded-none border-0 ring-0 p-0 flex flex-col gap-0 overflow-hidden translate-x-0 translate-y-0 sm:inset-auto sm:top-1/2 sm:left-1/2 md:left-[var(--task-detail-center,50%)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:h-auto sm:min-h-[480px] sm:max-h-[85vh] sm:max-w-md sm:rounded-xl sm:border sm:ring-1 sm:ring-foreground/10 sm:m-auto bg-[var(--solid-card)]"
        >
          <DialogTitle className="sr-only">Task Details</DialogTitle>
          {isLoading && !task ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-pulse text-muted-foreground">Loading...</div>
            </div>
          ) : task ? (
            <>
              {/* Header */}
              <div className="todo-task-detail-header flex items-center gap-2 p-4 border-b bg-card">
                <button
                  onClick={handleToggleCompleted}
                  aria-label={optimisticIsCompleted ? "Mark as incomplete" : "Mark as complete"}
                  className={cn(
                    "todo-mobile-icon-target flex-shrink-0 transition-all hover:scale-110",
                    optimisticIsCompleted ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {optimisticIsCompleted ? (
                    <CheckCircle2 className="w-6 h-6" />
                  ) : (
                    <Circle className="w-6 h-6" />
                  )}
                </button>

                <textarea
                  ref={titleRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={handleTitleKeyDown}
                  rows={1}
                  maxLength={255}
                  className={cn(
                    "flex-1 min-w-0 text-base font-semibold bg-transparent border-none focus:outline-none resize-none p-0 leading-6",
                    optimisticIsCompleted && "text-muted-foreground line-through"
                  )}
                  placeholder="Task title"
                />

                <button
                  onClick={handleToggleImportant}
                  aria-label={optimisticIsImportant ? "Remove importance" : "Mark as important"}
                  className={cn(
                    "todo-mobile-icon-target flex-shrink-0 transition-all hover:scale-110",
                    optimisticIsImportant ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Star className={cn("w-5 h-5", optimisticIsImportant && "fill-foreground")} />
                </button>

                <div className="h-6 w-px bg-border mx-1" />

                {title !== task.title && title.trim() ? (
                  <button
                    onClick={() => { saveTitle(); close(); }}
                    aria-label="Save title and close"
                    className="todo-mobile-icon-target p-1.5 hover:bg-accent rounded-lg transition-colors"
                  >
                    <Check className="w-5 h-5 text-foreground" />
                  </button>
                ) : (
                  <button
                    onClick={() => close()}
                    aria-label="Close task details"
                    className="todo-mobile-icon-target p-1.5 hover:bg-accent rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5 text-muted-foreground" />
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="todo-task-detail-body min-h-0 flex-1 overflow-y-auto p-4 space-y-5 bg-card">
                {/* Steps (Subtasks) */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Steps</h3>
                  <div className="rounded-lg border divide-y overflow-hidden">
                    {optimisticSubtasks.map((sub) => (
                      <div key={sub.id} className="flex items-start gap-1 p-1.5 sm:gap-3 sm:p-3 group hover:bg-accent/50 transition-colors">
                        <button
                          onClick={() => handleToggleSubtask(sub.id, sub.isCompleted)}
                          className="todo-mobile-icon-target md:mt-0.5 text-muted-foreground hover:text-foreground flex-shrink-0 transition-all hover:scale-110"
                          aria-label={sub.isCompleted ? "Mark step as incomplete" : "Mark step as complete"}
                        >
                          {sub.isCompleted ? (
                            <CheckCircle2 className="w-5 h-5 text-foreground" />
                          ) : (
                            <Circle className="w-5 h-5" />
                          )}
                        </button>
                        {editingSubtaskId === sub.id ? (
                          <textarea
                            ref={editingSubtaskRef}
                            value={editingSubtaskTitle}
                            onChange={(e) => {
                              setEditingSubtaskTitle(e.target.value);
                              syncTextareaHeight(e.currentTarget);
                            }}
                            onBlur={() => handleSaveSubtaskTitle(sub.id)}
                            onKeyDown={(e) => {
                              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSaveSubtaskTitle(sub.id);
                                requestAnimationFrame(() => subtaskTitleRefs.current.get(sub.id)?.focus());
                              }
                            }}
                            rows={1}
                            aria-label="Step title"
                            className="flex-1 min-w-0 min-h-11 py-2.5 md:min-h-6 md:py-0 text-base md:text-sm leading-6 bg-transparent border-none focus:outline-none resize-none overflow-hidden"
                            maxLength={500}
                          />
                        ) : (
                          <button
                            type="button"
                            ref={(element) => {
                              if (element) subtaskTitleRefs.current.set(sub.id, element);
                              else subtaskTitleRefs.current.delete(sub.id);
                            }}
                            onClick={() => startEditingSubtask(sub.id, sub.title)}
                            aria-label={`Edit step: ${sub.title}`}
                            className={cn(
                              "flex-1 min-w-0 min-h-11 py-2.5 md:min-h-6 md:py-0 text-left text-base md:text-sm leading-6 whitespace-pre-wrap [overflow-wrap:anywhere] rounded-sm focus-visible:outline-2 focus-visible:outline-ring",
                              sub.isCompleted && "text-muted-foreground line-through"
                            )}
                          >
                            {sub.title}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteSubtask(sub.id)}
                          className="todo-mobile-icon-target shrink-0 md:mt-0.5 p-1 text-muted-foreground hover:text-destructive transition-all hover:scale-110 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                          aria-label="Delete step"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <form onSubmit={handleAddSubtask} className="flex items-start gap-1 p-1.5 sm:gap-3 sm:p-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (newSubtask.trim()) {
                            subtaskInputRef.current?.form?.requestSubmit();
                          } else {
                            subtaskInputRef.current?.focus();
                          }
                        }}
                        className="todo-mobile-icon-target md:mt-0.5 flex-shrink-0"
                        aria-label={newSubtask.trim() ? "Add step" : "Focus add step"}
                      >
                        <Plus className="w-5 h-5 text-foreground" />
                      </button>
                      <textarea
                        ref={subtaskInputRef}
                        value={newSubtask}
                        onChange={(e) => {
                          setNewSubtask(e.target.value);
                          syncTextareaHeight(e.currentTarget);
                        }}
                        onKeyDown={(e) => {
                          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            e.currentTarget.form?.requestSubmit();
                          }
                        }}
                        aria-label="Add step"
                        placeholder="Add step"
                        rows={1}
                        maxLength={500}
                        className="flex-1 min-w-0 min-h-11 py-2.5 md:min-h-6 md:py-0 text-base md:text-sm leading-6 bg-transparent border-none focus:outline-none placeholder-muted-foreground resize-none overflow-hidden"
                      />
                    </form>
                  </div>
                </div>

                {/* My Day Toggle */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">My Day</h3>
                  <ActionRow
                    onClick={handleToggleMyDay}
                    icon={<Sun className="w-5 h-5" />}
                    label={optimisticIsMyDay ? "Added to My Day" : "Add to My Day"}
                    active={optimisticIsMyDay}
                    className={cn(
                      "p-3 rounded-lg border gap-3 hover:bg-accent/50",
                      optimisticIsMyDay && "ring-1 ring-primary/25"
                    )}
                    labelClassName={cn("text-sm", optimisticIsMyDay && "font-medium")}
                  />
                </div>

                {/* Due Date */}
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Due Date</h3>
                  <div className="space-y-2">
                    <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                      <div className="relative">
                        <PopoverTrigger asChild>
                          <button className={cn("p-3 rounded-lg border flex items-center gap-3 w-full transition-all hover:bg-accent/50", optimisticDueDate && "pr-10")}>
                            <Calendar className={cn("w-5 h-5", optimisticDueDate ? "text-foreground" : "text-muted-foreground")} />
                            <span className={cn("text-sm flex-1 text-left", optimisticDueDate ? "font-medium" : "")}>
                              {optimisticDueDate
                                ? new Date(optimisticDueDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
                                : "Set due date"}
                            </span>
                          </button>
                        </PopoverTrigger>
                        {optimisticDueDate && (
                          <button
                            type="button"
                            onClick={() => handleSetDueDate(null)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-destructive transition-colors rounded-md"
                            aria-label="Clear due date"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <PopoverContent className="w-auto p-0" align="start">
                        <div className="border-b p-2 space-y-1">
                          <Button
                            variant="ghost"
                            className="w-full justify-start text-sm gap-2"
                            onClick={() => {
                              const tomorrow = new Date();
                              tomorrow.setDate(tomorrow.getDate() + 1);
                              tomorrow.setHours(13, 0, 0, 0);
                              handleSetDueDate(tomorrow);
                            }}
                          >
                            <Calendar className="w-4 h-4 text-muted-foreground" />
                            Tomorrow
                          </Button>
                          <Button
                            variant="ghost"
                            className="w-full justify-start text-sm gap-2"
                            onClick={() => {
                              const nextWeek = new Date();
                              nextWeek.setDate(nextWeek.getDate() + 7);
                              nextWeek.setHours(13, 0, 0, 0);
                              handleSetDueDate(nextWeek);
                            }}
                          >
                            <Calendar className="w-4 h-4 text-muted-foreground" />
                            Next week
                          </Button>
                        </div>
                        <CalendarPicker
                          mode="single"
                          selected={optimisticDueDate ? new Date(optimisticDueDate) : undefined}
                          onSelect={(date) => handleSetDueDate(date || null)}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-2 pb-10">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Notes</h3>
                  <div
                    className="relative rounded-lg border overflow-hidden"
                    style={{ height: `${notesHeight ?? NOTES_MIN_HEIGHT_PX}px` }}
                  >
                    {isEditingNotes ? (
                      <div className="h-full p-4">
                        <textarea
                          ref={notesRef}
                          value={notes}
                          onChange={(e) => handleNotesChange(e.target.value)}
                          onBlur={handleNotesBlur}
                          placeholder="Add a note"
                          rows={NOTES_MIN_LINES}
                          className="w-full h-full text-sm leading-5 bg-transparent border-none focus:outline-none resize-none overflow-y-auto placeholder-muted-foreground"
                        />
                      </div>
                    ) : (
                      <div className="h-full p-4">
                        <div
                          onClick={() => setIsEditingNotes(true)}
                          className="h-full overflow-y-auto text-sm leading-5 whitespace-pre-wrap break-words cursor-text"
                        >
                          {notes.trim()
                            ? renderLinkedNotes(notes)
                            : <span className="text-muted-foreground">Add a note</span>}
                        </div>
                      </div>
                    )}
                    <div
                      ref={notesMeasureRef}
                      aria-hidden="true"
                      className="pointer-events-none absolute left-0 top-0 w-full opacity-0"
                    >
                      <div className="p-4 text-sm leading-5 whitespace-pre-wrap break-words">
                        {notes.trim()
                          ? renderLinkedNotes(notes)
                          : <span className="text-muted-foreground">Add a note</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="todo-task-detail-footer p-4 border-t flex items-center justify-between bg-card">
                <span className="text-xs text-muted-foreground">
                  Created {new Date(task.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                </span>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-all"
                  title="Delete task"
                  aria-label="Delete task"
                >
                  <Trash2 className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleted tasks can be restored from Settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
