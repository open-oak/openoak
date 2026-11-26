"use client";

import { X, CheckSquare2, Square } from "lucide-react";
import HeaderActionsMenu from "@/components/header-actions-menu";
import MultiSelectActionsMenu from "@/components/multi-select-actions-menu";
import EditListName from "@/components/edit-list-name";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/page-header";
import { useAppStore } from "@/store/app-store";

export default function ListPageHeader({
  listId,
  listName,
  currentBg,
  currentTheme,
  headerScrollTop = 0,
  isMultiSelectMode = false,
  selectedIds,
  allSelected = false,
  onToggleSelectAll,
  onExitMultiSelect,
}: {
  listId: string;
  listName: string;
  currentBg?: string | null;
  currentTheme?: string | null;
  headerScrollTop?: number;
  isMultiSelectMode?: boolean;
  selectedIds?: Set<string>;
  allSelected?: boolean;
  onToggleSelectAll?: () => void;
  onExitMultiSelect?: () => void;
}) {
  const list = useAppStore((state) => state.lists.find((item) => item.id === listId));
  return (
    <PageHeader
      titleText={listName}
      currentBg={currentBg}
      currentTheme={currentTheme}
      headerScrollTop={headerScrollTop}
      subtitle={list?.accessLevel === "editor" ? (
        <p className="text-center text-xs text-muted-foreground">Shared by {list.ownerDisplay} · You can edit</p>
      ) : undefined}
      title={
        <span className="inline-flex max-w-full justify-center">
          <EditListName
            listId={listId}
            currentName={listName}
          />
        </span>
      }
      renderActions={(buttonClass) =>
        isMultiSelectMode ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9", buttonClass)}
              onClick={onToggleSelectAll}
            >
              {allSelected
                ? <CheckSquare2 className="w-5 h-5" />
                : <Square className="w-5 h-5" />}
            </Button>
            {selectedIds && selectedIds.size > 0 && (
              <MultiSelectActionsMenu
                selectedIds={Array.from(selectedIds)}
                onDone={() => onExitMultiSelect?.()}
                triggerClassName={buttonClass}
              />
            )}
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-9 w-9", buttonClass)}
              onClick={onExitMultiSelect}
            >
              <X className="w-5 h-5" />
            </Button>
          </>
        ) : (
          <HeaderActionsMenu
            currentBg={currentBg}
            currentTheme={currentTheme}
            listId={listId}
            showDelete
            triggerClassName={buttonClass}
          />
        )
      }
    />
  );
}
