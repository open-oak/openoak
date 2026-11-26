"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import TaskItem from "./task-item";
import CompletedSection from "./completed-section";
import { useAppStore } from "@/store/app-store";
import type { Task, SortOption } from "@/lib/types";
import { useTaskDrag } from "@/hooks/use-task-drag";
import TaskPageControls from "@/components/task-page-controls";
import type { PaginatedTaskView } from "@/hooks/use-paginated-tasks";
import { shouldShowTaskEmptyState } from "@/lib/task-pagination";

export default function TaskListView({
  tasks,
  emptyState,
  isMultiSelectMode = false,
  selectedIds,
  onToggleSelect,
  pagination,
}: {
  tasks: Task[];
  emptyState?: React.ReactNode;
  isMultiSelectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (taskId: string) => void;
  pagination: PaginatedTaskView;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);
  const setSortPreference = useAppStore((s) => s.setSortPreference);
  const sort: SortOption = pagination.sort;

  const activeTasks = useMemo(() => tasks.filter((t) => !t.isCompleted), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((t) => t.isCompleted), [tasks]);

  const sortedActive = activeTasks;
  // Completed tasks are already in persisted sortOrder from selectors; avoid re-sorting every render.
  const sortedCompleted = completedTasks;

  // When a drag completes while not in custom sort, stash the post-drag order so the hook
  // doesn't reset to the stale DB custom order during the URL→"custom" transition.
  const [pendingCustomOrder, setPendingCustomOrder] = useState<Task[] | null>(null);
  const lastClickedIndexRef = useRef<number | null>(null);

  // Switch to custom sort on first drag — fires after each reorder.
  // Receives the new order so we can freeze it as the hook's input during the transition.
  const onReorder = useCallback((newOrder: Task[]) => {
    if (sort === "custom") return;
    setPendingCustomOrder(newOrder);
    setSortPreference(pathname, { sort: "custom", dir: "desc" });
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", "custom");
    params.delete("dir");
    const query = params.toString();
    router.push(query ? `?${query}` : window.location.pathname);
  }, [sort, searchParams, router, pathname, setSortPreference]);

  // In custom mode use the stashed pending order (if transitioning) or sortedActive.
  // This prevents the hook from resetting to stale DB order when sort switches to "custom".
  const pendingIsSynced = useMemo(() => {
    if (pendingCustomOrder === null) return true;
    return pendingCustomOrder.map((t) => t.id).join(",") === sortedActive.map((t) => t.id).join(",");
  }, [pendingCustomOrder, sortedActive]);
  const tasksForHook = pendingCustomOrder && !pendingIsSynced ? pendingCustomOrder : sortedActive;

  // Drag is always enabled. In custom mode, use hook's managed order.
  // In other modes, use the sort-applied order (hook stays synced to it).
  const { orderedTasks, draggingIndex, dragOverIndex, getItemDragProps, getTouchProps } =
    useTaskDrag(tasksForHook, onReorder);

  const displayTasks = sort === "custom" ? orderedTasks : sortedActive;
  const selectableIds = useMemo(
    () => [...displayTasks.map((task) => task.id), ...sortedCompleted.map((task) => task.id)],
    [displayTasks, sortedCompleted]
  );

  const handleSelectTask = (taskId: string) => setSelectedTaskId(taskId);
  const handleMultiSelectToggle = useCallback(
    (taskId: string, event?: React.MouseEvent<HTMLDivElement>) => {
      if (!onToggleSelect) return;
      const currentIndex = selectableIds.indexOf(taskId);
      const currentSelected = selectedIds ?? new Set<string>();

      if (event?.shiftKey && lastClickedIndexRef.current !== null && currentIndex >= 0) {
        const from = Math.min(lastClickedIndexRef.current, currentIndex);
        const to = Math.max(lastClickedIndexRef.current, currentIndex);
        for (const id of selectableIds.slice(from, to + 1)) {
          if (!currentSelected.has(id)) {
            onToggleSelect(id);
          }
        }
      } else {
        onToggleSelect(taskId);
      }

      if (currentIndex >= 0) {
        lastClickedIndexRef.current = currentIndex;
      }
    },
    [onToggleSelect, selectableIds, selectedIds]
  );

  useEffect(() => {
    if (!isMultiSelectMode || !onToggleSelect) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a") return;
      const activeEl = document.activeElement as HTMLElement | null;
      const tag = activeEl?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || activeEl?.isContentEditable;
      if (isEditable) return;

      event.preventDefault();
      for (const id of selectableIds) {
        if (!selectedIds?.has(id)) {
          onToggleSelect(id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMultiSelectMode, onToggleSelect, selectableIds, selectedIds]);

  const n = displayTasks.length;
  const isDragging = draggingIndex !== null;
  const dragDisabledAcrossPages =
    pagination.active.totalCount > pagination.active.itemCount || pagination.active.hasPrevious;

  if (pagination.isInitialLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center text-sm font-medium text-muted-foreground" role="status">
        Loading tasks…
      </div>
    );
  }

  if (pagination.error && tasks.length === 0) {
    return (
      <div className="flex min-h-48 items-center justify-center text-sm font-medium text-destructive" role="alert">
        {pagination.error}
      </div>
    );
  }

  if (shouldShowTaskEmptyState(pagination.active.totalCount, activeTasks.length) && emptyState) {
    return (
      <div className="flex flex-col flex-1">
        {emptyState}
        <CompletedSection count={pagination.completed.totalCount}>
          {sortedCompleted.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              isSelected={selectedTaskId === task.id}
              onSelect={handleSelectTask}
              isMultiSelectMode={isMultiSelectMode}
              isMultiSelected={selectedIds?.has(task.id)}
              onToggleMultiSelect={handleMultiSelectToggle}
            />
          ))}
          <TaskPageControls {...pagination.completed} />
        </CompletedSection>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      <div className="space-y-2">
        {displayTasks.map((task, index) => {
          const isItemDragging = draggingIndex === index;
          const showIndicatorAbove =
            dragOverIndex === index && isDragging && draggingIndex !== index;

          return (
            <div key={task.id} data-task-index={index} className="relative">
              {showIndicatorAbove && (
                <div className="h-0.5 bg-primary rounded mx-4 mb-1" />
              )}
              <TaskItem
                task={task}
                isSelected={selectedTaskId === task.id}
                onSelect={handleSelectTask}
                dragProps={isMultiSelectMode || dragDisabledAcrossPages ? undefined : getItemDragProps(index)}
                touchProps={isMultiSelectMode || dragDisabledAcrossPages ? undefined : getTouchProps(index)}
                isDragging={isItemDragging}
                isMultiSelectMode={isMultiSelectMode}
                isMultiSelected={selectedIds?.has(task.id)}
                onToggleMultiSelect={handleMultiSelectToggle}
              />
            </div>
          );
        })}
        {dragOverIndex === n && isDragging && (
          <div className="h-0.5 bg-primary rounded mx-4 mt-1" />
        )}
      </div>

      <TaskPageControls {...pagination.active} />

      <CompletedSection count={pagination.completed.totalCount}>
        {sortedCompleted.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            isSelected={selectedTaskId === task.id}
            onSelect={handleSelectTask}
            isMultiSelectMode={isMultiSelectMode}
            isMultiSelected={selectedIds?.has(task.id)}
            onToggleMultiSelect={handleMultiSelectToggle}
          />
        ))}
        <TaskPageControls {...pagination.completed} />
      </CompletedSection>

      {/* Passive bottom zone — fills remaining viewport so you can drop below all tasks */}
      <div className="flex-1 min-h-16" />
    </div>
  );
}
