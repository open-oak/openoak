import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Task, ListItem, SidebarCounts, SortDirection, SortOption, UserSettings } from "@/lib/types";
import {
  normalizeSyncList,
  reconcileVisibleTasks,
  type PendingTaskMutation,
  type TodoSyncRequest,
  type TodoSyncSnapshot,
} from "@/lib/todo-sync";

interface SortPreference {
  sort: SortOption;
  dir: SortDirection;
}

interface AppState {
  // Server data
  tasks: Map<string, Task>;
  lists: ListItem[];
  userSettings: UserSettings | null;
  defaultListId: string;
  counts: SidebarCounts;
  prefetched: boolean;
  refreshVersion: number;
  syncRequest: TodoSyncRequest | null;
  lastSyncPage: { requestKey: string; snapshot: TodoSyncSnapshot; revision: number } | null;
  pendingTaskMutations: Record<string, PendingTaskMutation>;
  syncNotices: string[];

  // UI state
  sidebarCollapsed: boolean;
  selectedTaskId: string | null;
  colorMode: "auto" | "light" | "dark";
  currentPath: string;
  setCurrentPath: (path: string) => void;
  sortPreferences: Record<string, SortPreference>;
  setSortPreference: (path: string, preference: SortPreference) => void;

  // Wallpaper (persistent background crossfade)
  /** undefined until the first page sets it; null means no wallpaper. */
  currentWallpaperBg: string | null | undefined;
  setWallpaper: (bg: string | null) => void;

  // Page theme color (for full-viewport color background)
  /** undefined until the first page sets it; null means the default theme. */
  currentPageTheme: string | null | undefined;
  setCurrentPageTheme: (theme: string | null) => void;

  // Transparent UI effect
  glassEnabled: boolean;
  setGlassEnabled: (enabled: boolean) => void;

  // Settings
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;

  // Hydration
  hydrate: (data: {
    lists: ListItem[];
    counts: SidebarCounts;
    defaultListId: string;
    userSettings: UserSettings;
  }) => void;
  hydrateAllTasks: (tasks: Task[]) => void;

  // Sidebar
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // Task selection
  setSelectedTaskId: (id: string | null) => void;

  // Color mode
  setColorMode: (mode: "auto" | "light" | "dark") => void;

  // Data mutations
  setLists: (lists: ListItem[]) => void;
  setCounts: (counts: SidebarCounts) => void;
  setUserSettings: (settings: UserSettings) => void;
  setDefaultListId: (id: string) => void;

  // Task mutations
  setTask: (task: Task) => void;
  removeTask: (id: string) => void;
  updateTaskInStore: (id: string, patch: Partial<Task>) => void;
  bulkSetTasks: (tasks: Task[]) => void;

  // Optimistic helpers
  addTaskOptimistic: (task: Task) => void;
  updateTaskOptimistic: (id: string, patch: Partial<Task>) => number;
  removeTaskOptimistic: (id: string) => number;
  commitTask: (tempId: string, realTask: Task) => void;
  rollbackTask: (tempId: string) => void;
  finishTaskMutation: (id: string, success: boolean, version?: number) => void;
  setSyncRequest: (request: TodoSyncRequest | null) => void;
  reconcileSync: (snapshot: TodoSyncSnapshot, requestKey: string) => void;
  drainSyncNotices: () => string[];
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Initial state
      tasks: new Map(),
      lists: [],
      userSettings: null,
      defaultListId: "",
      counts: { myDay: 0, important: 0, importantAny: 0, planned: 0, plannedAny: 0, all: 0, lists: {} },
      prefetched: false,
      refreshVersion: 0,
      syncRequest: null,
      lastSyncPage: null,
      pendingTaskMutations: {},
      syncNotices: [],
      sidebarCollapsed: false,
      selectedTaskId: null,
      colorMode: "auto",
      currentPath: "",
      setCurrentPath: (path) => set({ currentPath: path }),
      sortPreferences: {},
      setSortPreference: (path, preference) =>
        set((s) => ({
          sortPreferences: {
            ...s.sortPreferences,
            [path]: preference,
          },
        })),
      currentWallpaperBg: undefined,
      currentPageTheme: undefined,
      glassEnabled: false,
      soundEnabled: true,

      // Hydration
      hydrate: (data) =>
        set((state) => ({
          lists: data.lists,
          counts: data.counts,
          defaultListId: data.defaultListId,
          userSettings: data.userSettings,
          prefetched: true,
          refreshVersion: state.refreshVersion + 1,
        })),

      hydrateAllTasks: (tasks) =>
        set({
          tasks: new Map(tasks.map((t) => [t.id, t])),
          prefetched: true,
        }),

      // Sidebar
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

      // Task selection
      setSelectedTaskId: (id) => set({ selectedTaskId: id }),

      // Color mode
      setColorMode: (mode) => set({ colorMode: mode }),

      // Wallpaper
      setWallpaper: (bg) => set({ currentWallpaperBg: bg }),
      setCurrentPageTheme: (theme) => set({ currentPageTheme: theme }),

      // Transparent UI effect
      setGlassEnabled: (enabled) => set({ glassEnabled: enabled }),

      // Settings
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),

      // Data mutations
      setLists: (lists) => set({ lists }),
      setCounts: (counts) => set({ counts }),
      setUserSettings: (settings) => set({ userSettings: settings }),
      setDefaultListId: (id) => set({ defaultListId: id }),

      // Task mutations
      setTask: (task) =>
        set((s) => {
          const next = new Map(s.tasks);
          next.set(task.id, task);
          return { tasks: next };
        }),

      removeTask: (id) =>
        set((s) => {
          const next = new Map(s.tasks);
          next.delete(id);
          return { tasks: next };
        }),

      updateTaskInStore: (id, patch) =>
        set((s) => {
          const existing = s.tasks.get(id);
          if (!existing) return s;
          const next = new Map(s.tasks);
          next.set(id, { ...existing, ...patch });
          return { tasks: next };
        }),

      bulkSetTasks: (tasks) =>
        set((s) => {
          const next = new Map(s.tasks);
          for (const task of tasks) {
            next.set(task.id, task);
          }
          return { tasks: next };
        }),

      // Optimistic helpers
      addTaskOptimistic: (task) =>
        set((s) => {
          const next = new Map(s.tasks);
          next.set(task.id, task);
          if (!task.id.startsWith("temp-")) return { tasks: next };
          return {
            tasks: next,
            pendingTaskMutations: {
              ...s.pendingTaskMutations,
              [task.id]: { kind: "create", version: 1, dirtyFields: Object.keys(task), snapshot: null },
            },
          };
        }),

      updateTaskOptimistic: (id, patch) => {
        let version = 0;
        set((s) => {
          const existing = s.tasks.get(id);
          if (!existing) return s;
          const next = new Map(s.tasks);
          next.set(id, { ...existing, ...patch });
          const previous = s.pendingTaskMutations[id];
          version = (previous?.version ?? 0) + 1;
          return {
            tasks: next,
            pendingTaskMutations: {
              ...s.pendingTaskMutations,
              [id]: {
                kind: "update",
                version,
                snapshot: previous?.snapshot ?? existing,
                dirtyFields: Array.from(new Set([...(previous?.dirtyFields ?? []), ...Object.keys(patch)])),
                remoteDeleteDeferred: previous?.remoteDeleteDeferred,
              },
            },
          };
        });
        return version;
      },

      removeTaskOptimistic: (id) => {
        let version = 0;
        set((s) => {
          const next = new Map(s.tasks);
          next.delete(id);
          version = (s.pendingTaskMutations[id]?.version ?? 0) + 1;
          return {
            tasks: next,
            pendingTaskMutations: {
              ...s.pendingTaskMutations,
              [id]: { kind: "delete", version, dirtyFields: [], snapshot: s.pendingTaskMutations[id]?.snapshot ?? s.tasks.get(id) ?? null },
            },
          };
        });
        return version;
      },

      commitTask: (tempId, realTask) =>
        set((s) => {
          const next = new Map(s.tasks);
          next.delete(tempId);
          next.set(realTask.id, realTask);
          const pendingTaskMutations = { ...s.pendingTaskMutations };
          delete pendingTaskMutations[tempId];
          return { tasks: next, pendingTaskMutations };
        }),

      rollbackTask: (tempId) =>
        set((s) => {
          const next = new Map(s.tasks);
          next.delete(tempId);
          const pendingTaskMutations = { ...s.pendingTaskMutations };
          delete pendingTaskMutations[tempId];
          return { tasks: next, pendingTaskMutations };
        }),

      finishTaskMutation: (id, success, version) =>
        set((s) => {
          const mutation = s.pendingTaskMutations[id];
          if (!mutation) return s;
          if (version !== undefined && mutation.version !== version) return s;
          const pendingTaskMutations = { ...s.pendingTaskMutations };
          delete pendingTaskMutations[id];
          const tasks = new Map(s.tasks);
          const syncNotices = [...s.syncNotices];
          if (!success && mutation.snapshot) tasks.set(id, mutation.snapshot);
          if (success && mutation.remoteDeleteDeferred) {
            tasks.delete(id);
            syncNotices.push("A task changed elsewhere was removed after your edit finished.");
          }
          return { tasks, pendingTaskMutations, syncNotices };
        }),

      setSyncRequest: (syncRequest) => set({ syncRequest }),

      reconcileSync: (snapshot, requestKey) =>
        set((s) => {
          const result = reconcileVisibleTasks(
            s.tasks,
            [...snapshot.active.items, ...snapshot.completed.items],
            s.pendingTaskMutations,
          );
          const pendingTaskMutations = { ...s.pendingTaskMutations };
          for (const id of result.deferredDeleteIds) {
            const pending = pendingTaskMutations[id];
            if (pending) pendingTaskMutations[id] = { ...pending, remoteDeleteDeferred: true };
          }
          return {
            tasks: result.tasks,
            lists: snapshot.lists.map(normalizeSyncList),
            counts: snapshot.counts,
            defaultListId: snapshot.defaultListId,
            pendingTaskMutations,
            lastSyncPage: {
              requestKey,
              snapshot,
              revision: (s.lastSyncPage?.revision ?? 0) + 1,
            },
          };
        }),

      drainSyncNotices: () => {
        let notices: string[] = [];
        set((state) => {
          notices = state.syncNotices;
          return notices.length ? { syncNotices: [] } : state;
        });
        return notices;
      },
    }),
    {
      name: "open-todo-store",
      partialize: (state) => ({
        colorMode: state.colorMode,
        sidebarCollapsed: state.sidebarCollapsed,
        glassEnabled: state.glassEnabled,
        soundEnabled: state.soundEnabled,
        sortPreferences: state.sortPreferences,
      }),
    }
  )
);
