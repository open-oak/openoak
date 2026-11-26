"use client";

import { buildVersion } from "../../../shared/build-version";

import { Download, Keyboard, LogOut, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { SheetHandle } from "@/components/sheet-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAppStore } from "@/store/app-store";
import { useSession, signOut } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import ActionRow from "@/components/action-row";
import { RecoveryPanel } from "../../../shared/recovery-panel";
import { loadDeletedTasks, restoreDeletedTask, purgeDeletedTask } from "@/app/actions";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ImportPanel } from "@/components/import-panel";

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
const mod = isMac ? "⌘" : "Ctrl";

const LICENSES = [
  { name: "Next.js", version: "16.1.6", license: "MIT", author: "Vercel, Inc." },
  { name: "React", version: "19.2.3", license: "MIT", author: "Meta Platforms, Inc." },
  { name: "Tailwind CSS", version: "4.x", license: "MIT", author: "Tailwind Labs, Inc." },
  { name: "Prisma", version: "7.5.0", license: "Apache 2.0", author: "Prisma Data, Inc." },
  { name: "Better Auth", version: "1.5.4", license: "MIT", author: "Better Auth" },
  { name: "Zustand", version: "5.0.11", license: "MIT", author: "Poimandres" },
  { name: "Radix UI", version: "1.4.3", license: "MIT", author: "WorkOS" },
  { name: "shadcn/ui", version: "3.x", license: "MIT", author: "shadcn" },
  { name: "lucide-react", version: "0.577.0", license: "ISC", author: "Lucide Contributors" },
  { name: "class-variance-authority", version: "0.7.x", license: "Apache 2.0", author: "Joe Bell" },
  { name: "clsx", version: "2.x", license: "MIT", author: "Luke Edwards" },
  { name: "tailwind-merge", version: "3.5.0", license: "MIT", author: "Dany Castillo" },
  { name: "sonner", version: "2.x", license: "MIT", author: "Emil Kowalski" },
  { name: "date-fns", version: "4.x", license: "MIT", author: "date-fns contributors" },
  { name: "react-day-picker", version: "9.x", license: "MIT", author: "Giampaolo Bellavite" },
  { name: "cmdk", version: "1.x", license: "MIT", author: "Paco Coursey" },
  { name: "dnd kit", version: "6.x", license: "MIT", author: "Claudéric Demers" },
  { name: "Base UI", version: "1.x", license: "MIT", author: "MUI SAS" },
  { name: "next-themes", version: "0.4.x", license: "MIT", author: "Paco Coursey" },
  { name: "tw-animate-css", version: "1.x", license: "MIT", author: "jamiebuilds" },
];

const sectionLabel = "text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2 px-0.5";

function Toggle({ checked }: { checked: boolean }) {
  return (
    <div
      className={cn(
        "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 pointer-events-none",
        checked ? "bg-foreground" : "bg-border"
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 rounded-full bg-background shadow transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </div>
  );
}

function ToggleRow({ label, sublabel, checked, onChange }: {
  label: string;
  sublabel?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <ActionRow
      onClick={() => onChange(!checked)}
      label={label}
      sublabel={sublabel}
      trailing={<Toggle checked={checked} />}
      className="px-4 py-3 gap-3 hover:bg-accent/40"
      labelClassName="text-sm font-medium leading-tight"
      sublabelClassName="text-xs mt-0.5"
    />
  );
}

function NavRow({ label, sublabel, onClick, right }: {
  label: string;
  sublabel?: string;
  onClick: () => void;
  right?: React.ReactNode;
}) {
  return (
    <ActionRow
      onClick={onClick}
      label={label}
      sublabel={sublabel}
      trailing={right}
      chevron={false}
      className="px-4 py-3 gap-3 hover:bg-accent/40"
      labelClassName="text-sm font-medium leading-tight"
      sublabelClassName="text-xs mt-0.5"
    />
  );
}

function DisplayRow({ label, right }: { label: string; right: React.ReactNode }) {
  return (
    <ActionRow
      label={label}
      trailing={right}
      className="px-4 py-3 gap-3 hover:bg-transparent"
      labelClassName="text-sm font-medium leading-tight"
      trailingClassName="text-foreground"
    />
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className={cn(sectionLabel)}>{title}</p>
      <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden divide-y divide-border/40">
        {children}
      </div>
    </div>
  );
}

function LicensesPanel({ onBack, isMobile }: { onBack: () => void; isMobile: boolean }) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className={cn("flex items-center border-b border-border/50 flex-shrink-0", isMobile ? "px-3 pb-4 pt-1" : "px-3 py-2.5")}>
        <button
          onClick={onBack}
          className="flex items-center p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        >
          <span className="text-sm">Back</span>
        </button>
        <span className={cn("font-semibold ml-1", isMobile ? "text-[17px]" : "text-[15px]")}>Software licenses</span>
      </div>
      <div className="flex-1 overflow-y-auto p-5 min-h-0">
        <p className="text-xs text-muted-foreground mb-4">
          Open Todo is built with the following open source software.
        </p>
        <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden divide-y divide-border/40">
          {LICENSES.map((pkg) => (
            <div key={pkg.name} className="flex items-center px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground leading-tight">{pkg.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{pkg.author}</p>
              </div>
              <div className="ml-4 flex-shrink-0">
                <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                  {pkg.license}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MainPanel({ isMobile, onShowLicenses, onShowTrash, onShowImport, onClose }: { isMobile: boolean; onShowLicenses: () => void; onShowTrash: () => void; onShowImport: () => void; onClose: () => void }) {
  const soundEnabled = useAppStore((s) => s.soundEnabled);
  const setSoundEnabled = useAppStore((s) => s.setSoundEnabled);
  const { data: session } = useSession();
  const legalUrl = process.env.NEXT_PUBLIC_LEGAL_URL?.trim();
  const [isExporting, setIsExporting] = useState(false);

  const handleSignOut = () => {
    onClose();
    const accountUrl = process.env.NEXT_PUBLIC_ACCOUNT_URL?.trim();
    signOut({ fetchOptions: { onSuccess: () => { window.location.href = accountUrl ? `${accountUrl}/login` : "/login"; } } });
  };

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);

    try {
      const response = await fetch("/api/export", { cache: "no-store" });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Export request failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1]
        || `opentodo-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("OpenTodo data exported.");
    } catch {
      toast.error("Could not export your OpenTodo data.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="overflow-y-auto p-5 flex-1 min-h-0">
      <SettingsSection title="Tasks">
        <ToggleRow
          label="Completion sound"
          sublabel="Play a sound when a task is completed"
          checked={soundEnabled}
          onChange={setSoundEnabled}
        />
      </SettingsSection>

      <SettingsSection title="Data">
        <NavRow label="Deleted tasks" sublabel="Restore tasks and their steps" onClick={onShowTrash} />
        <ActionRow
          onClick={onShowImport}
          icon={<Upload className="w-4 h-4" />}
          label="Import tasks"
          sublabel="From Microsoft To Do or pasted text"
          className="px-4 py-3 gap-3 hover:bg-accent/40"
          labelClassName="text-sm font-medium leading-tight"
          sublabelClassName="text-xs mt-0.5"
        />
        <ActionRow
          onClick={handleExport}
          icon={<Download className="w-4 h-4" />}
          label={isExporting ? "Exporting…" : "Export data"}
          sublabel="Download your lists and tasks as JSON"
          className="px-4 py-3 gap-3 hover:bg-accent/40"
          labelClassName="text-sm font-medium leading-tight"
          sublabelClassName="text-xs mt-0.5"
        />
      </SettingsSection>

      {!isMobile && (
        <SettingsSection title="Keyboard">
          <NavRow
            label="Keyboard shortcuts"
            sublabel={`${mod} + /`}
            onClick={() => window.dispatchEvent(new Event("show-shortcuts"))}
            right={<Keyboard className="w-4 h-4" />}
          />
        </SettingsSection>
      )}

      <SettingsSection title="Account">
        <ActionRow
          label={session?.user?.name || "Account"}
          sublabel={session?.user?.email}
          className="px-4 py-3 gap-3 hover:bg-transparent"
          labelClassName="text-sm font-medium leading-tight truncate"
          sublabelClassName="text-xs mt-0.5 truncate"
        />
        <ActionRow
          onClick={handleSignOut}
          icon={<LogOut className="w-4 h-4" />}
          label="Sign out"
          destructive
          className="px-4 py-3 gap-2 hover:bg-accent/40"
          labelClassName="text-sm font-medium leading-tight"
        />
      </SettingsSection>

      <SettingsSection title="About">
        <DisplayRow
          label="Version"
          right={<span className="text-xs font-mono text-muted-foreground">{buildVersion(process.env.NEXT_PUBLIC_APP_VERSION, process.env.NEXT_PUBLIC_BUILD_REVISION)}</span>}
        />
        {legalUrl && (
          <NavRow
            label="Terms & Privacy"
            sublabel="Legal information"
            onClick={() => window.open(legalUrl, "_blank")}
          />
        )}
        <NavRow
          label="Software licenses"
          sublabel="Open source acknowledgements"
          onClick={onShowLicenses}
        />
      </SettingsSection>
    </div>
  );
}

export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "licenses" | "trash" | "import">("main");
  const router = useRouter();
  const isMobile = useIsMobile();

  useEffect(() => {
    const handler = () => { setView("main"); setOpen(true); };
    window.addEventListener("open-settings", handler);
    return () => window.removeEventListener("open-settings", handler);
  }, []);

  // Deep link from the website: /?import=microsoft-to-do opens the importer.
  useEffect(() => {
    if (!new URL(window.location.href).searchParams.has("import")) return;
    const timer = window.setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("import");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      setView("import");
      setOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const header = (onClose: () => void, title = "Settings") => (
    <div className={cn(
      "flex items-center border-b border-border/50 flex-shrink-0",
      isMobile ? "px-3 pb-4 pt-1" : "px-3 py-2.5"
    )}>
      <button
        onClick={onClose}
        className="todo-mobile-icon-target flex items-center p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
      >
        <span className="text-sm">{title === "Settings" ? "Close" : "Back"}</span>
      </button>
      <span className={cn("font-semibold ml-1", isMobile ? "text-[17px]" : "text-[15px]")}>{title}</span>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) setView("main"); }}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          overlayClassName="!bg-black/30"
          className="todo-mobile-viewport-overlay todo-mobile-safe-dialog bg-[var(--solid-card)] gap-0 px-0 pb-0 data-[side=bottom]:h-dvh rounded-none flex flex-col"
        >
          <SheetTitle className="sr-only">Settings</SheetTitle>
          <SheetHandle />
          {view === "main" ? (
            <>
              {header(() => setOpen(false))}
              <MainPanel isMobile={true} onShowLicenses={() => setView("licenses")} onShowTrash={() => setView("trash")} onShowImport={() => setView("import")} onClose={() => setOpen(false)} />
            </>
          ) : view === "import" ? (
            <>{header(() => setView("main"), "Import tasks")}<div className="min-h-0 flex-1 overflow-y-auto p-5"><ImportPanel /></div></>
          ) : view === "trash" ? (
            <>{header(() => setView("main"), "Deleted tasks")}<div className="min-h-0 flex-1 overflow-y-auto p-5"><RecoveryPanel load={loadDeletedTasks} restore={restoreDeletedTask} purge={purgeDeletedTask} onRestore={() => router.refresh()} /></div></>
          ) : (
            <LicensesPanel onBack={() => setView("main")} isMobile={true} />
          )}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) setView("main"); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[80dvh] w-full max-w-[480px] flex-col gap-0 overflow-hidden rounded-2xl bg-[var(--solid-card)] p-0">
        <DialogTitle className="sr-only">{view === "trash" ? "Deleted tasks" : view === "import" ? "Import tasks" : view === "licenses" ? "Software licenses" : "Settings"}</DialogTitle>
        {view === "main" ? <>
          {header(() => setOpen(false))}
          <MainPanel isMobile={false} onShowLicenses={() => setView("licenses")} onShowTrash={() => setView("trash")} onShowImport={() => setView("import")} onClose={() => setOpen(false)} />
        </> : view === "import" ? <>
          {header(() => setView("main"), "Import tasks")}
          <div className="min-h-0 flex-1 overflow-y-auto p-5"><ImportPanel /></div>
        </> : view === "trash" ? <>
          {header(() => setView("main"), "Deleted tasks")}
          <div className="min-h-0 flex-1 overflow-y-auto p-5"><RecoveryPanel load={loadDeletedTasks} restore={restoreDeletedTask} purge={purgeDeletedTask} onRestore={() => router.refresh()} /></div>
        </> : <LicensesPanel onBack={() => setView("main")} isMobile={false} />}
      </DialogContent>
    </Dialog>
  );
}
