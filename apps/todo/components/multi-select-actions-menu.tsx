"use client";

import { useState, useTransition } from "react";
import { Sun, Star, FolderInput, Copy, Trash2, ChevronDown, List, CheckCircle2 } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  bulkAddTasksToMyDay, bulkRemoveTasksFromMyDay,
  bulkMarkTasksImportant, bulkUnmarkTasksImportant,
  bulkMoveTasksToList, bulkCopyTasksToList,
  bulkDeleteTasks, bulkCompleteTasks, bulkUncompleteTasks,
} from "@/app/actions";
import {
  SheetHandle,
  SheetMenuItem,
  SheetDivider,
  SheetBackHeader,
  SheetSectionLabel,
  SheetMenuScrollArea,
  bottomSheetContentClass,
} from "@/components/sheet-menu";

type SheetView = "main" | "move" | "copy";

export default function MultiSelectActionsMenu({
  selectedIds,
  onDone,
  triggerClassName,
}: {
  selectedIds: string[];
  onDone: () => void;
  triggerClassName?: string;
}) {
  const router = useRouter();
  const lists = useAppStore((s) => s.lists);
  const tasks = useAppStore((s) => s.tasks);
  const updateTaskOptimistic = useAppStore((s) => s.updateTaskOptimistic);
  const removeTaskOptimistic = useAppStore((s) => s.removeTaskOptimistic);
  const finishTaskMutation = useAppStore((s) => s.finishTaskMutation);
  const [, startTransition] = useTransition();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>("main");

  const count = selectedIds.length;

  // Derive context from selected tasks
  const selectedTasks = selectedIds.map((id) => tasks.get(id)).filter(Boolean);
  const allCompleted = selectedTasks.length > 0 && selectedTasks.every((t) => t!.isCompleted);
  const allImportant = selectedTasks.length > 0 && selectedTasks.every((t) => t!.isImportant);
  const allMyDay = selectedTasks.length > 0 && selectedTasks.every((t) => t!.isMyDay);

  const run = (action: () => Promise<unknown>) => {
    startTransition(async () => {
      let success = false;
      try {
        const result = await action();
        if (result && typeof result === "object" && "error" in result) {
          toast.error((result as { error: string }).error);
        } else {
          success = true;
        }
      } catch {
        toast.error("Failed to update tasks");
      } finally {
        for (const id of selectedIds) finishTaskMutation(id, success);
        router.refresh();
        onDone();
      }
    });
  };

  const handleDelete = () => {
    setShowDeleteConfirm(false);
    for (const id of selectedIds) removeTaskOptimistic(id);
    run(() => bulkDeleteTasks(selectedIds));
  };

  const handleToggleDone = () => {
    if (allCompleted) {
      for (const id of selectedIds) updateTaskOptimistic(id, { isCompleted: false });
      run(() => bulkUncompleteTasks(selectedIds));
    } else {
      for (const id of selectedIds) updateTaskOptimistic(id, { isCompleted: true });
      run(() => bulkCompleteTasks(selectedIds));
    }
  };

  const handleToggleMyDay = () => {
    if (allMyDay) {
      for (const id of selectedIds) updateTaskOptimistic(id, { isMyDay: false });
      run(() => bulkRemoveTasksFromMyDay(selectedIds));
    } else {
      for (const id of selectedIds) updateTaskOptimistic(id, { isMyDay: true });
      run(() => bulkAddTasksToMyDay(selectedIds));
    }
  };

  const handleToggleImportant = () => {
    if (allImportant) {
      for (const id of selectedIds) updateTaskOptimistic(id, { isImportant: false });
      run(() => bulkUnmarkTasksImportant(selectedIds));
    } else {
      for (const id of selectedIds) updateTaskOptimistic(id, { isImportant: true });
      run(() => bulkMarkTasksImportant(selectedIds));
    }
  };

  const handleMoveToList = (listId: string) => {
    for (const id of selectedIds) updateTaskOptimistic(id, { listId });
    run(() => bulkMoveTasksToList(selectedIds, listId));
  };

  const triggerBtn = (onClick: () => void) => (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-9 w-9 relative", triggerClassName)}
      onClick={onClick}
    >
      <ChevronDown className="w-4 h-4" />
      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center leading-none">
        {count}
      </span>
    </Button>
  );

  return (
    <>
      {/* ── Desktop dropdown ── */}
      <div className="hidden md:block">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {triggerBtn(() => {})}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{count} task{count !== 1 ? "s" : ""} selected</DropdownMenuLabel>
            <DropdownMenuItem onClick={handleToggleDone}>
              <CheckCircle2 className="w-4 h-4" />
              {allCompleted ? "Mark as incomplete" : "Mark as complete"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleToggleMyDay}>
              <Sun className="w-4 h-4" />
              {allMyDay ? "Remove from My Day" : "Add to My Day"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleToggleImportant}>
              <Star className="w-4 h-4" />
              {allImportant ? "Remove importance" : "Mark as important"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Move / Copy</DropdownMenuLabel>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="w-4 h-4" />
                Move to List
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                {lists.map((list) => (
                  <DropdownMenuItem key={list.id} onClick={() => handleMoveToList(list.id)}>
                    {list.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Copy className="w-4 h-4" />
                Copy to List
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                {lists.map((list) => (
                  <DropdownMenuItem key={list.id} onClick={() => run(() => bulkCopyTasksToList(selectedIds, list.id))}>
                    {list.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setShowDeleteConfirm(true)}
              variant="destructive"
            >
              <Trash2 className="w-4 h-4" />
              Delete selected
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Mobile bottom sheet ── */}
      <div className="md:hidden">
        {triggerBtn(() => { setSheetView("main"); setSheetOpen(true); })}

        <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) setSheetView("main"); }}>
          <SheetContent side="bottom" showCloseButton={false} className={bottomSheetContentClass()}>
            <SheetTitle className="sr-only">Task actions</SheetTitle>
            <SheetHandle />

            <SheetMenuScrollArea>
              {sheetView === "main" && (
                <>
                  <SheetSectionLabel>{count} task{count !== 1 ? "s" : ""} selected</SheetSectionLabel>
                  <SheetMenuItem
                    icon={<CheckCircle2 className="w-5 h-5" />}
                    label={allCompleted ? "Mark as incomplete" : "Mark as complete"}
                    onClick={() => { handleToggleDone(); setSheetOpen(false); }}
                  />
                  <SheetMenuItem
                    icon={<Sun className="w-5 h-5" />}
                    label={allMyDay ? "Remove from My Day" : "Add to My Day"}
                    onClick={() => { handleToggleMyDay(); setSheetOpen(false); }}
                  />
                  <SheetMenuItem
                    icon={<Star className="w-5 h-5" />}
                    label={allImportant ? "Remove importance" : "Mark as important"}
                    onClick={() => { handleToggleImportant(); setSheetOpen(false); }}
                  />
                  <SheetDivider />
                  <SheetMenuItem
                    icon={<FolderInput className="w-5 h-5" />}
                    label="Move to List"
                    chevron
                    onClick={() => setSheetView("move")}
                  />
                  <SheetMenuItem
                    icon={<Copy className="w-5 h-5" />}
                    label="Copy to List"
                    chevron
                    onClick={() => setSheetView("copy")}
                  />
                  <SheetDivider />
                  <SheetMenuItem
                    icon={<Trash2 className="w-5 h-5" />}
                    label="Delete selected"
                    destructive
                    onClick={() => { setSheetOpen(false); setShowDeleteConfirm(true); }}
                  />
                </>
              )}

              {sheetView === "move" && (
                <>
                  <SheetBackHeader label="Move to List" onBack={() => setSheetView("main")} />
                  {lists.map((list) => (
                    <SheetMenuItem
                      key={list.id}
                      icon={<List className="w-5 h-5" />}
                      label={list.name}
                      onClick={() => { handleMoveToList(list.id); setSheetOpen(false); }}
                    />
                  ))}
                </>
              )}

              {sheetView === "copy" && (
                <>
                  <SheetBackHeader label="Copy to List" onBack={() => setSheetView("main")} />
                  {lists.map((list) => (
                    <SheetMenuItem
                      key={list.id}
                      icon={<List className="w-5 h-5" />}
                      label={list.name}
                      onClick={() => { run(() => bulkCopyTasksToList(selectedIds, list.id)); setSheetOpen(false); }}
                    />
                  ))}
                </>
              )}
            </SheetMenuScrollArea>
          </SheetContent>
        </Sheet>
      </div>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {count} task{count !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>Deleted tasks can be restored from Settings.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
