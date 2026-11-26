"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient, signUp } from "@/lib/auth-client";
import { completionPath } from "@/lib/auth-paths";
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
import { passwordPolicyError } from "@/lib/password-policy";


function SignupFormInner() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const [resendError, setResendError] = useState("");
  const [hp, setHp] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (hp) return;
    setError("");

    const passwordError = passwordPolicyError(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setLoading(true);
    const { error } = await signUp.email({
      email,
      password,
      name: name.trim() || "User",
      callbackURL: completionPath(redirectTo),
    });

    if (error) {
      setError(error.message ?? "Sign up failed. Please try again.");
      setLoading(false);
      return;
    }

    setSent(true);
  }

  async function handleResend() {
    setResendLoading(true);
    setResendMessage("");
    setResendError("");

    try {
      const { error } = await authClient.sendVerificationEmail({
        email,
        callbackURL: completionPath(redirectTo),
      });

      if (error) {
        setResendError(error.message ?? "We could not resend the verification email. Please try again.");
      } else {
        setResendMessage("If this account is unverified, a new verification link has been sent.");
      }
    } catch {
      setResendError("We could not resend the verification email. Please try again.");
    } finally {
      setResendLoading(false);
    }
  }

  const loginHref = redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login";

  return (
    <AuthPageShell
      footer={
        <AuthFooter>
          Already have an account? <AuthLink href={loginHref}>Log in</AuthLink>
        </AuthFooter>
      }
    >
      <AuthCard>
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">@</div>
            <h1 className="text-2xl font-semibold">Verify your email</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Check <span className="font-medium text-foreground">{email}</span> for a verification link.
            </p>
            <div className="mt-2 w-full text-left" aria-live="polite">
              {resendError && <AuthMessage>{resendError}</AuthMessage>}
              {resendMessage && <AuthMessage tone="success">{resendMessage}</AuthMessage>}
            </div>
            <AuthSubmitButton
              type="button"
              loading={resendLoading}
              loadingLabel="Sending verification email..."
              onClick={handleResend}
            >
              Resend verification email
            </AuthSubmitButton>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">OpenOak account</p>
            <h1 className="mb-6 text-2xl font-semibold">Create account</h1>
            {error && <AuthMessage>{error}</AuthMessage>}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="absolute size-0 overflow-hidden opacity-0" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input id="website" value={hp} onChange={(event) => setHp(event.target.value)} tabIndex={-1} autoComplete="off" />
              </div>
              <fieldset disabled={loading} className="contents">
                <AuthField id="name" label="Name" type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
                <AuthField id="email" label="Email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
                <AuthField id="password" label="Password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Letters and numbers, 8+ chars" />
              </fieldset>
              <AuthSubmitButton loading={loading} loadingLabel="Creating account...">
                Create account
              </AuthSubmitButton>
              {loading && (
                <p className="text-center text-xs leading-relaxed text-muted-foreground" aria-live="polite">
                  Creating your account and sending the verification email.
                </p>
              )}
            </form>
          </>
        )}
      </AuthCard>
    </AuthPageShell>
  );
}

export function SignupForm() {
  return (
    <Suspense fallback={<AuthLoadingCard />}>
      <SignupFormInner />
    </Suspense>
  );
}
