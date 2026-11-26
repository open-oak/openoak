"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function InviteAcceptForm({ token, accountId }: { token: string; accountId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <form onSubmit={async (event) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/kanban/sharing", { method: "POST", headers: { "content-type": "application/json", "x-openkanban-account": accountId }, body: JSON.stringify({ action: "join", token }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Unable to join this board.");
      router.push(`/?board=${encodeURIComponent(result.boardId)}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to join. Try again."); setBusy(false); }
  }}><Button className="w-full" disabled={busy}>{busy ? "Joining…" : "Join board"}</Button>{error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}</form>;
}
