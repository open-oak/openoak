"use client";

import { Trash2 } from "lucide-react";
import type { KanbanList } from "@/lib/kanban-data";
import { cn } from "@/lib/utils";
import { PopoverContent } from "@/components/ui/popover";
import { listColors, listIcons } from "./constants";
import { ListIcon } from "./primitives";

export function ListStyleMenu({
  list,
  canDelete,
  onUpdate,
  onDelete,
}: {
  list: KanbanList;
  canDelete: boolean;
  onUpdate: (updates: Partial<KanbanList>) => void;
  onDelete: () => void;
}) {
  return (
    <PopoverContent align="start" className="w-[min(17rem,calc(100vw-1rem))]" aria-label={`${list.name} style`} onMouseDown={(event) => event.stopPropagation()}>
      <div className="style-menu-section">
        <p className="popover-label">Icon</p>
        <div className="icon-choice-grid">
          {listIcons.map((option) => (
            <button
              key={option.id}
              type="button"
              className={cn("icon-choice", list.icon === option.id && "selected")}
              onClick={() => onUpdate({ icon: option.id })}
              aria-label={`${option.label} icon`}
              aria-pressed={list.icon === option.id}
              title={option.label}
            >
              <ListIcon icon={option.id} />
            </button>
          ))}
        </div>
      </div>

      <div className="style-menu-section">
        <p className="popover-label">Color</p>
        <div className="color-choice-grid">
          {listColors.map((color) => (
            <button
              key={color.id}
              type="button"
              className={cn("color-choice", list.color === color.id && "selected")}
              data-list-color={color.id}
              onClick={() => onUpdate({ color: color.id })}
              aria-label={`${color.label} color`}
              aria-pressed={list.color === color.id}
              title={color.label}
            />
          ))}
        </div>
      </div>

      <button type="button" className="list-style-delete" onClick={onDelete} disabled={!canDelete}>
        <Trash2 className="size-4" aria-hidden="true" />
        <span>{canDelete ? "Delete list" : "One list required"}</span>
      </button>
    </PopoverContent>
  );
}
