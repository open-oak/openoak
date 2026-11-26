"use client";

import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
const mod = isMac ? "⌘" : "Ctrl";

const shortcuts = [
  { keys: `${mod} + K`, description: "Search" },
  { keys: "Space", description: "New task" },
  { keys: `${mod} + A`, description: "Select all (multi-select mode)" },
  { keys: "Shift + Click", description: "Range select tasks" },
  { keys: "Esc", description: "Close panel" },
  { keys: `${mod} + /`, description: "Show shortcuts" },
];

export default function KeyboardShortcuts() {
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShowHelp((prev) => !prev);
      }

      // Space — create new task (when no input is focused)
      if (e.key === " " && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.repeat) return;
        const tag = (document.activeElement as HTMLElement)?.tagName;
        const isEditable = tag === "INPUT" || tag === "TEXTAREA" || (document.activeElement as HTMLElement)?.isContentEditable;
        if (!isEditable) {
          e.preventDefault();
          window.dispatchEvent(new Event("create-new-task"));
        }
      }
    };

    const showHandler = () => setShowHelp(true);

    window.addEventListener("keydown", handler);
    window.addEventListener("show-shortcuts", showHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("show-shortcuts", showHandler);
    };
  }, []);

  return (
    <Dialog open={showHelp} onOpenChange={setShowHelp}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="w-5 h-5" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {shortcuts.map((s) => (
            <div key={s.keys} className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{s.description}</span>
              <kbd className="px-2 py-1 rounded-md bg-muted text-xs font-mono">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
