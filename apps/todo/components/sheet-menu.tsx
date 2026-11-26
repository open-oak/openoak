"use client";

import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import React from "react";
import ActionRow from "@/components/action-row";

export function bottomSheetContentClass(className?: string) {
  return cn("bg-card rounded-t-2xl gap-0 px-0 pb-10 max-h-[85dvh] overflow-hidden", className);
}

export function SheetMenuScrollArea({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("min-h-0 overflow-y-auto", className)}>{children}</div>;
}

export function SheetHandle() {
  return <div className="w-12 h-1.5 bg-muted-foreground/20 rounded-full mx-auto mb-2 mt-1 flex-shrink-0" />;
}

export function SheetMenuItem({
  icon,
  label,
  sublabel,
  onClick,
  destructive,
  chevron,
  active,
}: {
  icon?: React.ReactNode;
  label: string;
  sublabel?: string;
  onClick?: () => void;
  destructive?: boolean;
  chevron?: boolean;
  active?: boolean;
}) {
  return (
    <ActionRow
      onClick={onClick}
      icon={icon}
      label={label}
      sublabel={sublabel}
      destructive={destructive}
      chevron={chevron}
      active={active}
    />
  );
}

export function SheetDivider({ className }: { className?: string }) {
  return <div className={cn("border-t border-border/60 my-1", className)} />;
}

export function SheetBackHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1 px-3 pb-2 border-b border-border/60">
      <button
        onClick={onBack}
        className="flex items-center gap-1 p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="w-4 h-4" />
        <span className="text-sm font-medium">Back</span>
      </button>
      <span className="text-[15px] font-semibold ml-1">{label}</span>
    </div>
  );
}

export function SheetSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-6 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
      {children}
    </p>
  );
}
