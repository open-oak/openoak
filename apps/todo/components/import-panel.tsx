"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MAX_IMPORT_BYTES } from "@/lib/todo-import";
import type { ImportSummary } from "@/lib/todo-import-server";
import { TODO_SYNC_NOW_EVENT } from "@/components/collaboration-sync";

export const IMPORT_GUIDE_URL = "https://www.opentodo.org/microsoft-to-do-alternative";

const button = "min-h-10 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50 hover:bg-accent/40";
const field = "w-full rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function plural(count: number, word: string) {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

function summaryLines(summary: ImportSummary) {
  const lines = [summary.stepsImported
    ? `Imported ${plural(summary.tasksImported, "task")} and ${plural(summary.stepsImported, "step")}.`
    : `Imported ${plural(summary.tasksImported, "task")}.`];
  if (summary.listsCreated) lines.push(`Created ${plural(summary.listsCreated, "new list")}.`);
  if (summary.listsUpdated) lines.push(`Added tasks to ${plural(summary.listsUpdated, "existing list")}.`);
  if (summary.tasksSkipped) lines.push(`Skipped ${plural(summary.tasksSkipped, "task")} that you already have.`);
  if (summary.flaggedEmailListsSkipped) lines.push("Skipped the Flagged email list. It links to Outlook messages.");
  if (summary.attachmentsSkipped) lines.push(`${plural(summary.attachmentsSkipped, "task")} had attachments. The attachments were not imported; the task notes say which ones.`);
  return lines;
}

export function ImportPanel() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [listName, setListName] = useState("Imported tasks");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function runImport() {
    setError("");
    setSummary(null);
    let payload: Record<string, string>;
    if (mode === "file") {
      if (!file) { setError("Choose a file first."); return; }
      if (file.size > MAX_IMPORT_BYTES) { setError("The file is too large. The limit is 4 MB."); return; }
      payload = { kind: "file", filename: file.name, content: await file.text() };
    } else {
      if (!text.trim()) { setError("Paste at least one task."); return; }
      if (text.length > MAX_IMPORT_BYTES) { setError("The text is too long. The limit is 4 MB."); return; }
      payload = { kind: "text", content: text, listName };
    }

    setBusy(true);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const result = await response.json().catch(() => null) as { summary?: ImportSummary; error?: string } | null;
      if (!response.ok || !result?.summary) {
        setError(result?.error || "The import did not work. Check your connection and try again.");
        return;
      }
      setSummary(result.summary);
      setFile(null);
      setText("");
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
      window.dispatchEvent(new Event(TODO_SYNC_NOW_EVENT));
    } catch {
      setError("The import did not work. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div aria-busy={busy} className="text-foreground">
      <p className="mb-4 text-sm text-muted-foreground">
        Bring your lists and tasks from Microsoft To Do or another app. If you import the same data again, tasks you already have are skipped.
      </p>

      <div role="tablist" aria-label="Import source" className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-border/50 bg-muted/20 p-1">
        {(["file", "text"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => { setMode(value); setError(""); }}
            className={cn(
              "min-h-9 rounded-lg px-3 text-sm font-medium transition-colors",
              mode === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "file" ? "Microsoft To Do file" : "Paste text"}
          </button>
        ))}
      </div>

      {mode === "file" ? (
        <div className="space-y-3">
          <p className="text-sm">
            Use the JSON or CSV file from the free Microsoft To Do Export tool. It keeps lists, notes, steps, due dates, importance and completed tasks. Repeat and reminder settings are added to the task notes.
          </p>
          <a href={IMPORT_GUIDE_URL} target="_blank" rel="noopener" className="inline-block text-sm font-medium underline underline-offset-4">
            How to get the file
          </a>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Export file</span>
            <input
              ref={fileInput}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:min-h-9 file:rounded-lg file:border file:border-border/60 file:bg-background file:px-3 file:text-sm file:font-medium file:text-foreground"
            />
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            Copy tasks from Microsoft To Do (or the text of a printed list) and paste them here. One task per line. Indented lines become steps. A line that starts with # starts a new list.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">List name</span>
            <input value={listName} onChange={(event) => setListName(event.target.value)} maxLength={255} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Tasks</span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              placeholder={"Buy groceries\n  Milk\n  Bread\nCall the dentist\n\n# Work\nSend the report"}
              className={cn(field, "font-mono text-[13px] leading-relaxed")}
            />
          </label>
        </div>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
      {summary && (
        <div role="status" className="mt-4 rounded-xl border border-border/50 bg-muted/20 p-3 text-sm">
          {summaryLines(summary).map((line) => <p key={line}>{line}</p>)}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={cn(button, "bg-foreground text-background hover:bg-foreground/90")} disabled={busy} onClick={() => void runImport()}>
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </div>
  );
}
