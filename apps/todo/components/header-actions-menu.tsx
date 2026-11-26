"use client";

import React from "react";
import {
  MoreVertical, ArrowUpDown, Paintbrush, Trash2, CheckSquare, Share2,
  ArrowDown, ArrowUp, Check, GripVertical,
} from "lucide-react";
import { useState, useTransition, useRef } from "react";
import { deleteList } from "@/app/actions";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useAppStore } from "@/store/app-store";
import type { SmartListType, SortOption, SortDirection } from "@/lib/types";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SheetHandle,
  SheetMenuItem,
  SheetDivider,
  SheetBackHeader,
  SheetMenuScrollArea,
  SheetSectionLabel,
  bottomSheetContentClass,
} from "@/components/sheet-menu";
import { toast } from "sonner";
import { ListSharingDialog } from "@/components/list-sharing-dialog";

const DEFAULT_DIR: Record<SortOption, SortDirection> = {
  created: "desc",
  alpha: "asc",
  importance: "desc",
  due: "asc",
  custom: "desc",
};

type SheetView = "main" | "sort";

export default function HeaderActionsMenu({
  listId,
  showDelete = false,
  triggerClassName,
  currentBg,
  currentTheme,
  smartListType,
}: {
  currentBg?: string | null;
  currentTheme?: string | null;
  listId?: string;
  smartListType?: SmartListType;
  showDelete?: boolean;
  triggerClassName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const setLists = useAppStore((s) => s.setLists);
  const lists = useAppStore((s) => s.lists);
  const setSortPreference = useAppStore((s) => s.setSortPreference);
  const storedSortPreference = useAppStore((s) => s.sortPreferences[pathname]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>("main");
  const [showSharing, setShowSharing] = useState(false);
  void currentBg;
  void currentTheme;
  void smartListType;

  const sortParam = searchParams.get("sort");
  const dirParam = searchParams.get("dir");
  const currentSort: SortOption =
    sortParam === "alpha" || sortParam === "importance" || sortParam === "created" || sortParam === "due" || sortParam === "custom"
      ? sortParam
      : (storedSortPreference?.sort ?? "created");
  const sortFromParam =
    sortParam === "alpha" || sortParam === "importance" || sortParam === "created" || sortParam === "due" || sortParam === "custom";
  const currentDir: SortDirection =
    dirParam === "asc" || dirParam === "desc"
      ? dirParam
      : (sortFromParam ? DEFAULT_DIR[currentSort] : (storedSortPreference?.dir ?? DEFAULT_DIR[currentSort]));

  const setSort = (sort: SortOption) => {
    const nextDir = sort === "custom"
      ? "desc"
      : (sort === currentSort
          ? currentDir === "desc" ? "asc" : "desc"
          : DEFAULT_DIR[sort] ?? "asc");
    setSortPreference(pathname, { sort, dir: nextDir });

    const params = new URLSearchParams(searchParams.toString());
    if (sort === "custom") {
      params.set("sort", "custom");
      params.delete("dir");
    } else {
      if (sort === "created") {
        params.delete("sort");
      } else {
        params.set("sort", sort);
      }
      const newDir = nextDir;
      if (newDir === "desc") {
        params.delete("dir");
      } else {
        params.set("dir", newDir);
      }
    }
    const query = params.toString();
    router.push(query ? `?${query}` : window.location.pathname);
  };

  const toggleDirection = () => {
    const params = new URLSearchParams(searchParams.toString());
    const newDir = currentDir === "desc" ? "asc" : "desc";
    setSortPreference(pathname, { sort: currentSort, dir: newDir });
    if (newDir === "desc") {
      params.delete("dir");
    } else {
      params.set("dir", newDir);
    }
    const query = params.toString();
    router.push(query ? `?${query}` : window.location.pathname);
  };

  const handleDelete = () => {
    if (!listId) return;
    const previousLists = lists;
    setShowDeleteConfirm(false);
    setLists(lists.filter((l) => l.id !== listId));
    router.push("/tasks");
    startTransition(async () => {
      const result = await deleteList(listId);
      if (result?.error) {
        setLists(previousLists);
        toast.error(result.error);
      }
      router.refresh();
    });
  };

  const sortOptions: { value: SortOption; label: string; icon?: React.ReactNode }[] = [
    { value: "custom",     label: "Custom order",   icon: <GripVertical className="w-4 h-4 mr-2" /> },
    { value: "created",    label: "Date created" },
    { value: "due",        label: "Due date" },
    { value: "alpha",      label: "Alphabetically" },
    { value: "importance", label: "Importance" },
  ];

  const triggerRef = useRef<HTMLButtonElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const activeList = listId ? lists.find((list) => list.id === listId) : null;
  const canShare = activeList?.kind === "CUSTOM";
  const canDelete = showDelete && activeList?.accessLevel === "owner";
  const restoreTriggerFocus = () => (window.matchMedia("(max-width: 767px)").matches ? mobileTriggerRef : triggerRef).current?.focus();
  const openSheet = () => { setSheetView("main"); setSheetOpen(true); };

  const openAppearancePicker = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    window.dispatchEvent(new CustomEvent("open-appearance-picker", {
      detail: rect ? { top: rect.bottom, right: window.innerWidth - rect.right } : null,
    }));
  };

  return (
    <>
      {/* ── Desktop dropdown ── */}
      <div className="hidden md:block">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={triggerRef} variant="ghost" size="icon" className={cn("h-9 w-9", triggerClassName)} aria-label="List options">
              <MoreVertical className="w-5 h-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>View</DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowUpDown className="w-4 h-4" />
                Sort
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                {sortOptions.map(({ value, label }) => {
                  const isActive = currentSort === value;
                  return (
                    <DropdownMenuItem key={value} onClick={() => setSort(value)} className={isActive ? "font-semibold" : ""}>
                      {isActive ? <Check className="w-4 h-4" /> : <span className="w-4 h-4" />}
                      {label}
                    </DropdownMenuItem>
                  );
                })}
                {currentSort !== "custom" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={toggleDirection}>
                      {currentDir === "asc" ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                      {currentDir === "asc" ? "Ascending" : "Descending"}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => window.dispatchEvent(new Event("open-multi-select-mode"))}>
              <CheckSquare className="w-4 h-4" />
              Multi-select
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Appearance</DropdownMenuLabel>
            <DropdownMenuItem onClick={openAppearancePicker}>
              <Paintbrush className="w-4 h-4" />
              Theme & background
            </DropdownMenuItem>
            {canShare && listId && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Sharing</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setShowSharing(true)}>
                  <Share2 className="w-4 h-4" />
                  {activeList?.accessLevel === "owner" ? "Share & members" : "Sharing & owner"}
                </DropdownMenuItem>
              </>
            )}
            {canDelete && listId && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete list
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Mobile bottom sheet ── */}
      <div className="md:hidden">
        <Button ref={mobileTriggerRef} variant="ghost" size="icon" className={cn("h-9 w-9", triggerClassName)} onClick={openSheet} aria-label="List options">
          <MoreVertical className="w-5 h-5" />
        </Button>

        <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) setSheetView("main"); }}>
          <SheetContent side="bottom" showCloseButton={false} className={bottomSheetContentClass()}>
            <SheetTitle className="sr-only">List options</SheetTitle>
            <SheetHandle />

            <SheetMenuScrollArea>
              {sheetView === "main" && (
                <>
                  <SheetMenuItem
                    icon={<ArrowUpDown className="w-5 h-5" />}
                    label="Sort"
                    sublabel={sortOptions.find(s => s.value === currentSort)?.label}
                    chevron
                    onClick={() => setSheetView("sort")}
                  />
                  <SheetMenuItem
                    icon={<CheckSquare className="w-5 h-5" />}
                    label="Multi-select"
                    onClick={() => { setSheetOpen(false); window.dispatchEvent(new Event("open-multi-select-mode")); }}
                  />
                  <SheetDivider />
                  <SheetSectionLabel>Appearance</SheetSectionLabel>
                  <SheetMenuItem
                    icon={<Paintbrush className="w-5 h-5" />}
                    label="Theme"
                    onClick={() => { setSheetOpen(false); openAppearancePicker(); }}
                  />
                  {canShare && listId && (
                    <>
                      <SheetDivider />
                      <SheetSectionLabel>Sharing</SheetSectionLabel>
                      <SheetMenuItem
                        icon={<Share2 className="w-5 h-5" />}
                        label={activeList?.accessLevel === "owner" ? "Share & members" : "Sharing & owner"}
                        onClick={() => { setSheetOpen(false); setShowSharing(true); }}
                      />
                    </>
                  )}
                  {canDelete && listId && (
                    <>
                      <SheetDivider />
                      <SheetMenuItem
                        icon={<Trash2 className="w-5 h-5" />}
                        label="Delete list"
                        destructive
                        onClick={() => { setSheetOpen(false); setShowDeleteConfirm(true); }}
                      />
                    </>
                  )}
                </>
              )}

              {sheetView === "sort" && (
                <>
                  <SheetBackHeader label="Sort" onBack={() => setSheetView("main")} />
                  {sortOptions.map(({ value, label }) => {
                    const isActive = currentSort === value;
                    return (
                      <SheetMenuItem
                        key={value}
                        icon={isActive ? <Check className="w-5 h-5" /> : <span className="w-5 h-5" />}
                        label={label}
                        active={isActive}
                        onClick={() => { setSort(value); setSheetOpen(false); }}
                      />
                    );
                  })}
                  {currentSort !== "custom" && (
                    <>
                      <SheetDivider />
                      <SheetMenuItem
                        icon={currentDir === "asc" ? <ArrowUp className="w-5 h-5" /> : <ArrowDown className="w-5 h-5" />}
                        label={currentDir === "asc" ? "Ascending" : "Descending"}
                        sublabel="Tap to toggle"
                        onClick={() => { toggleDirection(); setSheetOpen(false); }}
                      />
                    </>
                  )}
                </>
              )}
            </SheetMenuScrollArea>
          </SheetContent>
        </Sheet>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete list?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete all tasks in the list. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {listId && (
        <ListSharingDialog
          listId={listId}
          open={showSharing}
          onOpenChange={setShowSharing}
          onClosedFocus={restoreTriggerFocus}
        />
      )}
    </>
  );
}
