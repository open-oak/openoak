"use client";

import { useState, useEffect } from "react";
import AppearancePicker from "./appearance-picker";
import type { SmartListType } from "@/lib/types";

export default function AppearancePickerWrapper({
  currentTheme,
  currentBg,
  listId,
  smartListType,
}: {
  currentTheme?: string | null;
  currentBg?: string | null;
  listId?: string;
  smartListType?: SmartListType;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setAnchor(detail ?? null);
      setOpen(true);
    };
    window.addEventListener("open-appearance-picker", handler);
    return () => window.removeEventListener("open-appearance-picker", handler);
  }, []);

  return (
    <AppearancePicker
      open={open}
      onOpenChange={setOpen}
      currentTheme={currentTheme}
      currentBg={currentBg}
      listId={listId}
      smartListType={smartListType}
      anchor={anchor}
    />
  );
}
