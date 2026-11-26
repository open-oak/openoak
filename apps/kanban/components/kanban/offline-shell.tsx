"use client";
import { useEffect, useState } from "react";
import { KanbanApp } from "@/components/kanban-app";
import Link from "next/link";

export default function OfflineShell() {
  const [accountId, setAccountId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    queueMicrotask(() => {
      try { setAccountId(window.localStorage.getItem("openkanban-offline-account")); }
      catch { setAccountId(null); }
    });
  }, []);
  if (!accountId) return <main className="p-8"><h1>OpenKanban</h1><p>{accountId === undefined ? "Opening saved boards…" : "Connect and open a board once to make it available offline."}</p><Link href="/" prefetch={false}>Try connecting again</Link></main>;
  return <KanbanApp accountId={accountId} modular />;
}
