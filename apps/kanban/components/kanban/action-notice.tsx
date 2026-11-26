"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

export function ActionNotice({ notice, onDismiss, onUndo, busy }: {
  notice: { tone: "success" | "error"; message: string; undo?: boolean };
  onDismiss: () => void; onUndo: () => void; busy: boolean;
}) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || busy || notice.tone === "error") return;
    const timer = window.setTimeout(onDismiss, 8000);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss, paused, busy]);
  return <div className="action-notice" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <span role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</span>
    {notice.undo && <button className="toolbar-button" type="button" disabled={busy} onClick={onUndo}>Undo</button>}
    <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss message"><X className="size-4" aria-hidden="true" /></button>
  </div>;
}
