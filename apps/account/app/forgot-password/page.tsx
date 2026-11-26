"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { AuthCard, AuthField, AuthFooter, AuthLink, AuthMessage, AuthPageShell, AuthSubmitButton } from "@/components/auth-components";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hp, setHp] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (hp) return;
    setError("");
    setLoading(true);

    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });

    if (error) {
      setError(error.message ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    setSent(true);
  }

  return (
    <AuthPageShell
      footer={
        <AuthFooter>
          <AuthLink href="/login">Back to login</AuthLink>
        </AuthFooter>
      }
    >
      <AuthCard>
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">@</div>
            <h2 className="text-xl font-semibold">Check your email</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              If an OpenOak account exists for <span className="font-medium text-foreground">{email}</span>, a password reset link is on its way.
            </p>
          </div>
        ) : (
          <>
            <h2 className="mb-2 text-xl font-semibold">Forgot password?</h2>
            <p className="mb-6 text-sm text-muted-foreground">If your email is associated with an account, we will send you a reset link.</p>
            {error && <AuthMessage>{error}</AuthMessage>}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="absolute size-0 overflow-hidden opacity-0" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input id="website" value={hp} onChange={(event) => setHp(event.target.value)} tabIndex={-1} autoComplete="off" />
              </div>
              <AuthField id="email" label="Email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
              <AuthSubmitButton disabled={loading}>{loading ? "Sending..." : "Send reset link"}</AuthSubmitButton>
            </form>
          </>
        )}
      </AuthCard>
    </AuthPageShell>
  );
}
