"use client";

import { Sun, Star, Calendar, Home, type LucideIcon, CheckSquare2, Square, X } from "lucide-react";
import AddTaskBar from "@/components/add-task-bar";
import TaskListView from "@/components/task-list-view";
import HeaderActionsMenu from "@/components/header-actions-menu";
import AppearancePickerWrapper from "@/components/appearance-picker-wrapper";
import { getBackgroundWithStaticBlur, parseBackground } from "@/lib/utils";
import type { Task, SmartListType } from "@/lib/types";
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import MultiSelectActionsMenu from "@/components/multi-select-actions-menu";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/page-header";
import { usePaginatedTasks } from "@/hooks/use-paginated-tasks";

const ICON_MAP: Record<string, LucideIcon> = {
  sun: Sun,
  star: Star,
  calendar: Calendar,
  home: Home,
};

export default function SmartListPage({
  title,
  iconName,
  tasks,
  themeValue,
  backgroundRaw,
  currentTheme,
  smartListType,
  defaultListId,
  addTaskBarProps,
  emptyTitle,
  emptySubtitle,
  showDate = false,
}: {
  title: string;
  iconName: "sun" | "star" | "calendar" | "home";
  tasks: Task[];
  themeValue: string;
  backgroundRaw?: string | null;
  currentTheme?: string | null;
  smartListType: SmartListType;
  defaultListId: string;
  addTaskBarProps?: { isMyDay?: boolean; isImportant?: boolean; isPlanned?: boolean };
  emptyTitle: string;
  emptySubtitle?: string;
  showDate?: boolean;
}) {
  const Icon = ICON_MAP[iconName] || Home;
  const { bg: bgImage, blur: bgBlur } = parseBackground(backgroundRaw);
  const pageBgImage = getBackgroundWithStaticBlur(bgImage, bgBlur);
  const hasWallpaperForBg = Boolean(bgImage) && bgImage !== "none";
  const setWallpaper = useAppStore((s) => s.setWallpaper);
  const setCurrentPageTheme = useAppStore((s) => s.setCurrentPageTheme);
  const pagination = usePaginatedTasks({ kind: smartListType });

  useLayoutEffect(() => {
    setWallpaper(hasWallpaperForBg ? pageBgImage : null);
  }, [pageBgImage, hasWallpaperForBg, setWallpaper]);

  useLayoutEffect(() => {
    setCurrentPageTheme(themeValue !== "default" ? themeValue : null);
  }, [themeValue, setCurrentPageTheme]);

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
  }, [smartListType]);

  const today = showDate
    ? new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    : null;
  const contentTopPaddingClass = today ? "pt-40 md:pt-40" : "pt-32 md:pt-32";

  const hasWallpaper = Boolean(bgImage) && bgImage !== "none";
  const dateClass = cn(
    "text-base font-medium",
    hasWallpaper
      ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]"
      : "text-foreground"
  );

  return (
    <div
      className="todo-viewport-shell todo-safe-page-shell h-dvh flex flex-col relative overflow-hidden"
    >
      <div data-content className="relative z-10 flex flex-col flex-1 min-h-0 transition-opacity duration-150">
        <div className="absolute inset-x-0 top-0 z-20 pointer-events-auto">
          <PageHeader
            titleText={title}
            currentBg={backgroundRaw}
            currentTheme={themeValue}
            headerScrollTop={headerScrollTop}
            title={
              <span className="block truncate pb-1">
                {title}
              </span>
            }
            subtitle={today ? <p className={dateClass}>{today}</p> : undefined}
            renderActions={(buttonClass) =>
              isMultiSelectMode ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-9 w-9", buttonClass)}
                    onClick={handleToggleSelectAll}
                  >
                    {allSelected
                      ? <CheckSquare2 className="w-5 h-5" />
                      : <Square className="w-5 h-5" />}
                  </Button>
                  {selectedIds.size > 0 && (
                    <MultiSelectActionsMenu
                      selectedIds={Array.from(selectedIds)}
                      onDone={exitMultiSelect}
                      triggerClassName={buttonClass}
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-9 w-9", buttonClass)}
                    onClick={exitMultiSelect}
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </>
              ) : (
                <HeaderActionsMenu
                  currentBg={backgroundRaw}
                  currentTheme={currentTheme}
                  smartListType={smartListType}
                  triggerClassName={buttonClass}
                />
              )
            }
          />
        </div>

        <div className="relative flex-1 min-h-0">
          <div
            ref={scrollContainerRef}
            className="h-full overflow-y-auto"
          >
            <div className={cn("px-4 md:px-8 pb-28", contentTopPaddingClass)}>
              <div className="max-w-4xl mx-auto w-full flex flex-col min-h-full">
                <TaskListView
                  tasks={tasks}
                  pagination={pagination}
                  isMultiSelectMode={isMultiSelectMode}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  emptyState={
                    <div className={cn("flex flex-col items-center justify-center gap-4", today ? "pt-12 pb-20" : "py-20")}>
                      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                        <Icon className="w-8 h-8 opacity-30" />
                      </div>
                      <div className="flex flex-col items-center gap-1 px-6 py-3 rounded-xl bg-background/95 md:bg-background/80 text-foreground">
                        <p className="text-base font-semibold">{emptyTitle}</p>
                        {emptySubtitle && (
                          <p className="text-sm text-muted-foreground text-center">{emptySubtitle}</p>
                        )}
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
            <AddTaskBar listId={defaultListId} {...addTaskBarProps} />
          </div>
        </div>
      </div>

      <AppearancePickerWrapper
        currentTheme={currentTheme}
        currentBg={backgroundRaw}
        smartListType={smartListType}
      />
    </div>
  );
}
