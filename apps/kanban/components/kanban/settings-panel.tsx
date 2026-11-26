"use client";

import { ChevronLeft, Download, LogOut, Upload } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import { licenses } from "./constants";
import { ActionRow, SettingsSection } from "./primitives";

export function SettingsPanel({
  open, name, email,
  boardCount, onClose, canDeleteBoard = true,
  onDeleteBoard,
  onExportBoards, onImportBoards,
}: {
  open: boolean;
  name?: string | null;
  email?: string | null;
  boardCount: number; canDeleteBoard?: boolean;
  onClose: () => void;
  onDeleteBoard: () => void;
  onExportBoards: () => void;
  onImportBoards: () => void;
}) {
  const [view, setView] = useState<"main" | "licenses">("main");
  const legalUrl = process.env.NEXT_PUBLIC_LEGAL_URL?.trim();
  const close = () => { setView("main"); onClose(); };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent
        showCloseButton={false}
        className="kanban-mobile-viewport-dialog inset-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-[var(--solid-card)] p-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[85dvh] sm:max-w-[520px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border"
      >
        <DialogHeader className="kanban-mobile-dialog-header flex-row items-center gap-2 border-b px-3 py-3 text-left">
          <Button variant="ghost" size="icon" className="kanban-mobile-icon-target" onClick={view === "licenses" ? () => setView("main") : close} aria-label={view === "licenses" ? "Back to settings" : "Close settings"}>
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Button>
          <div>
            <DialogTitle>{view === "licenses" ? "Software licenses" : "Settings"}</DialogTitle>
            <DialogDescription className={view === "licenses" ? undefined : "sr-only"}>
              {view === "licenses" ? "Open source acknowledgements" : "Application settings"}
            </DialogDescription>
          </div>
        </DialogHeader>

        {view === "licenses" ? (
          <div className="kanban-mobile-dialog-body min-h-0 flex-1 overflow-y-auto p-5">
            <div className="license-list">
              {licenses.map((item) => (
                <div key={item.name} className="license-row">
                  <span><strong>{item.name}</strong><small>{item.author} · {item.version}</small></span>
                  <span className="license-pill">{item.license}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="kanban-mobile-dialog-body min-h-0 flex-1 overflow-y-auto p-5">
            <SettingsSection title="Board">
              {canDeleteBoard && <ActionRow label={boardCount > 1 ? "Delete board" : "Reset board"} sublabel={boardCount > 1 ? "Remove the active board" : "Clear the only board"} destructive onClick={onDeleteBoard} />}
            </SettingsSection>

            <SettingsSection title="Local data">
              <ActionRow icon={<Download className="size-4" />} label="Export boards" sublabel="Download a local JSON backup" onClick={onExportBoards} />
              <ActionRow icon={<Upload className="size-4" />} label="Import boards" sublabel="Open an OpenKanban backup" onClick={onImportBoards} />
            </SettingsSection>

            <SettingsSection title="Account">
              <ActionRow label={name || "Account"} sublabel={email} />
              <Button variant="ghost" className="h-auto w-full justify-start px-4 py-3 text-destructive hover:text-destructive" type="button" onClick={async () => { await authClient.signOut(); window.localStorage.removeItem("openkanban-offline-account"); const accountUrl = process.env.NEXT_PUBLIC_ACCOUNT_URL?.trim(); window.location.assign(accountUrl ? `${accountUrl}/login` : "/login"); }}><LogOut className="size-4" />Sign out</Button>
            </SettingsSection>

            <SettingsSection title="About">
              <ActionRow label="Version" trailing={<span className="version-pill">v1.0</span>} />
              {legalUrl && <ActionRow label="Terms & Privacy" sublabel="Legal information" chevron onClick={() => window.open(legalUrl, "_blank")} />}
              <ActionRow label="Software licenses" sublabel="Open source acknowledgements" chevron onClick={() => setView("licenses")} />
            </SettingsSection>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
