"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { List as ListIcon } from "lucide-react";
import AddTaskBar from "@/components/add-task-bar";
import TaskListView from "@/components/task-list-view";
import ListPageHeader from "@/components/list-page-header";
import AppearancePickerWrapper from "@/components/appearance-picker-wrapper";
import { getBackgroundWithStaticBlur, parseBackground } from "@/lib/utils";
import { useListTasks } from "@/store/selectors";
import { useAppStore } from "@/store/app-store";
import { usePaginatedTasks } from "@/hooks/use-paginated-tasks";

export default function ListPageLayout({
  listId,
  listName,
  currentBg,
  currentTheme,
}: {
  listId: string;
  listName: string;
  currentBg?: string | null;
  currentTheme?: string | null;
}) {
  const tasks = useListTasks(listId);
  const pagination = usePaginatedTasks({ kind: "list", listId });
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [headerScrollTop, setHeaderScrollTop] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const exitMultiSelect = useCallback(() => {
    setIsMultiSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const allTaskIds = tasks.map((t) => t.id);
  const allSelected = allTaskIds.length > 0 && allTaskIds.every((id) => selectedIds.has(id));
  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const all = tasks.map((t) => t.id);
      const allSel = all.length > 0 && all.every((id) => prev.has(id));
      return allSel ? new Set() : new Set(all);
    });
  }, [tasks]);

  const toggleSelect = useCallback((taskId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = () => {
      setIsMultiSelectMode(true);
      setSelectedIds(new Set());
    };
    window.addEventListener("open-multi-select-mode", handler);
    return () => window.removeEventListener("open-multi-select-mode", handler);
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let frame = 0;

    const syncScroll = () => {
      frame = 0;
      setHeaderScrollTop(container.scrollTop);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(syncScroll);
    };

    syncScroll();
    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [listId]);

  const themeValue = currentTheme || "default";
  const { bg: bgImage, blur: bgBlur } = parseBackground(currentBg);
  const pageBgImage = getBackgroundWithStaticBlur(bgImage, bgBlur);
  const hasWallpaper = Boolean(bgImage) && bgImage !== "none";
  const setWallpaper = useAppStore((s) => s.setWallpaper);
  const setCurrentPageTheme = useAppStore((s) => s.setCurrentPageTheme);

  useLayoutEffect(() => {
    setWallpaper(hasWallpaper ? pageBgImage : null);
  }, [pageBgImage, hasWallpaper, setWallpaper]);

  useLayoutEffect(() => {
    setCurrentPageTheme(themeValue !== "default" ? themeValue : null);
  }, [themeValue, setCurrentPageTheme]);

  return (
    <div className="todo-viewport-shell todo-safe-page-shell h-dvh flex flex-col relative overflow-hidden">
      <div data-content className="relative z-10 flex flex-col flex-1 min-h-0 transition-opacity duration-150">
        <div className="absolute inset-x-0 top-0 z-20 pointer-events-auto">
          <ListPageHeader
            listId={listId}
            listName={listName}
            currentBg={currentBg}
            currentTheme={currentTheme}
            headerScrollTop={headerScrollTop}
            isMultiSelectMode={isMultiSelectMode}
            selectedIds={selectedIds}
            allSelected={allSelected}
            onToggleSelectAll={handleToggleSelectAll}
            onExitMultiSelect={exitMultiSelect}
          />
        </div>

        <div className="relative flex-1 min-h-0">
          <div ref={scrollContainerRef} className="h-full overflow-y-auto">
            <div className="px-4 pt-32 pb-28 md:px-8 md:pt-32">
              <div className="max-w-4xl mx-auto w-full flex flex-col min-h-full">
                <TaskListView
                  tasks={tasks}
                  pagination={pagination}
                  isMultiSelectMode={isMultiSelectMode}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  emptyState={
                    <div className="flex flex-col items-center justify-center py-20 gap-4">
                      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                        <ListIcon className="w-8 h-8 opacity-30" />
                      </div>
                      <div className="flex flex-col items-center gap-1 px-6 py-3 rounded-xl bg-background/95 md:bg-background/80 text-foreground">
                        <p className="text-base font-semibold">This list is empty</p>
                        <p className="text-sm text-muted-foreground">Add a task to get started</p>
                      </div>
                    </div>
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 inset-x-0 px-4 md:px-8 pb-6 md:pb-4 pt-2" data-add-task-bar>
          <div className="max-w-4xl mx-auto w-full">
            <AddTaskBar listId={listId} />
          </div>
        </div>
      </div>

      <AppearancePickerWrapper
        currentTheme={currentTheme}
        currentBg={currentBg}
        listId={listId}
      />
    </div>
  );
}
