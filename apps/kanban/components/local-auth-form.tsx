"use client";

import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LocalAuthForm({ productName, redirectTo }: { productName: string; redirectTo: string }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const name = String(data.get("name") || "").trim();
    const result = mode === "sign-up"
      ? await authClient.signUp.email({ email, password, name: name || email })
      : await authClient.signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message || "Authentication failed.");
      setPending(false);
      return;
    }
    window.location.assign(redirectTo);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
      <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm font-medium text-muted-foreground">{productName}</p>
        <h1 className="mt-1 text-2xl font-semibold">{mode === "sign-in" ? "Sign in" : "Create an account"}</h1>
        <p className="mb-6 mt-2 text-sm text-muted-foreground">
          {mode === "sign-in" ? "Continue to your workspace." : "Create a local account for this installation."}
        </p>
        <form className="space-y-4" onSubmit={submit}>
          {mode === "sign-up" && <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="name">Name</label><Input id="name" name="name" autoComplete="name" /></div>}
          <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="email">Email</label><Input id="email" name="email" type="email" autoComplete="email" required /></div>
          <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor="password">Password</label><Input id="password" name="password" type="password" minLength={8} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} required /></div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button className="w-full" type="submit" disabled={pending}>{pending ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create account"}</Button>
        </form>
        <button type="button" className="mt-5 w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setError(null); }}>
          {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}
