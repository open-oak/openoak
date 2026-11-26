"use client";

import { useActionState, useState } from "react";
import { deleteMyAccount } from "./actions";

export function DeleteAccountForm({ email }: { email: string }) {
  const [confirmation, setConfirmation] = useState("");
  const [state, action, pending] = useActionState(deleteMyAccount, { error: "" });
  const input = "mt-1 block min-h-11 w-full rounded-lg border border-white/30 bg-black/20 px-3 py-2 text-white focus-visible:outline focus-visible:outline-2";
  return <form action={action} className="mt-6 space-y-5">
    <label className="block text-sm">Type your account email to confirm: <strong>{email}</strong>
      <input className={input} type="email" name="email" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="email" required disabled={pending} />
    </label>
    <label className="block text-sm">Current password
      <input className={input} type="password" name="password" autoComplete="current-password" required maxLength={128} disabled={pending} />
    </label>
    {state.error && <p role="alert" className="text-sm text-red-200">{state.error}</p>}
    <button type="submit" disabled={pending} className="min-h-11 rounded-lg border border-red-300/60 bg-red-950 px-4 py-2 font-semibold text-white disabled:opacity-50">{pending ? "Deleting account…" : "Permanently delete my account and data"}</button>
  </form>;
}
