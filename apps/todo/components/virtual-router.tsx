"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import {
  useMyDayTasks,
  useImportantTasks,
  usePlannedTasks,
  useDefaultListTasks,
} from "@/store/selectors";
import SmartListPage from "@/components/smart-list-page";
import ListPageLayout from "@/components/list-page-layout";
import { toast } from "sonner";

export default function VirtualRouter() {
  const urlPathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentPath = useAppStore((s) => s.currentPath);
  const setCurrentPath = useAppStore((s) => s.setCurrentPath);
  const pathname = currentPath || urlPathname;
  const taskViewKey = `${pathname}:${searchParams.get("sort") ?? ""}:${searchParams.get("dir") ?? ""}`;

  // Keep store in sync with URL (handles initial load, back/forward navigation)
  useEffect(() => {
    setCurrentPath(urlPathname);
  }, [urlPathname, setCurrentPath]);

  const userSettings = useAppStore((s) => s.userSettings);
  const defaultListId = useAppStore((s) => s.defaultListId);
  const lists = useAppStore((s) => s.lists);
  const prefetched = useAppStore((s) => s.prefetched);

  useEffect(() => {
    if (!prefetched || !pathname.startsWith("/lists/")) return;
    const listId = pathname.split("/")[2];
    if (lists.some((list) => list.id === listId)) return;
    toast.error("This list is unavailable.");
    setCurrentPath("/tasks");
    router.replace("/tasks");
  }, [lists, pathname, prefetched, router, setCurrentPath]);

  // All hooks must be called unconditionally
  const myDayTasks = useMyDayTasks();
  const importantTasks = useImportantTasks();
  const plannedTasks = usePlannedTasks();
  const defaultTasks = useDefaultListTasks();

  if (!userSettings) return null;

  if (pathname === "/") {
    return (
      <SmartListPage
        key={taskViewKey}
        title="My Day"
        iconName="sun"
        tasks={myDayTasks}
        themeValue={userSettings.myDayTheme || "blue"}
        backgroundRaw={userSettings.myDayBg}
        currentTheme={userSettings.myDayTheme}
        smartListType="my-day"
        defaultListId={defaultListId}
        addTaskBarProps={{ isMyDay: true }}
        emptyTitle="Nothing in My Day yet"
        emptySubtitle="Add tasks to focus your day."
        showDate
      />
    );
  }

  if (pathname === "/important") {
    return (
      <SmartListPage
        key={taskViewKey}
        title="Important"
        iconName="star"
        tasks={importantTasks}
        themeValue={userSettings.importantTheme || "coral"}
        backgroundRaw={userSettings.importantBg}
        currentTheme={userSettings.importantTheme}
        smartListType="important"
        defaultListId={defaultListId}
        addTaskBarProps={{ isImportant: true }}
        emptyTitle="Nothing marked important yet"
        emptySubtitle="Star tasks to keep them here."
      />
    );
  }

  if (pathname === "/planned") {
    return (
      <SmartListPage
        key={taskViewKey}
        title="Planned"
        iconName="calendar"
        tasks={plannedTasks}
        themeValue={userSettings.plannedTheme || "green"}
        backgroundRaw={userSettings.plannedBg}
        currentTheme={userSettings.plannedTheme}
        smartListType="planned"
        defaultListId={defaultListId}
        addTaskBarProps={{ isPlanned: true }}
        emptyTitle="No planned tasks yet"
        emptySubtitle="Add due dates to see tasks here."
      />
    );
  }

  if (pathname === "/tasks") {
    return (
      <SmartListPage
        key={taskViewKey}
        title="Tasks"
        iconName="home"
        tasks={defaultTasks}
        themeValue={userSettings.tasksTheme || "default"}
        backgroundRaw={userSettings.tasksBg}
        currentTheme={userSettings.tasksTheme}
        smartListType="tasks"
        defaultListId={defaultListId}
        emptyTitle="No tasks yet"
        emptySubtitle="Add a task to get started."
      />
    );
  }

  if (pathname.startsWith("/lists/")) {
    const listId = pathname.split("/")[2];
    const list = lists.find((l) => l.id === listId);
    if (!list) return <p className="m-auto text-sm text-muted-foreground" role="status">This list is unavailable.</p>;
    return (
      <ListPageLayout
        key={taskViewKey}
        listId={listId}
        listName={list.name}
        currentBg={list.backgroundImage}
        currentTheme={list.themeColor}
      />
    );
  }

  return null;
}
