"use client";

import { buildVersion } from "../../../../shared/build-version";

import { LogOut } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import { LICENSES } from "./constants";
import { RecoveryPanel } from "../../../../shared/recovery-panel";
import { loadDeletedNotes, restoreDeletedNote, purgeDeletedNote } from "@/app/actions";

export function SettingsMenu({ name, email, accountUrl, onClose, onRestore }: {
  name: string | null;
  email: string | null;
  accountUrl: string;
  onClose: () => void;
  onRestore: () => void;
}) {
  const [view, setView] = useState<"main" | "licenses" | "trash">("main");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  async function exportNotes() {
    setExporting(true); setExportError("");
    try {
      const response = await fetch("/api/export", { cache: "no-store" });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Export failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url; link.download = `openoutline-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch { setExportError("Could not export notes. Check your connection and try again."); }
    finally { setExporting(false); }
  }
  const legalUrl = process.env.NEXT_PUBLIC_LEGAL_URL?.trim();

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="notes-mobile-dialog inset-x-0 bottom-auto flex w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-[var(--notes-panel-solid)] p-0 md:inset-auto md:left-1/2 md:top-1/2 md:h-auto md:max-h-[85dvh] md:max-w-[520px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border"
      >
        <DialogHeader className="flex-row items-center gap-2 border-b px-3 py-3 text-left">
          <Button variant="ghost" onClick={view !== "main" ? () => setView("main") : onClose} aria-label={view !== "main" ? "Back to settings" : "Close settings"}>
            <span className="text-sm">{view === "main" ? "Close" : "Back"}</span>
          </Button>
          <div>
            <DialogTitle>{view === "trash" ? "Deleted notes" : view === "licenses" ? "Software licenses" : "Settings"}</DialogTitle>
            <DialogDescription className={view === "licenses" ? undefined : "sr-only"}>
              {view === "licenses" ? "Open source acknowledgements" : "Application settings"}
            </DialogDescription>
          </div>
        </DialogHeader>

        {view === "licenses" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="overflow-hidden rounded-xl border bg-muted/20 divide-y divide-border/40">
              {LICENSES.map((item) => (
                <div key={item.name} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.name}</p><p className="truncate text-xs text-muted-foreground">{item.author}</p></div>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{item.license}</span>
                </div>
              ))}
            </div>
          </div>
        ) : view === "trash" ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-5"><RecoveryPanel load={loadDeletedNotes} restore={restoreDeletedNote} purge={purgeDeletedNote} onRestore={onRestore} /></div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <SettingsSection title="Data"><button type="button" disabled={exporting} className="min-h-12 w-full px-4 py-3 text-left text-sm hover:bg-accent/40 disabled:opacity-50" onClick={() => void exportNotes()}>{exporting ? "Exporting…" : "Export notes as JSON"}</button>{exportError && <p role="alert" className="px-4 py-3 text-sm text-destructive">{exportError}</p>}<NavRow label="Deleted notes" description="Restore deleted notes" onClick={() => setView("trash")} /></SettingsSection>
            <SettingsSection title="Account" icon={<LogOut className="size-4" aria-hidden="true" />}>
              <div className="px-4 py-3"><p className="truncate text-sm font-medium">{name || "Account"}</p>{email && <p className="truncate text-xs text-muted-foreground">{email}</p>}</div>
              <Button variant="ghost" className="h-auto w-full justify-start px-4 py-3 text-destructive hover:text-destructive" type="button" onClick={async () => { await authClient.signOut(); window.location.assign(accountUrl ? `${accountUrl}/login` : "/login"); }}><LogOut className="size-4" aria-hidden="true" />Sign out</Button>
            </SettingsSection>

            <SettingsSection title="About">
              <DisplayRow label="Version" value={buildVersion(process.env.NEXT_PUBLIC_APP_VERSION, process.env.NEXT_PUBLIC_BUILD_REVISION)} />
              {legalUrl && <NavRow label="Terms & Privacy" description="Legal information" onClick={() => window.open(legalUrl, "_blank")} />}
              <NavRow label="Software licenses" description="Open source acknowledgements" onClick={() => setView("licenses")} />
            </SettingsSection>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return <section className="mb-6"><div className="mb-2 flex items-center gap-2 px-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{icon}{title}</div><div className="space-y-0 overflow-hidden rounded-xl border border-border/50 bg-muted/20 divide-y divide-border/40">{children}</div></section>;
}

function NavRow({ label, description, onClick }: { label: string; description: string; onClick: () => void }) {
  return <button type="button" className="flex w-full items-center px-4 py-3 text-left hover:bg-accent/40" onClick={onClick}><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted-foreground">{description}</span></span></button>;
}

function DisplayRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between px-4 py-3 text-sm"><span className="font-medium">{label}</span><span className="font-mono text-xs text-muted-foreground">{value}</span></div>;
}
