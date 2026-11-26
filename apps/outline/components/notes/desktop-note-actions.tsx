"use client";

import { AlertTriangle, Check } from "lucide-react";
import type { SaveState } from "@/lib/notes-view";
import { cn } from "@/lib/utils";
import { HeaderActionsMenu } from "./header-actions-menu";
import type { FolderItem, NoteItem } from "@/lib/types";

export function DesktopNoteActions({
  saveState,
  showSaveStatus = true,
  onOpenAppearance,
  note,
  folders,
  onMoveToFolder,
  className,
}: {
  saveState: SaveState;
  showSaveStatus?: boolean;
  onOpenAppearance: (anchor: { top: number; right: number } | null) => void;
  note?: NoteItem | null;
  folders?: FolderItem[];
  onMoveToFolder?: (noteId: string, folderId: string | null) => void | Promise<void>;
  className?: string;
}) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      {showSaveStatus && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "notes-action-surface inline-flex h-10 min-w-[5.625rem] shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold",
            saveState === "error" ? "text-red-700 dark:text-red-200" : "text-muted-foreground"
          )}
        >
          {saveState === "saving" ? (
            <span className="size-2 rounded-full bg-[var(--notes-accent)]" />
          ) : saveState === "error" ? (
            <AlertTriangle className="size-3.5" />
          ) : (
            <Check className="size-3.5" />
          )}
          {saveState === "saving" ? "Saving" : saveState === "error" ? "Not saved" : "Saved"}
        </div>
      )}
      <HeaderActionsMenu
        onOpenAppearance={onOpenAppearance}
        note={note}
        folders={folders}
        onMoveToFolder={onMoveToFolder}
        triggerClassName="notes-action-surface h-10 w-10 shrink-0 rounded-xl hover:bg-[var(--popover)]"
      />
    </div>
  );
}
