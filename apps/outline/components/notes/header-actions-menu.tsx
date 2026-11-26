"use client";

import { Check, FileText, Folder, MoreVertical, Paintbrush } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SheetHandle, bottomSheetContentClass } from "@/components/sheet-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type { FolderItem, NoteItem } from "@/lib/types";

export function HeaderActionsMenu({
  onOpenAppearance,
  note,
  folders,
  onMoveToFolder,
  triggerClassName,
}: {
  onOpenAppearance: (anchor: { top: number; right: number } | null) => void;
  note?: NoteItem | null;
  folders?: FolderItem[];
  onMoveToFolder?: (noteId: string, folderId: string | null) => void | Promise<void>;
  triggerClassName?: string;
}) {
  const isMobile = useIsMobile();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openAppearance = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    setSheetOpen(false);
    window.setTimeout(() => {
      onOpenAppearance(rect ? { top: rect.bottom, right: window.innerWidth - rect.right } : null);
    }, 0);
  };

  const move = (folderId: string | null) => {
    if (!note || !onMoveToFolder || note.folderId === folderId) return;
    setSheetOpen(false);
    void onMoveToFolder(note.id, folderId);
  };

  if (isMobile) {
    return (
      <>
        <Button ref={triggerRef} variant="ghost" size="icon" className={cn("h-9 w-9", triggerClassName)} onClick={() => setSheetOpen(true)} aria-label="Note options">
          <MoreVertical className="h-5 w-5" />
        </Button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" showCloseButton={false} overlayClassName="!bg-transparent" className={bottomSheetContentClass("!bg-[var(--notes-panel-solid)]")}>
            <SheetTitle className="sr-only">Note options</SheetTitle>
            <SheetHandle />
            <p className="px-6 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Appearance</p>
            <button type="button" className="flex w-full items-center gap-3 px-6 py-3 text-left text-sm font-medium hover:bg-accent" onClick={openAppearance}>
              <Paintbrush className="h-4 w-4" />
              Theme &amp; background
            </button>
            {note && onMoveToFolder && (
              <>
                <p className="px-6 pb-1 pt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Move to</p>
                <button type="button" className="flex w-full items-center gap-3 px-6 py-3 text-left text-sm font-medium hover:bg-accent" onClick={() => move(null)}>
                  <FileText className="h-4 w-4" /><span className="min-w-0 flex-1">Unsorted Notes</span>{note.folderId === null && <Check className="h-4 w-4" />}
                </button>
                {(folders ?? []).map((folder) => (
                  <button key={folder.id} type="button" className="flex w-full items-center gap-3 px-6 py-3 text-left text-sm font-medium hover:bg-accent" onClick={() => move(folder.id)}>
                    <Folder className="h-4 w-4" /><span className="min-w-0 flex-1 truncate">{folder.name}</span>{note.folderId === folder.id && <Check className="h-4 w-4" />}
                  </button>
                ))}
              </>
            )}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} variant="ghost" size="icon" className={cn("h-9 w-9", triggerClassName)} aria-label="Note options">
          <MoreVertical className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuItem onClick={openAppearance}>
          <Paintbrush className="h-4 w-4" />
          Theme &amp; background
        </DropdownMenuItem>
        {note && onMoveToFolder && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => move(null)}>
              <FileText className="h-4 w-4" /><span className="min-w-0 flex-1">Unsorted Notes</span>{note.folderId === null && <Check className="h-4 w-4" />}
            </DropdownMenuItem>
            {(folders ?? []).map((folder) => (
              <DropdownMenuItem key={folder.id} onSelect={() => move(folder.id)}>
                <Folder className="h-4 w-4" /><span className="min-w-0 flex-1 truncate">{folder.name}</span>{note.folderId === folder.id && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
