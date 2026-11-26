"use client";

import { ChevronDown, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { completedSectionTriggerClass } from "@/components/task-card-style";

export default function CompletedSection({
  children,
  count,
}: {
  children: React.ReactNode;
  count: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const glassEnabled = useAppStore((s) => s.glassEnabled);

  if (count === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="mt-4">
      <CollapsibleTrigger
        className={completedSectionTriggerClass(glassEnabled)}
      >
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform duration-200 group-hover:text-foreground",
            !isOpen && "-rotate-90"
          )}
        />
        <CheckCircle2 className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
        <span className="text-[12px] font-semibold uppercase tracking-[0.18em]">
          Completed
        </span>
        <span className="text-[12px] font-medium text-muted-foreground ml-1">
          {count}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 animate-in fade-in-0 duration-200">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
