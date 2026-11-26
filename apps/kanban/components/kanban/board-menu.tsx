"use client";

import { Archive, Download, Paintbrush, Settings, Trash2, Users } from "lucide-react";
import { PopoverContent } from "@/components/ui/popover";

export function BoardMenu({
  boardCount, canDelete = true, onShare, onExport, onArchive,
  onAppearance,
  onDeleteBoard,
  onSettings,
}: {
  boardCount: number; canDelete?: boolean; onShare?: () => void; onExport?: () => void; onArchive?: () => void;
  onAppearance: () => void;
  onDeleteBoard: () => void;
  onSettings: () => void;
}) {
  return (
    <PopoverContent align="end" className="board-menu-popover" role="menu" aria-label="Board actions" onMouseDown={(event) => event.stopPropagation()}>
      <p className="board-menu-label">Appearance</p>
      <button type="button" className="menu-action" role="menuitem" onClick={onAppearance}>
        <Paintbrush className="size-4" aria-hidden="true" />
        <span>Theme &amp; background</span>
      </button>
      <div className="board-menu-separator" role="separator" />
      <p className="board-menu-label">Board</p>
      {onShare && <button type="button" className="menu-action" role="menuitem" onClick={onShare}><Users className="size-4" aria-hidden="true" /><span>Share board</span></button>}
      {onArchive && <button type="button" className="menu-action" role="menuitem" onClick={onArchive}><Archive className="size-4" aria-hidden="true" /><span>Archive</span></button>}
      {onExport && <button type="button" className="menu-action" role="menuitem" onClick={onExport}><Download className="size-4" aria-hidden="true" /><span>Export this board</span></button>}
      <button type="button" className="menu-action" role="menuitem" onClick={onSettings}>
        <Settings className="size-4" aria-hidden="true" />
        <span>Settings</span>
      </button>
      <div className="board-menu-separator" role="separator" />
      {canDelete && <button type="button" className="menu-action destructive-menu-action" role="menuitem" onClick={onDeleteBoard}>
        <Trash2 className="size-4" aria-hidden="true" />
        <span>{boardCount > 1 ? "Delete board" : "Reset board"}</span>
      </button>}
    </PopoverContent>
  );
}
