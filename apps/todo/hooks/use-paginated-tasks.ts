"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getTaskPage, getTaskView } from "@/app/actions";
import {
  TASK_PAGE_SIZE,
  type Task,
  type SortDirection,
  type SortOption,
  type TaskPageScope,
  type TaskPageResult,
} from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { normalizeSyncTask, todoSyncRequestKey, type TodoSyncRequest } from "@/lib/todo-sync";
import { readTaskViewCache, taskViewCacheKey, writeTaskViewCache } from "@/lib/task-view-cache";

const DEFAULT_DIR: Record<SortOption, SortDirection> = {
  created: "desc",
  alpha: "asc",
  importance: "desc",
  due: "asc",
  custom: "desc",
};

interface LoadedPage {
  items: Task[];
  totalCount: number;
  nextCursor: string | null;
  cursor: string | null;
  history: Array<string | null>;
}

export interface TaskPageControls {
  totalCount: number;
  itemCount: number;
  pageIndex: number;
  pageSize: number;
  hasPrevious: boolean;
  hasNext: boolean;
  isLoading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export interface PaginatedTaskView {
  sort: SortOption;
  direction: SortDirection;
  isInitialLoading: boolean;
  error: string | null;
  active: TaskPageControls;
  completed: TaskPageControls;
}

const EMPTY_PAGE: LoadedPage = {
  items: [],
  totalCount: 0,
  nextCursor: null,
  cursor: null,
  history: [],
};

const subscribeToStaticCache = () => () => {};

function normalizeTasks(items: Task[]): Task[] {
  return items.map((task) => ({
    ...task,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
    dueDate: task.dueDate ? new Date(task.dueDate) : null,
  }));
}

function loadedPage(result: TaskPageResult<Task>): LoadedPage {
  return {
    ...result,
    items: normalizeTasks(result.items),
    cursor: null,
    history: [],
  };
}

export function usePaginatedTasks(scope: TaskPageScope): PaginatedTaskView {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const storedSortPreference = useAppStore((state) => state.sortPreferences[pathname]);
  const setSortPreference = useAppStore((state) => state.setSortPreference);
  const refreshVersion = useAppStore((state) => state.refreshVersion);
  const replaceTasks = useAppStore((state) => state.hydrateAllTasks);
  const setSyncRequest = useAppStore((state) => state.setSyncRequest);
  const lastSyncPage = useAppStore((state) => state.lastSyncPage);

  const sortParam = searchParams.get("sort");
  const directionParam = searchParams.get("dir");
  const sortFromParam: SortOption | null =
    sortParam === "alpha" ||
    sortParam === "importance" ||
    sortParam === "created" ||
    sortParam === "due" ||
    sortParam === "custom"
      ? sortParam
      : null;
  const sort = sortFromParam ?? storedSortPreference?.sort ?? "created";
  const directionFromParam: SortDirection | null =
    directionParam === "asc" || directionParam === "desc" ? directionParam : null;
  const direction =
    directionFromParam ??
    (sortFromParam ? DEFAULT_DIR[sort] : (storedSortPreference?.dir ?? DEFAULT_DIR[sort]));

  useEffect(() => {
    setSortPreference(pathname, { sort, dir: direction });
  }, [pathname, sort, direction, setSortPreference]);

  const scopeListId = scope.kind === "list" ? scope.listId : null;
  const stableScope = useMemo<TaskPageScope>(
    () => (scope.kind === "list" ? { kind: "list", listId: scopeListId! } : { kind: scope.kind }),
    [scope.kind, scopeListId],
  );
  const viewKey = taskViewCacheKey(stableScope, sort, direction);
  const cachedView = useSyncExternalStore(
    subscribeToStaticCache,
    () => readTaskViewCache(viewKey),
    () => null,
  );
  const [activePage, setActivePage] = useState<LoadedPage>(() => cachedView ? loadedPage(cachedView.active) : EMPTY_PAGE);
  const [completedPage, setCompletedPage] = useState<LoadedPage>(() => cachedView ? loadedPage(cachedView.completed) : EMPTY_PAGE);
  const [activeLoading, setActiveLoading] = useState(false);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const networkRequestKey = `${viewKey}:${refreshVersion}`;
  const [loadedViewKey, setLoadedViewKey] = useState<string | null>(() => cachedView ? viewKey : null);
  const initialRequestIdRef = useRef(0);
  const activeRequestIdRef = useRef(0);
  const completedRequestIdRef = useRef(0);
  const cachedPages = useMemo(() => cachedView ? {
    active: loadedPage(cachedView.active),
    completed: loadedPage(cachedView.completed),
  } : null, [cachedView]);
  const visibleActivePage = loadedViewKey !== viewKey && cachedPages ? cachedPages.active : activePage;
  const visibleCompletedPage = loadedViewKey !== viewKey && cachedPages ? cachedPages.completed : completedPage;
  const isInitialLoading = loadedViewKey !== viewKey && cachedPages === null;
  const syncRequest = useMemo<TodoSyncRequest>(() => ({
    scope: stableScope,
    sort,
    direction,
    activeCursor: visibleActivePage.cursor,
    completedCursor: visibleCompletedPage.cursor,
  }), [stableScope, sort, direction, visibleActivePage.cursor, visibleCompletedPage.cursor]);
  const syncKey = todoSyncRequestKey(syncRequest);

  useEffect(() => {
    setSyncRequest(syncRequest);
    return () => {
      if (useAppStore.getState().syncRequest && todoSyncRequestKey(useAppStore.getState().syncRequest!) === syncKey) {
        setSyncRequest(null);
      }
    };
  }, [setSyncRequest, syncKey, syncRequest]);

  const syncedPages = useMemo(() => {
    if (!lastSyncPage || lastSyncPage.requestKey !== syncKey) {
      return { active: visibleActivePage, completed: visibleCompletedPage };
    }
    return {
      active: {
        ...visibleActivePage,
        ...lastSyncPage.snapshot.active,
        items: lastSyncPage.snapshot.active.items.map(normalizeSyncTask),
      },
      completed: {
        ...visibleCompletedPage,
        ...lastSyncPage.snapshot.completed,
        items: lastSyncPage.snapshot.completed.items.map(normalizeSyncTask),
      },
    };
  }, [lastSyncPage, syncKey, visibleActivePage, visibleCompletedPage]);

  const replaceVisibleCache = useCallback(
    (active: LoadedPage, completed: LoadedPage) => {
      replaceTasks([...active.items, ...completed.items]);
    },
    [replaceTasks],
  );

  useLayoutEffect(() => {
    activeRequestIdRef.current += 1;
    completedRequestIdRef.current += 1;
    if (cachedView) {
      const active = loadedPage(cachedView.active);
      const completed = loadedPage(cachedView.completed);
      replaceVisibleCache(active, completed);
      return;
    }
    replaceVisibleCache(EMPTY_PAGE, EMPTY_PAGE);
  }, [cachedView, replaceVisibleCache, viewKey]);

  useEffect(() => {
    const requestId = ++initialRequestIdRef.current;
    activeRequestIdRef.current += 1;
    completedRequestIdRef.current += 1;

    getTaskView({ scope: stableScope, sort, direction })
      .then((result) => {
        if (requestId !== initialRequestIdRef.current) return;
        const active = loadedPage(result.active);
        const completed = loadedPage(result.completed);
        setActivePage(active);
        setCompletedPage(completed);
        setError(null);
        writeTaskViewCache(viewKey, { active, completed });
        replaceVisibleCache(active, completed);
      })
      .catch(() => {
        if (requestId !== initialRequestIdRef.current) return;
        if (!readTaskViewCache(viewKey)) setError("Couldn’t load this task page.");
      })
      .finally(() => {
        if (requestId === initialRequestIdRef.current) setLoadedViewKey(viewKey);
      });
  }, [direction, networkRequestKey, sort, stableScope, replaceVisibleCache, viewKey]);

  useEffect(() => {
    if (
      !lastSyncPage ||
      lastSyncPage.requestKey !== syncKey ||
      visibleActivePage.cursor !== null ||
      visibleCompletedPage.cursor !== null
    ) return;
    writeTaskViewCache(viewKey, {
      active: {
        ...lastSyncPage.snapshot.active,
        items: lastSyncPage.snapshot.active.items.map(normalizeSyncTask),
      },
      completed: {
        ...lastSyncPage.snapshot.completed,
        items: lastSyncPage.snapshot.completed.items.map(normalizeSyncTask),
      },
    });
  }, [lastSyncPage, syncKey, viewKey, visibleActivePage.cursor, visibleCompletedPage.cursor]);

  const loadActive = useCallback(
    async (cursor: string | null, history: Array<string | null>) => {
      const requestId = ++activeRequestIdRef.current;
      setActiveLoading(true);
      setError(null);
      try {
        const result: TaskPageResult<Task> = await getTaskPage({
          scope: stableScope,
          completed: false,
          sort,
          direction,
          cursor,
        });
        if (requestId !== activeRequestIdRef.current) return;
        const active: LoadedPage = {
          ...result,
          items: normalizeTasks(result.items),
          cursor,
          history,
        };
        setActivePage(active);
        replaceVisibleCache(active, syncedPages.completed);
      } catch {
        if (requestId === activeRequestIdRef.current) setError("Couldn’t load this task page.");
      } finally {
        if (requestId === activeRequestIdRef.current) setActiveLoading(false);
      }
    },
    [stableScope, sort, direction, syncedPages.completed, replaceVisibleCache],
  );

  const loadCompleted = useCallback(
    async (cursor: string | null, history: Array<string | null>) => {
      const requestId = ++completedRequestIdRef.current;
      setCompletedLoading(true);
      setError(null);
      try {
        const result: TaskPageResult<Task> = await getTaskPage({
          scope: stableScope,
          completed: true,
          sort,
          direction,
          cursor,
        });
        if (requestId !== completedRequestIdRef.current) return;
        const completed: LoadedPage = {
          ...result,
          items: normalizeTasks(result.items),
          cursor,
          history,
        };
        setCompletedPage(completed);
        replaceVisibleCache(syncedPages.active, completed);
      } catch {
        if (requestId === completedRequestIdRef.current) setError("Couldn’t load completed tasks.");
      } finally {
        if (requestId === completedRequestIdRef.current) setCompletedLoading(false);
      }
    },
    [stableScope, sort, direction, syncedPages.active, replaceVisibleCache],
  );

  const activeNext = useCallback(() => {
    if (!syncedPages.active.nextCursor || activeLoading) return;
    void loadActive(syncedPages.active.nextCursor, [...syncedPages.active.history, syncedPages.active.cursor]);
  }, [syncedPages.active, activeLoading, loadActive]);
  const activePrevious = useCallback(() => {
    if (syncedPages.active.history.length === 0 || activeLoading) return;
    const cursor = syncedPages.active.history.at(-1) ?? null;
    void loadActive(cursor, syncedPages.active.history.slice(0, -1));
  }, [syncedPages.active, activeLoading, loadActive]);
  const completedNext = useCallback(() => {
    if (!syncedPages.completed.nextCursor || completedLoading) return;
    void loadCompleted(syncedPages.completed.nextCursor, [...syncedPages.completed.history, syncedPages.completed.cursor]);
  }, [syncedPages.completed, completedLoading, loadCompleted]);
  const completedPrevious = useCallback(() => {
    if (syncedPages.completed.history.length === 0 || completedLoading) return;
    const cursor = syncedPages.completed.history.at(-1) ?? null;
    void loadCompleted(cursor, syncedPages.completed.history.slice(0, -1));
  }, [syncedPages.completed, completedLoading, loadCompleted]);

  return {
    sort,
    direction,
    isInitialLoading,
    error,
    active: {
      totalCount: syncedPages.active.totalCount,
      itemCount: syncedPages.active.items.length,
      pageIndex: syncedPages.active.history.length,
      pageSize: TASK_PAGE_SIZE,
      hasPrevious: syncedPages.active.history.length > 0,
      hasNext: Boolean(syncedPages.active.nextCursor),
      isLoading: activeLoading,
      onPrevious: activePrevious,
      onNext: activeNext,
    },
    completed: {
      totalCount: syncedPages.completed.totalCount,
      itemCount: syncedPages.completed.items.length,
      pageIndex: syncedPages.completed.history.length,
      pageSize: TASK_PAGE_SIZE,
      hasPrevious: syncedPages.completed.history.length > 0,
      hasNext: Boolean(syncedPages.completed.nextCursor),
      isLoading: completedLoading,
      onPrevious: completedPrevious,
      onNext: completedNext,
    },
  };
}
