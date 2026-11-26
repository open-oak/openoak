"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { completionPath } from "@/lib/auth-paths";
import { getOAuthLoginDestination } from "@/lib/oauth-login";
import {
  AuthCard,
  AuthField,
  AuthFooter,
  AuthLink,
  AuthLoadingCard,
  AuthMessage,
  AuthPageShell,
  AuthSubmitButton,
} from "@/components/auth-components";

function LoginFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const resetSuccess = searchParams.get("reset") === "success";
  const verificationSuccess = searchParams.get("verified") === "success";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hp, setHp] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (hp) return;
    setError("");
    setLoading(true);

    const nextPath = completionPath(redirectTo);
    const { data, error } = await signIn.email({ email, password, callbackURL: nextPath });

    if (error) {
      setError(error.message ?? "Sign in failed. Please check your credentials.");
      setLoading(false);
      return;
    }

    const oauthDestination = getOAuthLoginDestination(searchParams, data);
    if (oauthDestination !== undefined) {
      if (!oauthDestination) {
        setError("Could not continue authorization. Please start the connection again.");
        setLoading(false);
        return;
      }

      window.location.assign(oauthDestination);
      return;
    }

    router.push(nextPath);
    router.refresh();
  }

  const signupHref = redirectTo ? `/signup?redirect=${encodeURIComponent(redirectTo)}` : "/signup";

  return (
    <AuthPageShell
      footer={
        <AuthFooter>
          Do not have an account? <AuthLink href={signupHref}>Sign up</AuthLink>
        </AuthFooter>
      }
    >
      <AuthCard>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">OpenOak account</p>
        <h1 className="mb-6 text-2xl font-semibold">Sign in</h1>
        {resetSuccess && <AuthMessage tone="success">Password reset successfully. You can now sign in.</AuthMessage>}
        {verificationSuccess && <AuthMessage tone="success">Email verified. You can now sign in.</AuthMessage>}
        {error && <AuthMessage>{error}</AuthMessage>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="absolute size-0 overflow-hidden opacity-0" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input id="website" value={hp} onChange={(event) => setHp(event.target.value)} tabIndex={-1} autoComplete="off" />
          </div>
          <fieldset disabled={loading} className="contents">
            <AuthField id="email" label="Email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            <AuthField
              id="password"
              label="Password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              action={
                <Link href="/forgot-password" className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  Forgot password?
                </Link>
              }
            />
          </fieldset>
          <AuthSubmitButton loading={loading} loadingLabel="Signing in...">
            Sign in
          </AuthSubmitButton>
          {loading && (
            <p className="text-center text-xs leading-relaxed text-muted-foreground" aria-live="polite">
              Checking your account and preparing your OpenOak session.
            </p>
          )}
        </form>
      </AuthCard>
    </AuthPageShell>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={<AuthLoadingCard />}>
      <LoginFormInner />
    </Suspense>
  );
}
