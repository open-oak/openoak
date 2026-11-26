"use client";

import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Cloud,
  CloudOff,
  Flag,
  ListTodo,
  LoaderCircle,
  Star,
} from "lucide-react";
import type { ListIconId } from "@/lib/kanban-data";
import { cn } from "@/lib/utils";
import type { SyncStatus } from "./constants";

export function SyncBadge({ status }: { status: SyncStatus }) {
  const label =
    status === "loading"
      ? "Connecting"
      : status === "saving"
        ? "Saving"
        : status === "synced"
          ? "Synced"
          : status === "conflict"
            ? "Needs review"
            : "Offline";

  return (
    <span className={cn("sync-badge", `sync-badge-${status}`)} role="status" aria-live={status === "offline" || status === "conflict" ? "polite" : "off"} title={status === "offline" ? "Offline: changes are saved on this device" : `Cloud sync: ${label}`}>
      {status === "loading" || status === "saving" ? (
        <LoaderCircle className="size-3.5 sync-spinner" aria-hidden="true" />
      ) : status === "synced" ? (
        <Cloud className="size-3.5" aria-hidden="true" />
      ) : (
        <CloudOff className="size-3.5" aria-hidden="true" />
      )}
      <span>{label}</span>
    </span>
  );
}

export function Toggle({ checked }: { checked: boolean }) {
  return (
    <span className={cn("toggle-shell", checked && "toggle-shell-on")} aria-hidden="true">
      <span />
    </span>
  );
}

export function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <p className="section-label">{title}</p>
      <div className="settings-row-group">{children}</div>
    </section>
  );
}

export function ActionRow({
  icon,
  label,
  sublabel,
  trailing,
  onClick,
  destructive,
  chevron,
  children,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  sublabel?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  destructive?: boolean;
  chevron?: boolean;
  children?: React.ReactNode;
}) {
  const content = (
    <>
      {icon && <span className="action-row-icon">{icon}</span>}
      <span className="action-row-text">
        <strong>{label}</strong>
        {sublabel && <small>{sublabel}</small>}
      </span>
      {children}
      {trailing && <span className="action-row-trailing">{trailing}</span>}
      {chevron && <ChevronRight className="size-4 chevron-icon" aria-hidden="true" />}
    </>
  );

  const className = cn("action-row", destructive && "destructive-row", !onClick && "static-row");
  if (!onClick) return <div className={className}>{content}</div>;
  return (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  );
}

export function ListIcon({ icon, className }: { icon: ListIconId; className?: string }) {
  const iconClassName = cn("size-4", className);
  switch (icon) {
    case "clock":
      return <Clock3 className={iconClassName} aria-hidden="true" />;
    case "check":
      return <CheckCircle2 className={iconClassName} aria-hidden="true" />;
    case "flag":
      return <Flag className={iconClassName} aria-hidden="true" />;
    case "briefcase":
      return <Briefcase className={iconClassName} aria-hidden="true" />;
    case "star":
      return <Star className={iconClassName} aria-hidden="true" />;
    case "calendar":
      return <CalendarDays className={iconClassName} aria-hidden="true" />;
    case "todo":
      return <ListTodo className={iconClassName} aria-hidden="true" />;
    case "circle":
    default:
      return <Circle className={iconClassName} aria-hidden="true" />;
  }
}
