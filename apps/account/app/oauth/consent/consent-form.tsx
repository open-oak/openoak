"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import {
  AuthCard,
  AuthMessage,
  AuthPageShell,
  AuthSubmitButton,
} from "@/components/auth-components";

import { scopeLabels } from "@/lib/oauth-display";

export function OAuthConsentForm({
  clientId,
  clientName,
  clientUri,
  requestedScopes,
}: {
  clientId: string;
  clientName: string;
  clientUri?: string;
  requestedScopes: string[];
}) {
  const [loading, setLoading] = useState<"accept" | "deny" | null>(null);
  const [error, setError] = useState("");

  async function respond(accept: boolean) {
    setLoading(accept ? "accept" : "deny");
    setError("");
    const result = await authClient.oauth2.consent({
      accept,
      scope: accept ? requestedScopes.join(" ") : undefined,
    });
    if (result.error) {
      setError(result.error.message || "Could not finish authorization.");
      setLoading(null);
    }
  }

  return (
    <AuthPageShell>
      <AuthCard>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">OpenOak AI access</p>
        <h1 className="text-2xl font-semibold">Connect {clientName}?</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          This client is asking to use OpenOak on your behalf. You can revoke its access at any time in the Connected services tab on the AI connections page.
        </p>

        {clientUri && (
          <p className="mt-3 break-all text-xs text-muted-foreground">Client: {clientUri}</p>
        )}
        {!clientUri && <p className="mt-3 break-all text-xs text-muted-foreground">Client ID: {clientId}</p>}

        <ul className="mt-6 space-y-3">
          {requestedScopes.map((scope) => (
            <li key={scope} className="rounded-xl border border-border bg-muted/45 px-4 py-3 text-sm">
              {scopeLabels[scope] || scope}
            </li>
          ))}
        </ul>

        {error && <div className="mt-4"><AuthMessage>{error}</AuthMessage></div>}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={Boolean(loading)}
            onClick={() => void respond(false)}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-60"
          >
            {loading === "deny" ? "Denying…" : "Deny"}
          </button>
          <AuthSubmitButton loading={loading === "accept"} loadingLabel="Connecting…" onClick={() => void respond(true)}>
            Allow access
          </AuthSubmitButton>
        </div>
      </AuthCard>
    </AuthPageShell>
  );
}
