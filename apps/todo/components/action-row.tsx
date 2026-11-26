"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionRowProps {
  icon?: React.ReactNode;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  active?: boolean;
  chevron?: boolean;
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
  sublabelClassName?: string;
  trailingClassName?: string;
  type?: "button" | "submit" | "reset";
}

export default function ActionRow({
  icon,
  label,
  sublabel,
  trailing,
  onClick,
  destructive,
  active,
  chevron,
  className,
  iconClassName,
  labelClassName,
  sublabelClassName,
  trailingClassName,
  type = "button",
}: ActionRowProps) {
  const content = (
    <>
      {icon && (
        <span
          className={cn(
            "flex-shrink-0 w-5 h-5 flex items-center justify-center",
            destructive ? "text-destructive" : active ? "text-foreground" : "text-muted-foreground",
            iconClassName
          )}
        >
          {icon}
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className={cn("text-[15px] block", active && "font-semibold", labelClassName)}>
          {label}
        </span>
        {sublabel && (
          <span className={cn("text-xs text-muted-foreground block mt-0.5", sublabelClassName)}>
            {sublabel}
          </span>
        )}
      </span>
      {trailing && (
        <span className={cn("ml-4 flex-shrink-0 text-muted-foreground", trailingClassName)}>
          {trailing}
        </span>
      )}
      {chevron && <ChevronRight className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />}
    </>
  );

  const rowClassName = cn(
    "flex items-center gap-4 px-6 py-4 w-full text-left transition-colors",
    destructive ? "text-destructive hover:bg-destructive/5" : "text-foreground hover:bg-accent",
    onClick && "active:bg-accent/80",
    className
  );

  if (!onClick) {
    return <div className={rowClassName}>{content}</div>;
  }

  return (
    <button type={type} onClick={onClick} className={rowClassName}>
      {content}
    </button>
  );
}
