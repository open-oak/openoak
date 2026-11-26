"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import type { ListItem, SidebarCounts, UserSettings } from "@/lib/types";
import { getSidebarData, getUserSettings } from "@/app/actions";
import { getBackgroundWithStaticBlur, parseBackground } from "@/lib/utils";
import { toast } from "sonner";

interface PrefetchPayload {
  lists?: ListItem[];
  counts?: SidebarCounts;
  defaultListId?: string;
  userSettings?: UserSettings;
  error?: string;
}

function extractImageUrl(bgValue: string): string | null {
  const match = bgValue.match(/url\(['"]?([^'")\s]+)['"]?\)/);
  return match ? match[1] : null;
}

export function BackgroundPrefetcher() {
  const prefetched = useAppStore((s) => s.prefetched);

  useEffect(() => {
    if (prefetched) return;

    const controller = new AbortController();
    const warmed = new Set<string>();

    const warmBackgroundImage = (raw: string | null | undefined) => {
      if (!raw) return;
      const { bg, blur } = parseBackground(raw);
      if (!bg || bg === "none") return;
      const resolved = getBackgroundWithStaticBlur(bg, blur);
      const imageUrl = extractImageUrl(resolved);
      if (!imageUrl || warmed.has(imageUrl)) return;
      warmed.add(imageUrl);

      const preload = () => {
        const image = new Image();
        image.decoding = "async";
        image.src = imageUrl;
        image.decode?.().catch(() => {});
      };

      const ric = (window as Window & { requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number }).requestIdleCallback;
      if (ric) ric(() => preload(), { timeout: 1500 });
      else setTimeout(preload, 50);
    };

    const warmKnownWallpapers = (data: PrefetchPayload) => {
      data.lists?.forEach((list) => warmBackgroundImage(list.backgroundImage));
      if (data.userSettings) {
        warmBackgroundImage(data.userSettings.myDayBg);
        warmBackgroundImage(data.userSettings.importantBg);
        warmBackgroundImage(data.userSettings.plannedBg);
        warmBackgroundImage(data.userSettings.tasksBg);
      }
    };

    const hydrateFromPayload = (data: PrefetchPayload) => {
      if (data.lists) {
        useAppStore.getState().setLists(data.lists);
      }
      if (data.counts) {
        useAppStore.getState().setCounts(data.counts);
      }
      if (data.defaultListId) {
        useAppStore.getState().setDefaultListId(data.defaultListId);
      }
      if (data.userSettings) {
        useAppStore.getState().setUserSettings(data.userSettings);
      }
      warmKnownWallpapers(data);
    };

    const hydrateFromServerActions = async () => {
      const [sidebarData, userSettings] = await Promise.all([
        getSidebarData(),
        getUserSettings(),
      ]);
      hydrateFromPayload({
        ...sidebarData,
        userSettings,
      });
    };

    fetch("/api/prefetch", { signal: controller.signal })
      .then(async (res) => {
        const payload = await res.json() as PrefetchPayload;
        if (!res.ok || payload?.error) {
          throw new Error(typeof payload?.error === "string" ? payload.error : "Prefetch request failed");
        }
        return payload;
      })
      .then((data) => {
        hydrateFromPayload(data);
      })
      .catch(async () => {
        if (controller.signal.aborted) return;
        try {
          await hydrateFromServerActions();
        } catch {
          if (controller.signal.aborted) return;
          toast.error("Couldn’t refresh your task data. Please reload the page.");
        }
      });

    return () => controller.abort();
  }, [prefetched]);

  return null;
}
