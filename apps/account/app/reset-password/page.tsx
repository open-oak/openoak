"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthCard, AuthField, AuthFooter, AuthLink, AuthLoadingCard, AuthMessage, AuthPageShell, AuthSubmitButton } from "@/components/auth-components";
import { passwordPolicyError } from "@/lib/password-policy";


function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    if (!token) {
      setError("Invalid or missing reset token. Please request a new link.");
      return;
    }

    const passwordError = passwordPolicyError(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    const { error } = await authClient.resetPassword({ newPassword: password }, { query: { token } });

    if (error) {
      setError(error.message ?? "Something went wrong. The link may have expired.");
      setLoading(false);
      return;
    }

    router.push("/login?reset=success");
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
        <h2 className="mb-2 text-xl font-semibold">Create new password</h2>
        <p className="mb-6 text-sm text-muted-foreground">Choose a strong password for your account.</p>
        {error && <AuthMessage>{error}</AuthMessage>}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <AuthField id="password" label="New password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Letters and numbers, 8+ chars" />
          <AuthField id="confirm" label="Confirm password" type="password" required autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Repeat your password" />
          <AuthSubmitButton disabled={loading}>{loading ? "Saving..." : "Set new password"}</AuthSubmitButton>
        </form>
      </AuthCard>
    </AuthPageShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoadingCard />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
