"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/types";
import { reorderTasks } from "@/app/actions";
import { toast } from "sonner";

interface TouchState {
  taskIndex: number;
  startY: number;
  startX: number;
  timer: ReturnType<typeof setTimeout> | null;
  active: boolean;
}

/**
 * Returns insertion index (0..n) from a clientY coordinate.
 * Scans task elements top-to-bottom; returns the index of the first element
 * whose midpoint is below the cursor (meaning "insert before it").
 * Returns n if cursor is below all midpoints (insert at end).
 */
function calcInsertIndex(clientY: number, n: number): number {
  const elements = Array.from(document.querySelectorAll("[data-task-index]")).sort(
    (a, b) =>
      parseInt(a.getAttribute("data-task-index") ?? "0") -
      parseInt(b.getAttribute("data-task-index") ?? "0")
  );
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    const elIndex = parseInt(el.getAttribute("data-task-index") ?? "-1");
    if (elIndex < 0) continue;
    if (clientY < rect.top + rect.height / 2) return elIndex;
  }
  return n;
}

export function useTaskDrag(tasks: Task[], onReorder?: (newOrder: Task[]) => void) {
  const router = useRouter();
  const taskIdsKey = tasks.map((task) => task.id).join(",");
  const [orderedState, setOrderedState] = useState(() => ({ sourceKey: taskIdsKey, tasks }));
  const orderedTasks = orderedState.sourceKey === taskIdsKey ? orderedState.tasks : tasks;
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const draggingIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);
  const orderedTasksRef = useRef<Task[]>(orderedTasks);
  const touchState = useRef<TouchState | null>(null);
  // Keep onReorder in a ref so performReorder (stable callback) always sees the latest value
  const onReorderRef = useRef(onReorder);
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);

  useEffect(() => {
    orderedTasksRef.current = orderedTasks;
  }, [orderedTasks]);

  useEffect(() => { draggingIndexRef.current = draggingIndex; }, [draggingIndex]);
  useEffect(() => { dragOverIndexRef.current = dragOverIndex; }, [dragOverIndex]);

  // Fade the AddTaskBar via CSS body attribute while dragging
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (draggingIndex !== null) {
      document.body.dataset.taskDragging = "true";
    } else {
      delete document.body.dataset.taskDragging;
    }
  }, [draggingIndex]);

  const clearDragState = useCallback(() => {
    setDraggingIndex(null);
    setDragOverIndex(null);
    draggingIndexRef.current = null;
    dragOverIndexRef.current = null;
  }, []);

  const performReorder = useCallback((fromIndex: number, toIndex: number) => {
    const n = orderedTasksRef.current.length;
    if (fromIndex === toIndex) return;
    if (fromIndex === n - 1 && toIndex >= n) return; // dragging last item to after-last is a no-op
    const current = [...orderedTasksRef.current];
    const [moved] = current.splice(fromIndex, 1);
    // When moving DOWN, splice(fromIndex,1) shifts everything after fromIndex left by 1.
    // toIndex was calculated against the original positions, so subtract 1 to compensate.
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    current.splice(insertAt, 0, moved);
    setOrderedState({ sourceKey: taskIdsKey, tasks: current });
    orderedTasksRef.current = current;
    reorderTasks(current.map((t) => t.id))
      .then((result) => {
        if (result?.error) toast.error(result.error);
      })
      .catch(() => toast.error("Failed to reorder tasks"))
      .finally(() => router.refresh());
    onReorderRef.current?.(current);
  }, [router, taskIdsKey]);

  // Global dragover + drop listeners cover the entire page:
  // header, gaps, add-task-bar area — anywhere outside the sidebar.
  // This replaces per-element onDragOver/onDrop on the task list container
  // and eliminates the "tiny top zone" problem.
  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleDragOver = (e: DragEvent) => {
      if (draggingIndexRef.current === null) return;
      if (e.dataTransfer?.types.includes("application/list-reorder")) return;

      // When over a sidebar drop target, clear the position indicator
      // and let the sidebar handle the cross-list drop.
      if ((e.target as Element | null)?.closest("[data-task-drop-target]")) {
        if (dragOverIndexRef.current !== null) {
          setDragOverIndex(null);
          dragOverIndexRef.current = null;
        }
        return;
      }

      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

      const newIndex = calcInsertIndex(e.clientY, orderedTasksRef.current.length);
      if (dragOverIndexRef.current !== newIndex) {
        setDragOverIndex(newIndex);
        dragOverIndexRef.current = newIndex;
      }
    };

    const handleDrop = (e: DragEvent) => {
      if (draggingIndexRef.current === null) return;
      if (e.dataTransfer?.types.includes("application/list-reorder")) return;
      // Let the sidebar handle cross-list drops
      if ((e.target as Element | null)?.closest("[data-task-drop-target]")) return;

      const to = dragOverIndexRef.current;
      if (to === null) return;

      const taskId = e.dataTransfer?.getData("text/plain");
      const from = draggingIndexRef.current;
      if (from === null || !taskId) return;

      const taskAtFrom = orderedTasksRef.current[from];
      if (!taskAtFrom || taskAtFrom.id !== taskId) {
        clearDragState();
        return;
      }

      e.preventDefault();
      performReorder(from, to);
      clearDragState();
    };

    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("drop", handleDrop);
    };
  }, [performReorder, clearDragState]);

  // Desktop: item is only a drag source; all drop logic is in the global listeners above
  const getItemDragProps = useCallback(
    (index: number) => ({
      draggable: true as const,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.setData("text/plain", orderedTasksRef.current[index]?.id ?? "");
        e.dataTransfer.effectAllowed = "move";
        setDraggingIndex(index);
        draggingIndexRef.current = index;
      },
      onDragEnd: clearDragState,
    }),
    [clearDragState]
  );

  // Mobile touch handlers
  const getTouchProps = useCallback(
    (index: number) => ({
      onTouchStart: (e: React.TouchEvent) => {
        const touch = e.touches[0];
        const timer = setTimeout(() => {
          if (touchState.current && !touchState.current.active) {
            touchState.current.active = true;
            if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(20);
            setDraggingIndex(index);
            draggingIndexRef.current = index;
            setDragOverIndex(index);
            dragOverIndexRef.current = index;
          }
        }, 600);
        touchState.current = { taskIndex: index, startY: touch.clientY, startX: touch.clientX, timer, active: false };
      },
      onTouchMove: (e: React.TouchEvent) => {
        const state = touchState.current;
        if (!state) return;
        const touch = e.touches[0];
        const dy = Math.abs(touch.clientY - state.startY);
        const dx = Math.abs(touch.clientX - state.startX);

        if (!state.active && (dy > 10 || dx > 10)) {
          if (state.timer) clearTimeout(state.timer);
          touchState.current = null;
          return;
        }
        if (!state.active) return;
        e.preventDefault();

        const newIndex = calcInsertIndex(touch.clientY, orderedTasksRef.current.length);
        if (newIndex !== dragOverIndexRef.current) {
          setDragOverIndex(newIndex);
          dragOverIndexRef.current = newIndex;
        }
      },
      onTouchEnd: () => {
        const state = touchState.current;
        if (!state) return;
        if (state.timer) clearTimeout(state.timer);
        if (state.active) {
          const from = draggingIndexRef.current;
          const to = dragOverIndexRef.current;
          if (from !== null && to !== null && from !== to) performReorder(from, to);
          clearDragState();
        }
        touchState.current = null;
      },
    }),
    [performReorder, clearDragState]
  );

  return { orderedTasks, draggingIndex, dragOverIndex, getItemDragProps, getTouchProps };
}
