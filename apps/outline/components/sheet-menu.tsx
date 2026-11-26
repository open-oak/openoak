"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function bottomSheetContentClass(className?: string) {
  return cn("bg-card rounded-t-2xl gap-0 px-0 pb-10 max-h-[85dvh] overflow-hidden", className);
}

export function SheetMenuScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-h-0 overflow-y-auto", className)}>{children}</div>;
}

export function SheetHandle() {
  return <div className="mx-auto mb-2 mt-1 h-1.5 w-12 flex-shrink-0 rounded-full bg-muted-foreground/20" />;
}
