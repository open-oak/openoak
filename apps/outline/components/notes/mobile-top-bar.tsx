"use client";

import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { displayTitle, type SaveState } from "@/lib/notes-view";
import type { FolderItem, NoteItem } from "@/lib/types";
import { HeaderActionsMenu } from "./header-actions-menu";

export function MobileTopBar({
  selectedNote,
  saveState,
  onOpenSidebar,
  onOpenAppearance,
  folders,
  onMoveToFolder,
}: {
  selectedNote: NoteItem | null;
  saveState: SaveState;
  onOpenSidebar: () => void;
  onOpenAppearance: (anchor: { top: number; right: number } | null) => void;
  folders: FolderItem[];
  onMoveToFolder: (noteId: string, folderId: string | null) => void | Promise<void>;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-3 md:hidden">
      <button className="notes-icon-button" type="button" onClick={onOpenSidebar} aria-label="Open OpenOutline navigation">
        <Menu className="size-5" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{selectedNote ? displayTitle(selectedNote) : "OpenOutline"}</p>
        <p
          role="status"
          aria-live="polite"
          className={cn("text-[11px]", saveState === "error" ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground")}
        >
          {saveState === "saving" ? "Saving" : saveState === "error" ? "Not saved" : "Saved"}
        </p>
      </div>
      <HeaderActionsMenu onOpenAppearance={onOpenAppearance} note={selectedNote} folders={folders} onMoveToFolder={onMoveToFolder} />
    </header>
  );
}
