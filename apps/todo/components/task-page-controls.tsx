"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TaskPageControls as TaskPageControlsProps } from "@/hooks/use-paginated-tasks";

export default function TaskPageControls(props: TaskPageControlsProps) {
  if (props.totalCount <= props.pageSize && !props.hasPrevious) return null;

  const first = props.pageIndex * props.pageSize + 1;
  const last = Math.min(first + props.itemCount - 1, props.totalCount);

  return (
    <nav className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-background/75 px-2 py-1.5 text-sm" aria-label="Task pages">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={props.onPrevious}
        disabled={!props.hasPrevious || props.isLoading}
      >
        <ChevronLeft className="size-4" />
        Previous
      </Button>
      <span className="text-xs font-medium tabular-nums text-muted-foreground" aria-live="polite">
        {props.isLoading ? "Loading…" : `${first}–${last} of ${props.totalCount}`}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={props.onNext}
        disabled={!props.hasNext || props.isLoading}
      >
        Next
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}
