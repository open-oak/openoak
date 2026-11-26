import { cn } from "@/lib/utils";

export function taskCardSurfaceClass(glassEnabled: boolean) {
  return glassEnabled
    ? "bg-card/[0.75] shadow-sm ring-1 ring-border/50"
    : "bg-card shadow-sm";
}

export function taskItemClass({
  glassEnabled,
  isSelected,
  isMultiSelected,
  isDragging,
}: {
  glassEnabled: boolean;
  isSelected?: boolean;
  isMultiSelected?: boolean;
  isDragging?: boolean;
}) {
  return cn(
    "group flex items-center px-4 py-3 min-h-[4.25rem] rounded-2xl cursor-pointer border transition-[background-color,border-color,box-shadow,transform] duration-200",
    taskCardSurfaceClass(glassEnabled),
    isMultiSelected
      ? "border-primary/35 ring-2 ring-primary/25 bg-muted hover:bg-muted shadow-sm"
      : isSelected
      ? "border-primary/25 shadow-md ring-1 ring-primary/10 bg-card/95"
      : "border-border/60 hover:border-border hover:bg-muted hover:shadow-sm",
    isDragging && "opacity-40 scale-[0.99]"
  );
}

export function completedSectionTriggerClass(glassEnabled: boolean) {
  return cn(
    "group flex items-center gap-2 px-4 py-2.5 mb-3 rounded-2xl text-foreground transition-all border border-border/60 hover:border-border hover:bg-muted hover:shadow-sm",
    taskCardSurfaceClass(glassEnabled)
  );
}

export function addTaskMobileButtonClass(glassEnabled: boolean) {
  return cn(
    "md:hidden pointer-events-auto ml-auto rounded-2xl w-[4.25rem] h-[4.25rem] shadow-md mb-2 text-foreground border border-border/60",
    glassEnabled ? "bg-card/[0.75] hover:bg-card/[0.85]" : "bg-card hover:bg-card/95"
  );
}

export function addTaskInlineBarClass(glassEnabled: boolean) {
  return cn(
    "hidden md:flex pointer-events-auto flex-1 border rounded-2xl px-3.5 min-h-[4.25rem] items-center shadow-sm ring-1 ring-border/60",
    glassEnabled ? "bg-card/[0.75]" : "bg-card"
  );
}
