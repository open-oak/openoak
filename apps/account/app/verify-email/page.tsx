"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AuthCard, AuthPageShell } from "@/components/auth-components";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const verificationError = searchParams.get("error");
  const redirectTo = searchParams.get("redirect");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    async function verify() {
      if (verificationError) {
        setStatus("error");
        setError(
          verificationError === "TOKEN_EXPIRED"
            ? "This verification link has expired. Sign in to request a new one."
            : "This verification link is invalid or has already been used.",
        );
        return;
      }

      if (!token) {
        setStatus("error");
        setError("Missing verification token.");
        return;
      }

      const { error } = await authClient.verifyEmail({ query: { token } });

      if (error) {
        setStatus("error");
        setError(error.message ?? "The link may have expired or is invalid.");
        return;
      }

      setStatus("success");
    }

    verify();
  }, [token, verificationError]);

  const loginHref = redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login";

  if (status === "loading") {
    return (
      <AuthCard className="flex h-72 items-center justify-center">
        <Loader2 className="size-10 animate-spin text-primary" />
      </AuthCard>
    );
  }

  return (
    <AuthCard className="flex flex-col items-center text-center">
      {status === "success" ? (
        <>
          <CheckCircle2 className="mb-5 size-12 text-green-600" />
          <h2 className="mb-3 text-xl font-semibold">Verification successful</h2>
          <p className="mb-6 text-sm leading-relaxed text-muted-foreground">Your OpenOak account is ready to use.</p>
          <Link href={loginHref} className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Log in
          </Link>
        </>
      ) : (
        <>
          <XCircle className="mb-5 size-12 text-destructive" />
          <h2 className="mb-3 text-xl font-semibold">Verification failed</h2>
          <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{error}</p>
          <Link href={loginHref} className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
            Go to login
          </Link>
        </>
      )}
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthPageShell>
      <Suspense fallback={null}>
        <VerifyEmailContent />
      </Suspense>
    </AuthPageShell>
  );
}
