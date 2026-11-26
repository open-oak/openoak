"use client";

import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function AuthPageShell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="relative isolate flex min-h-dvh items-center overflow-hidden px-5 py-8 text-white sm:px-8">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center"
        style={{
          backgroundImage: "url('/assets/openoak_bg.webp')",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-10 bg-[linear-gradient(120deg,rgba(17,19,15,0.9)_0%,rgba(17,19,15,0.66)_45%,rgba(32,23,15,0.42)_100%)]"
      />
      <div className="relative z-20 mx-auto grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <section className="max-w-2xl">
          <Logo className="text-4xl text-white sm:text-5xl" />
          <p className="mt-5 max-w-xl text-3xl font-semibold leading-tight text-[#f2efe4] sm:text-5xl">
            One account for every OpenOak app.
          </p>
          <p className="mt-5 max-w-md text-base leading-relaxed text-[#d8d0bd]">
            Sign in once for OpenTodo, OpenOutline, OpenKanban, and the tools that join the ecosystem next.
          </p>
        </section>

        <section className="w-full">
          {children}
          {footer}
        </section>
      </div>
    </main>
  );
}

export function AuthCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[#ede2ca]/35 bg-[#f7f1e4]/95 p-6 text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:p-7",
        className
      )}
    >
      {children}
    </div>
  );
}

export function AuthMessage({
  children,
  tone = "error",
}: {
  children: React.ReactNode;
  tone?: "error" | "success" | "muted";
}) {
  return (
    <div
      className={cn(
        "mb-4 rounded-lg px-4 py-3 text-sm",
        tone === "error" && "bg-red-500/10 text-destructive",
        tone === "success" && "border border-green-500/20 bg-green-500/10 text-green-700",
        tone === "muted" && "border border-border bg-muted/50 text-muted-foreground"
      )}
    >
      {children}
    </div>
  );
}

export function AuthField({
  id,
  label,
  action,
  className,
  ...props
}: React.ComponentProps<"input"> & {
  id: string;
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {action}
      </div>
      <Input id={id} {...props} />
    </div>
  );
}

export function AuthSubmitButton({
  children,
  className,
  loading = false,
  loadingLabel,
  disabled,
  ...props
}: React.ComponentProps<typeof Button> & {
  loading?: boolean;
  loadingLabel?: string;
}) {
  return (
    <Button
      type="submit"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn("w-full gap-2 rounded-full", className)}
      {...props}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {loading ? (loadingLabel ?? children) : children}
    </Button>
  );
}

export function AuthFooter({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 text-center text-sm font-medium text-[#d8d0bd] [&_a]:text-white">{children}</p>;
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-foreground hover:underline">
      {children}
    </Link>
  );
}

export function AuthLoadingCard() {
  return (
    <AuthCard className="flex h-72 items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-primary border-b-transparent" />
    </AuthCard>
  );
}
