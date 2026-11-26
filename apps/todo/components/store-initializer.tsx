"use client";

import { createContext, useContext, useLayoutEffect, useMemo } from "react";
import { useAppStore } from "@/store/app-store";
import type { ListItem, SidebarCounts, UserSettings } from "@/lib/types";
import { setTaskViewCacheUser } from "@/lib/task-view-cache";

type InitialAppData = { lists: ListItem[]; userSettings: UserSettings };

// The server data of this request. Unlike the global store, it exists during
// server rendering, so components can render it into the initial HTML.
const InitialAppDataContext = createContext<InitialAppData | null>(null);

export function useInitialAppData() {
  return useContext(InitialAppDataContext);
}

export function StoreInitializer({
  lists,
  counts,
  defaultListId,
  userSettings,
  children,
}: {
  lists: ListItem[];
  counts: SidebarCounts;
  defaultListId: string;
  userSettings: UserSettings;
  children: React.ReactNode;
}) {
  // Configure the browser cache before descendants request their hydration snapshot.
  if (typeof window !== "undefined") setTaskViewCacheUser(userSettings.id);

  // Hydrate before the browser paints and repeat whenever refreshed server props change.
  useLayoutEffect(() => {
    useAppStore.getState().hydrate({ lists, counts, defaultListId, userSettings });
  }, [lists, counts, defaultListId, userSettings]);

  const initialData = useMemo(() => ({ lists, userSettings }), [lists, userSettings]);
  return <InitialAppDataContext.Provider value={initialData}>{children}</InitialAppDataContext.Provider>;
}
